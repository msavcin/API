# In-App Purchase (IAP) Subscription Integration Guide

## Genel Bakış
Bu entegrasyon, iOS ve Android platformlarında yapılan abonelik satın alımlarını doğrular ve kullanıcı hesaplarına premium özellikleri aktarır.

## Kurulum

### 1. Bağımlılıkları Yükleyin
```bash
npm install in-app-purchase node-cron
```

### 2. Veritabanı Migration'ını Çalıştırın
```bash
npx sequelize-cli db:migrate
```

Bu migration, `users` tablosuna şu alanları ekler:
- `subscription_platform` (String)
- `subscription_product_id` (String)
- `subscription_transaction_id` (String)
- `subscription_expires_at` (Date)
- `subscription_is_active` (Boolean)

### 3. Environment Variables Ayarlayın

`.env` dosyanıza şu değişkenleri ekleyin:

```env
# Apple IAP
APPLE_SHARED_SECRET=your_apple_shared_secret

# Google IAP
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# Package Names / Bundle IDs
ANDROID_PACKAGE_NAME=com.spondylus.boltexponativewind
IOS_BUNDLE_ID=com.spondylus.kampdefterim

# Environment
NODE_ENV=production
```

#### Apple Shared Secret Nasıl Alınır?
1. [App Store Connect](https://appstoreconnect.apple.com)'e giriş yapın
2. "My Apps" > Uygulamanızı seçin
3. "App Information" > "App-Specific Shared Secret" bölümünden alın

#### Google Service Account Nasıl Oluşturulur?
1. [Google Cloud Console](https://console.cloud.google.com)'a giriş yapın
2. Projenizi seçin
3. "IAM & Admin" > "Service Accounts" > "Create Service Account"
4. Gerekli izinleri verin (Android Publisher API)
5. JSON key dosyasını indirin ve içeriğini environment variable olarak ekleyin

## API Endpoints

**Base URL:** `https://botanikakademi.com`

### 1. Subscription Doğrulama
**Endpoint:** `POST /node/subscriptions/verify`  
**Full URL:** `https://botanikakademi.com/node/subscriptions/verify`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request Body (iOS):**
```json
{
  "platform": "ios",
  "productId": "com.spondylus.kampdefterim.monthly",
  "transactionReceipt": "base64_encoded_receipt_data",
  "transactionId": "1000000123456789"
}
```

**Request Body (Android):**
```json
{
  "platform": "android",
  "productId": "com.spondylus.kampdefterim.monthly",
  "purchaseToken": "google_purchase_token",
  "transactionId": "GPA.1234-5678-9012-34567"
}
```

**Response:**
```json
{
  "success": true,
  "subscription": {
    "productId": "com.spondylus.kampdefterim.monthly",
    "expiresDate": "2026-03-10T12:00:00.000Z",
    "isActive": true
  }
}
```

### 2. Subscription Durumu Sorgulama
**Endpoint:** `GET /node/subscriptions/status`  
**Full URL:** `https://botanikakademi.com/node/subscriptions/status`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "subscription": {
    "platform": "ios",
    "productId": "com.spondylus.kampdefterim.monthly",
    "expiresAt": "2026-03-10T12:00:00.000Z",
    "isActive": true,
    "offlineEnabled": true,
    "offlineRadiusKm": 20
  }
}
```

## Product ID'ler ve Offline Radius

Sistem, product ID'lere göre otomatik olarak offline radius değerlerini ayarlar:

- **Monthly subscription** (`monthly` içeren product ID): `offline_radius_km = 20`
- **Yearly subscription** (`yearly` içeren product ID): `offline_radius_km = 50`

### Platform Bazlı Product ID'ler:

**iOS (Bundle ID: com.spondylus.kampdefterim):**
```
com.spondylus.kampdefterim.monthly
com.spondylus.kampdefterim.yearly
```

**Android (Package Name: com.spondylus.boltexponativewind):**
```
com.spondylus.boltexponativewind.monthly
com.spondylus.boltexponativewind.yearly
```

> **Not:** iOS ve Android'de farklı package name/bundle ID kullanılmaktadır. Backend her iki platformdan gelen istekleri desteklemektedir.

## CRON Job - Süresi Dolan Abonelikleri Kontrol Etme

Süresi dolan abonelikleri otomatik olarak devre dışı bırakmak için cron job çalıştırın:

### Yöntem 1: Node.js ile
```bash
# Sadece cron job'ı çalıştır
node cron_subscription_checker.js
```

Cron job her gün saat 02:00'de çalışacaktır.

### Yöntem 2: PM2 ile (Production)
```bash
pm2 start cron_subscription_checker.js --name subscription-checker
pm2 save
```

### Yöntem 3: Sistem Crontab
```bash
crontab -e
```

Şu satırı ekleyin:
```
0 2 * * * cd home/ubuntu/kisisel/API && node cron_subscription_checker.js
```

## Test Etme

### Sandbox/Test Mode
Development ortamında `NODE_ENV=development` olarak ayarlanırsa, IAP otomatik olarak sandbox mode'da çalışır.

### Test Kullanıcısı Oluşturma
1. iOS için: App Store Connect'te Sandbox Tester oluşturun
2. Android için: Google Play Console'da test kullanıcısı ekleyin

### Manuel Test

**Production:**
```bash
curl -X POST https://botanikakademi.com/node/subscriptions/verify \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "ios",
    "productId": "com.spondylus.kampdefterim.monthly",
    "transactionReceipt": "test_receipt_data",
    "transactionId": "test_transaction_123"
  }'
```

**Local Development:**
```bash
curl -X POST http://localhost:3000/node/subscriptions/verify \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "ios",
    "productId": "com.spondylus.kampdefterim.monthly",
    "transactionReceipt": "test_receipt_data",
    "transactionId": "test_transaction_123"
  }'
```

## Güvenlik Notları

1. **Environment Variables:** `.env` dosyasını asla git'e commit etmeyin
2. **Shared Secrets:** Apple Shared Secret ve Google Service Account bilgilerini güvenli tutun
3. **HTTPS:** Production'da mutlaka HTTPS kullanın
4. **Rate Limiting:** Subscription verify endpoint'ine rate limiting ekleyin

## Hata Ayıklama

Loglar şu format ile konsolda görünür:
```
[Subscription] Verify request: { userId: 123, platform: 'ios', productId: '...' }
[Apple] Validation response: { ... }
[DB] User subscription updated: { userId: 123, productId: '...', ... }
```

Hata durumunda:
```
[Subscription] Verify error: Error message
[Apple] Verification error: Detailed error
```

## Sorun Giderme

### "Apple receipt doğrulanamadı" hatası
- APPLE_SHARED_SECRET doğru ayarlandığından emin olun
- Receipt formatını kontrol edin (base64 encoded olmalı)
- Sandbox/Production mode'u kontrol edin

### "Google purchase doğrulanamadı" hatası
- GOOGLE_SERVICE_ACCOUNT_JSON formatını kontrol edin (valid JSON olmalı)
- Service Account'a Android Publisher API izni verildiğinden emin olun
- Package name doğru olmalı

### "Kullanıcı subscription güncellenemedi" hatası
- Veritabanı migration'ının çalıştırıldığından emin olun
- User modelinde subscription alanlarının olduğunu doğrulayın

---

## Server-to-Server Webhook Entegrasyonu

Webhook'lar sayesinde abonelik iptal/iade/yenileme olayları **anlık** işlenir;
`cron_subscription_checker.js` ise yalnızca yedek güvence olarak çalışmaya devam eder.

### Yeni Ortam Değişkeni

```env
# Google Pub/Sub push doğrulama token'ı (isteğe bağlı ama önerilir)
GOOGLE_PUBSUB_WEBHOOK_TOKEN=gizli_rastgele_dizi
```

### Yeni Migration

```bash
npx sequelize-cli db:migrate
```

Bu migration `users` tablosuna `subscription_lookup_key` sütununu ekler:
- iOS: Her yenilemede sabit kalan Apple `originalTransactionId`
- Android: Son aktif Google `purchaseToken`

---

### Apple App Store Server Notifications v2

**Endpoint:** `POST /node/subscriptions/webhook/apple`  
**Full URL:** `https://botanikakademi.com/node/subscriptions/webhook/apple`

#### Kurulum (App Store Connect)
1. [App Store Connect](https://appstoreconnect.apple.com) > Uygulamanız > **App Information**
2. **App Store Server Notifications** bölümüne gidin
3. **Production Server URL** alanına `https://botanikakademi.com/node/subscriptions/webhook/apple` yazın
4. Sandbox URL'yi de aynı şekilde ekleyebilirsiniz

#### İşlenen Olaylar

| Olay | Aksiyon |
|------|---------|
| `SUBSCRIBED`, `DID_RENEW`, `OFFER_REDEEMED` | Kullanıcı aktif, süre güncellenir |
| `EXPIRED`, `GRACE_PERIOD_EXPIRED` | Kullanıcı `guest` rolüne düşer |
| `REFUND`, `REVOKE` | Kullanıcı anında deaktif edilir |
| `DID_FAIL_TO_RENEW` | Grace period başladı, aksiyon alınmaz |

---

### Google Play Real-Time Developer Notifications

**Endpoint:** `POST /node/subscriptions/webhook/google?token=<GOOGLE_PUBSUB_WEBHOOK_TOKEN>`  
**Full URL:** `https://botanikakademi.com/node/subscriptions/webhook/google?token=gizli_rastgele_dizi`

#### Kurulum (Google Cloud + Play Console)

**1. Pub/Sub Topic oluşturun:**
```bash
gcloud pubsub topics create play-subs
```

**2. Play Console'a erişim izni verin:**
```bash
gcloud pubsub topics add-iam-policy-binding play-subs \
  --member="serviceAccount:google-play-developer-notifications@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

**3. Push subscription oluşturun:**
```bash
gcloud pubsub subscriptions create play-subs-push \
  --topic=play-subs \
  --push-endpoint="https://botanikakademi.com/node/subscriptions/webhook/google?token=gizli_rastgele_dizi" \
  --ack-deadline=30
```

**4. Play Console'da topic'i kaydedin:**
Google Play Console > **Monetization** > **Monetization setup** bölümüne gidin ve Pub/Sub topic'ini girin.

#### İşlenen Olaylar

| Tip | Ad | Aksiyon |
|-----|----|---------|
| 1 | RECOVERED | Aktif — Google API'den senkronize |
| 2 | RENEWED | Aktif — süre güncellendi |
| 3 | CANCELED | **Aksiyon yok** — süre dolana kadar aktif, cron halleder |
| 5 | ON_HOLD | Anında deaktif |
| 6 | IN_GRACE_PERIOD | Aktif — Google API'den senkronize |
| 7 | RESTARTED | Aktif — Google API'den senkronize |
| 20 | EXPIRED | Anında deaktif |
| 21 | REVOKED | Anında deaktif (iade vb.) |

---

### Frontend'in Yapması Gereken

Webhook'lar tamamen sunucu-sunucu arası çalışır. **Frontend'de herhangi bir değişiklik gerekmez.**

Bununla birlikte, uygulama ön plana geldiğinde veya abonelik ekranı açıldığında
`GET /node/subscriptions/status` çağırmak hâlâ önerilir; bu sayede anlık durum
kullanıcıya yansıtılır.

```http
GET /node/subscriptions/status
Authorization: Bearer <JWT_TOKEN>
```


## İlgili Dosyalar

```
/migrations/20260210-add-subscription-fields-to-users.js
/src/models/user.js
/src/controllers/subscriptionController.js
/src/routes/subscriptions.js
/src/index.js
/cron_subscription_checker.js
/.env.example
```

## Mobil Uygulama Entegrasyonu (React Native/Expo)

### 1. Kütüphane Kurulumu
```bash
npx expo install expo-in-app-purchases
```

### 2. Product ID Tanımlamaları
```javascript
// constants/products.js
export const SUBSCRIPTION_PRODUCTS = {
  ios: {
    monthly: 'com.spondylus.kampdefterim.monthly',
    yearly: 'com.spondylus.kampdefterim.yearly',
  },
  android: {
    monthly: 'com.spondylus.boltexponativewind.monthly',
    yearly: 'com.spondylus.boltexponativewind.yearly',
  }
};
```

### 3. Satın Alma Sonrası Backend'e Gönderme
```javascript
import * as InAppPurchases from 'expo-in-app-purchases';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Satın alma tamamlandığında
async function handlePurchaseComplete(purchase) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const API_URL = 'https://botanikakademi.com'; // Production API URL
    
    const requestBody = Platform.OS === 'ios' 
      ? {
          platform: 'ios',
          productId: purchase.productId,
          transactionReceipt: purchase.transactionReceipt,
          transactionId: purchase.transactionId,
        }
      : {
          platform: 'android',
          productId: purchase.productId,
          purchaseToken: purchase.purchaseToken,
          transactionId: purchase.orderId,
        };
    
    const response = await fetch(`${API_URL}/node/subscriptions/verify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Abonelik aktif edildi!', result.subscription);
      // UI güncelle, premium özellikleri aç
    } else {
      console.error('❌ Doğrulama hatası:', result.error);
    }
    
  } catch (error) {
    console.error('Backend iletişim hatası:', error);
  }
}

// Purchase listener kurulumu
useEffect(() => {
  const purchaseListener = InAppPurchases.setPurchaseListener(
    ({ responseCode, results, errorCode }) => {
      if (responseCode === InAppPurchases.IAPResponseCode.OK) {
        results?.forEach(purchase => {
          if (!purchase.acknowledged) {
            handlePurchaseComplete(purchase);
            InAppPurchases.finishTransactionAsync(purchase, true);
          }
        });
      }
    }
  );
  
  return () => {
    purchaseListener?.remove();
  };
}, []);
```

### 4. Abonelik Durumu Kontrolü
```javascript
async function checkSubscriptionStatus() {
  const token = await AsyncStorage.getItem('userToken');
  
  const response = await fetch('https://botanikakademi.com/node/subscriptions/status', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  const { subscription } = await response.json();
  
  if (subscription.isActive) {
    console.log('Premium kullanıcı:', subscription);
    // offline_enabled: true
    // offline_radius_km: 20 veya 50
  }
}
```

## Destek

Sorun yaşarsanız veya yardıma ihtiyacınız varsa:
1. Logları kontrol edin
2. Environment variables'ları doğrulayın
3. Migration'ların çalıştığından emin olun
4. Test mode ile başlayın

---

**Son Güncelleme:** 2026-02-13
