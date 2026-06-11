const db = require('../models');
const User = db.User || require('../models/user');
const SubscriptionPrice = db.SubscriptionPrice || require('../models/subscriptionPrice');
const iap = require('in-app-purchase');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');

// IAP configuration
const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET;
const GOOGLE_SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT_JSON 
  ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  : null;

// IAP config initialization — setup() sadece bir kez çağrılır
let iapReady = false;

async function ensureIapReady() {
  if (iapReady) return;
  if (APPLE_SHARED_SECRET || GOOGLE_SERVICE_ACCOUNT) {
    iap.config({
      applePassword: APPLE_SHARED_SECRET,
      googleAccToken: GOOGLE_SERVICE_ACCOUNT,
      test: process.env.NODE_ENV !== 'production',
    });
    await iap.setup();
    iapReady = true;
    console.log('[IAP] Configuration loaded and setup complete');
  } else {
    console.warn('[IAP] Warning: Apple/Google credentials not configured');
  }
}
// Uygulama başladığında kurulumu başlat
ensureIapReady().catch(err => console.error('[IAP] Initial setup error:', err));

/**
 * POST /node/subscriptions/verify
 * Mobile app'ten gelen receipt/token'ı doğrular ve kullanıcıya premium özellikler atar
 */
exports.verifySubscription = async (req, res) => {
  try {
    const { platform, productId, basePlanId, transactionReceipt, purchaseToken, transactionId } = req.body;
    const userId = req.user.id;

    console.log('[Subscription] Verify request:', {
      userId,
      platform,
      productId,
      basePlanId,
      hasPurchaseToken: !!purchaseToken,
      purchaseTokenPreview: purchaseToken ? String(purchaseToken).slice(0, 30) + '…' : 'MISSING',
      hasTransactionReceipt: !!transactionReceipt,
      transactionId,
    });

    if (!platform || !productId) {
      return res.status(400).json({ error: 'platform ve productId zorunlu' });
    }

    let verificationResult;
    let expiresDate;
    let isActive = false;
    let autoRenewing;
    let finalTransactionId = transactionId;
    let lookupKey = null;

    // Platform bazlı doğrulama
    if (platform === 'ios') {
      if (!transactionReceipt) {
        return res.status(400).json({ error: 'iOS için transactionReceipt zorunlu' });
      }

      verificationResult = await verifyAppleReceipt(transactionReceipt, productId);
      
      if (!verificationResult.isValid) {
        console.error('[Apple] Receipt invalid, appleStatus:', verificationResult.appleStatus);
        return res.status(400).json({
          error: 'Invalid receipt',
          message: 'Apple receipt doğrulanamadı',
          appleStatus: verificationResult.appleStatus,
        });
      }

      expiresDate = verificationResult.expiresDate;
      isActive = verificationResult.isActive;
      autoRenewing = verificationResult.autoRenewing ?? isActive;
      finalTransactionId = verificationResult.transactionId || transactionId;
      // Apple'da originalTransactionId tüm yenilemeler boyunca sabittir — webhook lookup için sakla
      lookupKey = verificationResult.originalTransactionId || transactionId;

    } else if (platform === 'android') {
      if (!purchaseToken) {
        return res.status(400).json({ error: 'Android için purchaseToken zorunlu' });
      }

      verificationResult = await verifyGooglePurchase(purchaseToken);

      if (!verificationResult.isValid) {
        return res.status(400).json({
          error: 'Invalid purchase',
          message: 'Google purchase doğrulanamadı',
        });
      }

      expiresDate = verificationResult.expiresDate;
      isActive = verificationResult.isActive;
      autoRenewing = verificationResult.autoRenewing ?? isActive;
      finalTransactionId = verificationResult.orderId || transactionId;
      // Son aktif purchaseToken webhook lookup için saklanır; yenilemede güncellenir
      lookupKey = verificationResult.purchaseToken || purchaseToken;

    } else {
      return res.status(400).json({ error: 'Geçersiz platform (ios veya android olmalı)' });
    }

    // Güvenlik: bu token/receipt zaten başka bir kullanıcıya ait mi?
    // "Satın Alımları Geri Yükle" ile farklı uygulama hesabına abonelik taşınmasını engeller.
    if (lookupKey) {
      const existingOwner = await User.findOne({
        where: { subscription_lookup_key: lookupKey },
        attributes: ['id'],
      });
      if (existingOwner && existingOwner.id !== userId) {
        console.warn('[Subscription] lookupKey başka kullanıcıya ait:', {
          requestingUserId: userId,
          ownerUserId: existingOwner.id,
          lookupKeyPreview: String(lookupKey).slice(0, 30) + '…',
        });
        return res.status(409).json({
          error: 'Bu abonelik başka bir hesaba bağlı',
          code: 'SUBSCRIPTION_OWNED_BY_ANOTHER_USER',
        });
      }
    }

    // Kullanıcı subscription bilgilerini güncelle
    await updateUserSubscription(userId, {
      platform,
      productId,
      basePlanId,
      transactionId: finalTransactionId,
      expiresDate,
      isActive,
      autoRenewing,
      lookupKey,
    });

    console.log('[Subscription] Verify success:', { userId, expiresDate, isActive });

    return res.json({
      success: true,
      subscription: {
        productId,
        expiresDate,
        isActive,
      },
    });

  } catch (error) {
    console.error('[Subscription] Verify error:', error);
    return res.status(500).json({
      error: 'Doğrulama başarısız',
      message: error.message,
    });
  }
};

/**
 * GET /node/subscriptions/status
 * Kullanıcının mevcut abonelik durumunu döndürür.
 * Süre geçmişse DB güncellemesi de yapar — crona gerek kalmadan anında yansır.
 */
exports.getSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findByPk(userId, {
      attributes: [
        'id',
        'subscription_platform',
        'subscription_product_id',
        'subscription_expires_at',
        'subscription_is_active',
        'subscription_auto_renewing',
        'offline_enabled',
        'offline_radius_km'
      ]
    });

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    // Gerçek zamanlı süre kontrolü: DB aktif diyor ama süre geçmişse hemen düşür
    const now = new Date();
    const isExpired = user.subscription_is_active &&
      user.subscription_expires_at &&
      user.subscription_expires_at < now;

    if (isExpired) {
      await user.update({
        subscription_is_active: false,
        offline_enabled: false,
        role: 'guest',
      });
      console.log('[Status] Süresi geçmiş abonelik anında düşürüldü:', userId);
    }

    const isActive = isExpired ? false : (user.subscription_is_active || user.offline_enabled);
    const offlineEnabled = isExpired ? false : user.offline_enabled;

    return res.json({
      subscription: {
        platform: user.subscription_platform,
        productId: user.subscription_product_id,
        expiresAt: user.subscription_expires_at,
        isActive,
        autoRenewing: isExpired ? false : (user.subscription_auto_renewing ?? null),
        offlineEnabled,
        offlineRadiusKm: user.offline_radius_km,
      }
    });

  } catch (error) {
    console.error('[Subscription] Status error:', error);
    return res.status(500).json({
      error: 'Durum alınamadı',
      message: error.message,
    });
  }
};

/**
 * Apple Receipt Doğrulama
 * in-app-purchase kütüphanesi yerine doğrudan Apple /verifyReceipt API'si kullanılır.
 * Kütüphane status 498 ile kendi validasyonunda başarısız olduğundan bypass edildi.
 */
async function verifyAppleReceipt(receiptData, productId) {
  try {
    if (!APPLE_SHARED_SECRET) {
      throw new Error('APPLE_SHARED_SECRET env değişkeni tanımlanmamış');
    }

    // Farklı formatlarda gelebilecek receipt'i normalize et
    let receipt = receiptData;
    if (typeof receiptData === 'object' && receiptData !== null) {
      receipt = receiptData['receipt-data'] || receiptData.receipt || JSON.stringify(receiptData);
    } else if (typeof receiptData === 'string' && receiptData.startsWith('{')) {
      try {
        const parsed = JSON.parse(receiptData);
        receipt = parsed['receipt-data'] || parsed.receipt || receiptData;
      } catch (_) { /* ham string kullan */ }
    }

    console.log('[Apple] Receipt format check:', {
      type: typeof receipt,
      length: receipt ? String(receipt).length : 0,
      prefix: receipt ? String(receipt).slice(0, 20) : 'MISSING',
      isJWS: typeof receipt === 'string' && receipt.startsWith('ey'),
    });

    const requestBody = {
      'receipt-data': receipt,
      password: APPLE_SHARED_SECRET,
      'exclude-old-transactions': true,
    };

    // Production endpoint'le başla, 21007 dönerse sandbox'a geç
    let appleUrl = 'https://buy.itunes.apple.com/verifyReceipt';
    let response = await axios.post(appleUrl, requestBody);
    let data = response.data;

    console.log('[Apple] Verify response status:', data.status);

    if (data.status === 21007) {
      // Sandbox ortamından gelen receipt → sandbox endpoint'e yönlendir
      appleUrl = 'https://sandbox.itunes.apple.com/verifyReceipt';
      response = await axios.post(appleUrl, requestBody);
      data = response.data;
      console.log('[Apple] Sandbox retry status:', data.status);
    }

    if (data.status !== 0) {
      console.error('[Apple] Verification failed with Apple status:', data.status);
      return { isValid: false, appleStatus: data.status };
    }

    // Abonelikler için latest_receipt_info kullan (receipt.in_app eski veriyi içerebilir)
    const latestReceiptInfo = data.latest_receipt_info || data.receipt?.in_app || [];
    const sortedPurchases = [...latestReceiptInfo].sort(
      (a, b) => parseInt(b.expires_date_ms || 0) - parseInt(a.expires_date_ms || 0)
    );
    const latestPurchase = sortedPurchases.find(p => p.product_id === productId) || sortedPurchases[0];

    if (!latestPurchase) {
      console.error('[Apple] No matching purchase found for productId:', productId);
      return { isValid: false, appleStatus: 0 };
    }

    const expiresDate = latestPurchase.expires_date_ms
      ? new Date(parseInt(latestPurchase.expires_date_ms))
      : null;
    const isActive = expiresDate ? expiresDate > new Date() : false;

    // pending_renewal_info: auto_renew_status '1' = yenilenecek, '0' = iptal edildi
    const pendingRenewal = data.pending_renewal_info || [];
    const renewalEntry = pendingRenewal.find(p => p.product_id === productId) || pendingRenewal[0];
    const autoRenewing = renewalEntry ? renewalEntry.auto_renew_status === '1' : isActive;

    return {
      isValid: true,
      expiresDate,
      isActive,
      autoRenewing,
      transactionId: latestPurchase.transaction_id,
      originalTransactionId: latestPurchase.original_transaction_id,
    };

  } catch (error) {
    console.error('[Apple] Verification error:', error);
    const errMsg = error?.message ||
      (typeof error === 'string' ? (() => { try { return JSON.parse(error).message || error; } catch (_) { return error; } })() : JSON.stringify(error));
    throw new Error('Apple receipt verification failed: ' + errMsg);
  }
}

/**
 * Google Purchase Token Doğrulama
 * subscriptionsv2 endpoint'i kullanır: sadece packageName + token yeterli,
 * subscription product ID gerektirmez.
 */
async function verifyGooglePurchase(purchaseToken) {
  try {
    const packageName = process.env.ANDROID_PACKAGE_NAME || 'com.kampdefterim.app';
    const serviceAccount = GOOGLE_SERVICE_ACCOUNT;

    if (!serviceAccount) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env değişkeni tanımlanmamış');
    }

    // react-native-iap bazı versiyonlarda token JSON string içinde gelir
    let resolvedToken = purchaseToken;
    if (typeof purchaseToken === 'string' && purchaseToken.startsWith('{')) {
      try {
        const parsed = JSON.parse(purchaseToken);
        resolvedToken = parsed.purchaseToken || purchaseToken;
      } catch (_) { /* ham token kullan */ }
    }

    console.log('[Google] Calling subscriptionsv2.get:', {
      packageName,
      tokenPreview: resolvedToken ? String(resolvedToken).slice(0, 30) + '…' : 'MISSING',
    });

    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const accessToken = await auth.getAccessToken();
    const authHeader = { Authorization: `Bearer ${accessToken}` };

    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${resolvedToken}`;
    const response = await axios.get(url, { headers: authHeader });

    const sub = response.data;
    console.log('[Google] subscriptionsv2 response:', JSON.stringify(sub));

    const lineItem = sub.lineItems?.[0];
    const expiryTime = lineItem?.expiryTime;
    const expiresDate = expiryTime ? new Date(expiryTime) : null;

    // CANCELED: kullanıcı iptal etti ama erişim süresi henüz dolmadı → hâlâ aktif
    // Süre dolduğunda Google EXPIRED (20) bildirimi gönderir veya cron yakalar.
    const activeStates = [
      'SUBSCRIPTION_STATE_ACTIVE',
      'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
      'SUBSCRIPTION_STATE_CANCELED',
    ];
    const isActive = activeStates.includes(sub.subscriptionState) &&
      (expiresDate ? expiresDate > new Date() : false);

    // Satın alma henüz acknowledge edilmemişse bildir (3 gün içinde yapılmalı)
    if (sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      try {
        const ackUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptions/${lineItem?.productId}/tokens/${resolvedToken}:acknowledge`;
        await axios.post(ackUrl, {}, { headers: authHeader });
        console.log('[Google] Purchase acknowledged successfully');
      } catch (ackErr) {
        // Acknowledge başarısız olsa da doğrulama akışını engelleme; sadece logla
        console.warn('[Google] Acknowledge failed (non-fatal):', ackErr?.response?.data || ackErr?.message);
      }
    }

    // CANCELED: kullanıcı bir sonraki dönem yenilemesini kapattı — autoRenewing false
    // ACTIVE / IN_GRACE_PERIOD: otomatik yenileme devam ediyor
    const autoRenewing = [
      'SUBSCRIPTION_STATE_ACTIVE',
      'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    ].includes(sub.subscriptionState);

    return {
      isValid: true,
      expiresDate,
      isActive,
      autoRenewing,
      orderId: sub.latestOrderId,
      subscriptionState: sub.subscriptionState,
      productId: lineItem?.productId,
      purchaseToken: resolvedToken,
    };

  } catch (error) {
    const googleErr = error?.response?.data?.error;
    const errMsg = googleErr
      ? `${googleErr.code} ${googleErr.status}: ${googleErr.message}`
      : (error?.message || JSON.stringify(error));
    console.error('[Google] Verification error:', JSON.stringify(error?.response?.data || error?.message || error));
    throw new Error('Google purchase verification failed: ' + errMsg);
  }
}

/**
 * Kullanıcı abonelik bilgilerini güncelle
 */
async function updateUserSubscription(userId, subscriptionData) {
  const { platform, productId, basePlanId, transactionId, expiresDate, isActive, lookupKey, autoRenewing } = subscriptionData;

  // offline_radius_km belirleme: basePlanId yoksa productId'den tahmin et
  const isYearly = basePlanId === 'yearly' || (!basePlanId && productId?.includes('yearly'));
  const offlineRadiusKm = isYearly ? 50 : 20;

  const user = await User.findByPk(userId);
  if (!user) {
    throw new Error('Kullanıcı bulunamadı');
  }

  await user.update({
    offline_enabled: isActive,
    offline_radius_km: offlineRadiusKm,
    subscription_platform: platform,
    subscription_product_id: productId,
    subscription_transaction_id: transactionId,
    subscription_expires_at: expiresDate,
    subscription_is_active: isActive,
    role: isActive ? 'user' : 'guest',
    ...(lookupKey && { subscription_lookup_key: lookupKey }),
    ...(autoRenewing !== undefined && { subscription_auto_renewing: autoRenewing }),
  });

  console.log('[DB] User subscription updated:', { 
    userId, 
    productId, 
    expiresDate,
    offlineRadiusKm,
    isActive,
    autoRenewing,
    role: isActive ? 'user' : 'guest',
  });
}

/**
 * POST /node/subscriptions/refresh
 * Abonelik durumunu doğrudan mağaza API'sinden sorgular ve DB'yi günceller.
 * Frontend uygulama ön plana geldiğinde veya kullanıcı abonelik ekranını
 * açtığında bu endpoint'i çağırmalıdır.
 */
exports.refreshSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const platform = user.subscription_platform;
    const lookupKey = user.subscription_lookup_key;

    if (!platform || !lookupKey) {
      // Hiç abonelik kaydı yok — mevcut durumu dön (manuel offline_enabled kontrolü dahil)
      return res.json({
        refreshed: false,
        subscription: {
          platform: null,
          productId: null,
          expiresAt: null,
          isActive: user.offline_enabled,
          offlineEnabled: user.offline_enabled,
          offlineRadiusKm: user.offline_radius_km,
        },
      });
    }

    let isActive = false;
    let autoRenewing;
    let expiresDate = null;
    let newLookupKey = lookupKey;

    if (platform === 'ios') {
      // iOS: lookup_key = originalTransactionId, ancak /verify için receipt lazım.
      // Elimizde sadece originalTransactionId var, Apple'ın /history endpoint'i
      // App Store Server API (JWT) gerektirir. Şimdilik DB tarihine bakıyoruz;
      // gerçek yenileme verifySubscription akışından geliyor.
      const now = new Date();
      expiresDate = user.subscription_expires_at;
      isActive = !!(expiresDate && expiresDate > now);
      autoRenewing = isActive ? (user.subscription_auto_renewing ?? null) : false;
      console.log('[Refresh] iOS: DB tarihinden hesaplandı', { userId, isActive, autoRenewing, expiresDate });
    } else if (platform === 'android') {
      const result = await verifyGooglePurchase(lookupKey);
      isActive = result.isActive;
      expiresDate = result.expiresDate;
      if (result.purchaseToken && result.purchaseToken !== lookupKey) {
        newLookupKey = result.purchaseToken;
      }
      console.log('[Refresh] Android: Google API sonucu', { userId, isActive, expiresDate, state: result.subscriptionState });
    }

    // DB'yi güncelle
    await user.update({
      subscription_is_active: isActive,
      subscription_expires_at: expiresDate ?? user.subscription_expires_at,
      offline_enabled: isActive,
      role: isActive ? 'user' : 'guest',
      ...(newLookupKey !== lookupKey && { subscription_lookup_key: newLookupKey }),
    });

    return res.json({
      refreshed: true,
      subscription: {
        platform,
        productId: user.subscription_product_id,
        expiresAt: expiresDate ?? user.subscription_expires_at,
        isActive,
        offlineEnabled: isActive,
        offlineRadiusKm: user.offline_radius_km,
      },
    });

  } catch (error) {
    console.error('[Refresh] Hata:', error);
    return res.status(500).json({ error: 'Yenileme başarısız', message: error.message });
  }
};

/**
 * Süresi dolan abonelikleri kontrol et ve devre dışı bırak
 * CRON job ile çağrılmalı
 */
exports.checkExpiredSubscriptions = async () => {
  console.log('[Cron] Checking expired subscriptions...');

  try {
    const expiredUsers = await User.findAll({
      where: {
        subscription_is_active: true,
        subscription_expires_at: {
          [db.Sequelize.Op.lt]: new Date()
        }
      }
    });

    console.log(`[Cron] Found ${expiredUsers.length} expired subscriptions`);

    for (const user of expiredUsers) {
      await user.update({
        offline_enabled: false,
        subscription_is_active: false,
        role: 'guest',
      });
      
      console.log('[Cron] Downgraded user:', user.email);
    }

    console.log('[Cron] Expired subscriptions check completed');
    return { success: true, count: expiredUsers.length };

  } catch (error) {
    console.error('[Cron] Check expired subscriptions error:', error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Webhook Yardımcıları
// ---------------------------------------------------------------------------

/**
 * Apple App Store Server Notifications v2 — JWS payload'ını imzasız decode eder.
 * İmza doğrulaması Apple'ın JWKS endpoint'inden yapılabilir; burada HTTPS
 * üzerinden gelen payload'a güvenilmektedir.
 */
function decodeJWS(jws) {
  try {
    const parts = String(jws).split('.');
    if (parts.length !== 3) return null;
    // base64url → base64 dönüşümü
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    console.error('[JWS] Decode hatası:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Apple App Store Server Notifications v2 Webhook
// POST /node/subscriptions/webhook/apple
// ---------------------------------------------------------------------------

/**
 * Apple tarafından gönderilen abonelik olay bildirimleri.
 * App Store Connect > App > App Store Server Notifications bölümünden
 * bu URL'yi "Production Server URL" olarak kaydedin.
 *
 * Önemli olaylar:
 *   SUBSCRIBED / DID_RENEW          → aktif tut / süresi güncelle
 *   EXPIRED / GRACE_PERIOD_EXPIRED  → devre dışı bırak
 *   REFUND / REVOKE                 → devre dışı bırak
 *   DID_FAIL_TO_RENEW               → grace period başladı, henüz işlem yapma
 */
exports.appleWebhook = async (req, res) => {
  try {
    const { signedPayload } = req.body;
    if (!signedPayload) {
      return res.status(400).json({ error: 'signedPayload eksik' });
    }

    const payload = decodeJWS(signedPayload);
    if (!payload) {
      console.warn('[Apple Webhook] signedPayload decode edilemedi');
      return res.status(200).json({ received: true });
    }

    const { notificationType, subtype, data } = payload;
    console.log('[Apple Webhook] Event:', notificationType, subtype || '');

    const txInfo = data?.signedTransactionInfo ? decodeJWS(data.signedTransactionInfo) : null;
    if (!txInfo) {
      console.warn('[Apple Webhook] signedTransactionInfo decode edilemedi');
      return res.status(200).json({ received: true });
    }

    const originalTransactionId = txInfo.originalTransactionId;
    const expiresDate = txInfo.expiresDate ? new Date(txInfo.expiresDate) : null;

    // Deaktif edilmesi gereken olaylar
    const DEACTIVATE = ['EXPIRED', 'REFUND', 'GRACE_PERIOD_EXPIRED', 'REVOKE'];
    // Aktif tutulması / güncellenmesi gereken olaylar
    const ACTIVATE = ['SUBSCRIBED', 'DID_RENEW', 'OFFER_REDEEMED'];

    let isActive;
    if (DEACTIVATE.includes(notificationType)) {
      isActive = false;
    } else if (ACTIVATE.includes(notificationType)) {
      isActive = expiresDate ? expiresDate > new Date() : false;
    } else {
      // DID_FAIL_TO_RENEW, PRICE_INCREASE vb. — aksiyon gerekmez
      console.log('[Apple Webhook] Aksiyon gerektirmiyor:', notificationType);
      return res.status(200).json({ received: true });
    }

    const user = await User.findOne({ where: { subscription_lookup_key: originalTransactionId } });
    if (!user) {
      console.warn('[Apple Webhook] Kullanıcı bulunamadı, originalTransactionId:', originalTransactionId);
      return res.status(200).json({ received: true });
    }

    // DID_CHANGE_RENEWAL_STATUS ile autoRenewing değişiyor olabilir ama notificationType bu değilse
    // ACTIVATE listesindeyse yeniliyor, DEACTIVATE listesindeyse iptal/sona erdi
    const autoRenewing = ACTIVATE.includes(notificationType) ? true
      : DEACTIVATE.includes(notificationType) ? false
      : undefined;

    await user.update({
      subscription_is_active: isActive,
      subscription_expires_at: expiresDate ?? user.subscription_expires_at,
      offline_enabled: isActive,
      role: isActive ? 'user' : 'guest',
      ...(autoRenewing !== undefined && { subscription_auto_renewing: autoRenewing }),
    });

    console.log('[Apple Webhook] Kullanıcı güncellendi:', { userId: user.id, isActive, autoRenewing, notificationType });
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[Apple Webhook] Hata:', error);
    // Apple 200 almazsa bildirimi tekrar gönderir — her koşulda 200 dön
    return res.status(200).json({ received: true });
  }
};

// ---------------------------------------------------------------------------
// Google Play Real-Time Developer Notifications Webhook
// POST /node/subscriptions/webhook/google
// ---------------------------------------------------------------------------

/**
 * Google Pub/Sub push aboneliği üzerinden gelen abonelik olayları.
 * Google Play Console > Monetization > Subscriptions & LTV >
 * "Real-time developer notifications" bölümünden Pub/Sub topic oluşturun
 * ve push subscription URL'sini bu endpoint'e yönlendirin.
 *
 * Güvenlik: GOOGLE_PUBSUB_WEBHOOK_TOKEN env değişkeni ayarlanırsa
 * ?token=<SECRET> query parametresi doğrulanır.
 *
 * Önemli olay tipleri:
 *   1  RECOVERED           → aktif
 *   2  RENEWED             → aktif, süre güncellendi
 *   3  CANCELED            → kullanıcı iptal etti, süresi dolana kadar hâlâ aktif
 *   5  ON_HOLD             → ödeme başarısız, devre dışı bırak
 *   6  IN_GRACE_PERIOD     → grace period, henüz aktif tut
 *   7  RESTARTED           → aktif
 *   20 EXPIRED             → devre dışı bırak
 *   21 REVOKED             → iade/iptal, devre dışı bırak
 */
exports.googleWebhook = async (req, res) => {
  try {
    // Token doğrulama
    const expectedToken = process.env.GOOGLE_PUBSUB_WEBHOOK_TOKEN;
    if (expectedToken && req.query.token !== expectedToken) {
      console.warn('[Google Webhook] Geçersiz token');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Pub/Sub mesajını decode et
    const message = req.body?.message;
    if (!message?.data) {
      return res.status(400).json({ error: 'Geçersiz Pub/Sub mesajı' });
    }

    const decoded = Buffer.from(message.data, 'base64').toString('utf8');
    const notification = JSON.parse(decoded);
    console.log('[Google Webhook] Bildirim:', JSON.stringify(notification));

    const subNotif = notification.subscriptionNotification;
    if (!subNotif) {
      // testNotification veya başka tip
      return res.status(200).json({ received: true });
    }

    const { notificationType, purchaseToken } = subNotif;

    const TYPE = {
      RECOVERED: 1, RENEWED: 2, CANCELED: 3, PURCHASED: 4,
      ON_HOLD: 5, IN_GRACE_PERIOD: 6, RESTARTED: 7,
      EXPIRED: 20, REVOKED: 21,
    };

    // Anında deaktif edilmesi gerekenler
    const DEACTIVATE = [TYPE.ON_HOLD, TYPE.EXPIRED, TYPE.REVOKED];
    // Google API'den güncel state çekip senkronize edilecekler
    const SYNC = [TYPE.RECOVERED, TYPE.RENEWED, TYPE.PURCHASED, TYPE.IN_GRACE_PERIOD, TYPE.RESTARTED];
    // CANCELED (3): abonelik iptal edildi ama süresi dolana kadar aktif — cron halleder

    if (!DEACTIVATE.includes(notificationType) && !SYNC.includes(notificationType)) {
      console.log('[Google Webhook] Aksiyon gerektirmiyor, tip:', notificationType);
      return res.status(200).json({ received: true });
    }

    const user = await User.findOne({ where: { subscription_lookup_key: purchaseToken } });
    if (!user) {
      console.warn('[Google Webhook] Kullanıcı bulunamadı, purchaseToken:', purchaseToken?.slice(0, 20) + '…');
      return res.status(200).json({ received: true });
    }

    let isActive;
    let newExpiresDate = null;

    if (DEACTIVATE.includes(notificationType)) {
      isActive = false;
    } else {
      // Google API'den gerçek durumu çek
      try {
        const googleResult = await verifyGooglePurchase(purchaseToken);
        isActive = googleResult.isActive;
        newExpiresDate = googleResult.expiresDate;
        // purchaseToken yenilenmiş olabilir; lookup_key'i güncelle
        if (googleResult.purchaseToken && googleResult.purchaseToken !== purchaseToken) {
          await user.update({ subscription_lookup_key: googleResult.purchaseToken });
        }
      } catch (apiErr) {
        console.error('[Google Webhook] Google API hatası:', apiErr.message);
        // API hatası = güvenli taraf: deaktif et
        isActive = false;
      }
    }

    // Webhook tip bilgisinden autoRenewing türetilir
    const googleAutoRenewing = DEACTIVATE.includes(notificationType) ? false
      : (typeof isActive !== 'undefined' ? isActive : undefined);

    await user.update({
      subscription_is_active: isActive,
      subscription_expires_at: newExpiresDate ?? user.subscription_expires_at,
      offline_enabled: isActive,
      role: isActive ? 'user' : 'guest',
      ...(googleAutoRenewing !== undefined && { subscription_auto_renewing: googleAutoRenewing }),
    });

    console.log('[Google Webhook] Kullanıcı güncellendi:', { userId: user.id, isActive, autoRenewing: googleAutoRenewing, notificationType });
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[Google Webhook] Hata:', error);
    // Pub/Sub 200 almazsa mesajı tekrar gönderir — her koşulda 200 dön
    return res.status(200).json({ received: true });
  }
};

/**
 * GET /node/subscriptions/prices
 * Tüm platform ve plan kombinasyonlarının fiyatlarını döner
 */
exports.getPrices = async (req, res) => {
  try {
    const rows = await SubscriptionPrice.findAll({
      attributes: ['platform', 'plan', 'price', 'campaign_price', 'campaign_duration_months', 'campaign_label', 'campaign_promo_offer_id'],
      order: [['platform', 'ASC'], ['plan', 'ASC']],
    });

    // { ios: { monthly: '₺49,99', yearly: '₺399,99' }, android: { ... } }
    const prices = {};

    // campaigns: { ios: { monthly: CampaignInfo|null, yearly: CampaignInfo|null }, android: { ... } }
    const campaigns = {};

    for (const row of rows) {
      if (!prices[row.platform]) prices[row.platform] = {};
      prices[row.platform][row.plan] = row.price;

      if (!campaigns[row.platform]) campaigns[row.platform] = {};
      campaigns[row.platform][row.plan] = row.campaign_price
        ? {
            price:          row.campaign_price,
            durationMonths: row.campaign_duration_months,
            ...(row.campaign_label          ? { label:        row.campaign_label }          : {}),
            ...(row.campaign_promo_offer_id ? { promoOfferId: row.campaign_promo_offer_id } : {}),
          }
        : null;
    }

    return res.json({ success: true, prices, campaigns });
  } catch (error) {
    console.error('[Subscription] getPrices error:', error);
    return res.status(500).json({ error: 'Fiyatlar alınamadı' });
  }
};
