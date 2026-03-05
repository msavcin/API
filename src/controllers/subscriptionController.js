const db = require('../models');
const User = db.User || require('../models/user');
const SubscriptionPrice = db.SubscriptionPrice || require('../models/subscriptionPrice');
const iap = require('in-app-purchase');

// IAP configuration
const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET;
const GOOGLE_SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT_JSON 
  ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  : null;

// IAP config initialization
if (APPLE_SHARED_SECRET || GOOGLE_SERVICE_ACCOUNT) {
  iap.config({
    applePassword: APPLE_SHARED_SECRET,
    googleAccToken: GOOGLE_SERVICE_ACCOUNT,
    test: process.env.NODE_ENV !== 'production',
  });
  console.log('[IAP] Configuration loaded successfully');
} else {
  console.warn('[IAP] Warning: Apple/Google credentials not configured');
}

/**
 * POST /node/subscriptions/verify
 * Mobile app'ten gelen receipt/token'ı doğrular ve kullanıcıya premium özellikler atar
 */
exports.verifySubscription = async (req, res) => {
  try {
    const { platform, productId, transactionReceipt, purchaseToken, transactionId } = req.body;
    const userId = req.user.id;

    console.log('[Subscription] Verify request:', { userId, platform, productId });

    if (!platform || !productId) {
      return res.status(400).json({ error: 'platform ve productId zorunlu' });
    }

    let verificationResult;
    let expiresDate;
    let isActive = false;
    let finalTransactionId = transactionId;

    // Platform bazlı doğrulama
    if (platform === 'ios') {
      if (!transactionReceipt) {
        return res.status(400).json({ error: 'iOS için transactionReceipt zorunlu' });
      }

      verificationResult = await verifyAppleReceipt(transactionReceipt, productId);
      
      if (!verificationResult.isValid) {
        return res.status(400).json({
          error: 'Invalid receipt',
          message: 'Apple receipt doğrulanamadı',
        });
      }

      expiresDate = verificationResult.expiresDate;
      isActive = verificationResult.isActive;
      finalTransactionId = verificationResult.transactionId || transactionId;

    } else if (platform === 'android') {
      if (!purchaseToken) {
        return res.status(400).json({ error: 'Android için purchaseToken zorunlu' });
      }

      verificationResult = await verifyGooglePurchase(productId, purchaseToken);

      if (!verificationResult.isValid) {
        return res.status(400).json({
          error: 'Invalid purchase',
          message: 'Google purchase doğrulanamadı',
        });
      }

      expiresDate = verificationResult.expiresDate;
      isActive = verificationResult.isActive;
      finalTransactionId = verificationResult.orderId || transactionId;

    } else {
      return res.status(400).json({ error: 'Geçersiz platform (ios veya android olmalı)' });
    }

    // Kullanıcı subscription bilgilerini güncelle
    await updateUserSubscription(userId, {
      platform,
      productId,
      transactionId: finalTransactionId,
      expiresDate,
      isActive,
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
 * Kullanıcının mevcut abonelik durumunu döndürür
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
        'offline_enabled',
        'offline_radius_km'
      ]
    });

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    return res.json({
      subscription: {
        platform: user.subscription_platform,
        productId: user.subscription_product_id,
        expiresAt: user.subscription_expires_at,
        isActive: user.subscription_is_active,
        offlineEnabled: user.offline_enabled,
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
 */
async function verifyAppleReceipt(receiptData, productId) {
  try {
    await iap.setup();
    
    const receipt = {
      receipt: receiptData,
    };

    const validationResponse = await iap.validate(receipt);
    console.log('[Apple] Validation response:', validationResponse);

    if (!validationResponse || !validationResponse.receipt) {
      return { isValid: false };
    }

    // in-app-purchase kütüphanesi farklı format kullanır
    const purchaseData = validationResponse.receipt.in_app || [];
    const latestPurchase = purchaseData.find(p => p.product_id === productId) || purchaseData[0];
    
    if (!latestPurchase) {
      return { isValid: false };
    }

    const expiresDate = latestPurchase.expires_date_ms
      ? new Date(parseInt(latestPurchase.expires_date_ms))
      : null;
    
    const isActive = expiresDate ? expiresDate > new Date() : false;

    return {
      isValid: true,
      expiresDate,
      isActive,
      transactionId: latestPurchase.transaction_id,
    };

  } catch (error) {
    console.error('[Apple] Verification error:', error);
    throw new Error('Apple receipt verification failed: ' + error.message);
  }
}

/**
 * Google Purchase Token Doğrulama
 */
async function verifyGooglePurchase(productId, purchaseToken) {
  try {
    await iap.setup();
    
    const packageName = process.env.ANDROID_PACKAGE_NAME || 'com.kampdefterim.app';
    
    const receipt = {
      data: purchaseToken,
      packageName: packageName,
      productId: productId,
      subscription: true,
    };

    const validationResponse = await iap.validate(receipt);
    console.log('[Google] Validation response:', validationResponse);

    if (!validationResponse || !validationResponse.receipt) {
      return { isValid: false };
    }

    const expiryTimeMillis = validationResponse.receipt.expiryTimeMillis;
    const expiresDate = expiryTimeMillis
      ? new Date(parseInt(expiryTimeMillis))
      : null;
    
    const isActive = expiresDate ? expiresDate > new Date() : false;

    return {
      isValid: true,
      expiryTimeMillis,
      expiresDate,
      isActive,
      orderId: validationResponse.receipt.orderId,
    };

  } catch (error) {
    console.error('[Google] Verification error:', error);
    throw new Error('Google purchase verification failed: ' + error.message);
  }
}

/**
 * Kullanıcı abonelik bilgilerini güncelle
 */
async function updateUserSubscription(userId, subscriptionData) {
  const { platform, productId, transactionId, expiresDate, isActive } = subscriptionData;

  // offline_radius_km belirleme (yearly ise 50, monthly ise 20)
  const offlineRadiusKm = productId && productId.includes('yearly') ? 50 : 20;

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
  });

  console.log('[DB] User subscription updated:', { 
    userId, 
    productId, 
    expiresDate,
    offlineRadiusKm,
    isActive 
  });
}

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

/**
 * GET /node/subscriptions/prices
 * Tüm platform ve plan kombinasyonlarının fiyatlarını döner
 */
exports.getPrices = async (req, res) => {
  try {
    const rows = await SubscriptionPrice.findAll({
      attributes: ['platform', 'plan', 'price'],
      order: [['platform', 'ASC'], ['plan', 'ASC']],
    });

    // { ios: { monthly: '₺49,99', yearly: '₺399,99' }, android: { ... } }
    const prices = {};
    for (const row of rows) {
      if (!prices[row.platform]) prices[row.platform] = {};
      prices[row.platform][row.plan] = row.price;
    }

    return res.json({ success: true, prices });
  } catch (error) {
    console.error('[Subscription] getPrices error:', error);
    return res.status(500).json({ error: 'Fiyatlar alınamadı' });
  }
};
