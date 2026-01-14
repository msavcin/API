# Frontend API Değişiklikleri - 14 Ocak 2026

## 1. Harita Tile Sistemi (CartoDB)

### ✅ Değişiklik
- OpenStreetMap tile proxy kaldırıldı
- CartoDB Voyager haritaları kullanılıyor
- Redis cache ile performans iyileştirmesi

### 📍 Endpoint
```
GET /node/tiles/{z}/{x}/{y}.png
```

### 🔧 Frontend Değişikliği
Leaflet tile layer URL'ini değiştirin:

**ESKİ:**
```javascript
const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
});
```

**YENİ:**
```javascript
const tileLayer = L.tileLayer('https://api.kampdefterim.com/node/tiles/{z}/{x}/{y}.png', {
  attribution: '© CartoDB © OpenStreetMap contributors',
  maxZoom: 19
});
```

### 🎯 Özellikler
- Token gönderilirse offline kontrolü yapılır
- Token yoksa public olarak çalışır
- Redis cache ile hızlı yanıt
- 7 gün browser cache

---

## 2. Offline Harita Özellikleri

### ✅ Yeni Kullanıcı Alanları
Users tablosuna eklendi:
- `offline_enabled` (boolean) - Offline özelliği aktif mi?
- `offline_radius_km` (integer) - İzin verilen yarıçap (km)

### 📍 Varsayılan Değerler
- **Superadmin:** offline_enabled=true, radius=50km
- **Normal kullanıcılar:** offline_enabled=false, radius=20km

### 🔐 Tile Endpoint Kontrolü
Authorization header ile token gönderilirse:
```javascript
headers: {
  'Authorization': `Bearer ${token}`
}
```

- `offline_enabled=false` ise → **403 Forbidden** döner
- `offline_enabled=true` ise → Normal çalışır

---

## 3. /users/me Endpoint Güncellemesi

### ✅ Yeni Alanlar
Response'a eklenen alanlar:

```json
{
  "id": 1,
  "name": "...",
  "email": "...",
  "role": "...",
  "offline_enabled": true,
  "offline_radius_km": 50,
  ...
}
```

### 🔧 Frontend Kullanımı
```javascript
const checkOfflineFeature = async () => {
  const response = await fetch('/node/users/me', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const user = await response.json();
  
  if (user.offline_enabled) {
    console.log(`Offline özelliği aktif, yarıçap: ${user.offline_radius_km}km`);
    // Offline harita indirmeyi etkinleştir
  } else {
    console.log('Offline özelliği pasif');
    // Offline harita indirmeyi devre dışı bırak
  }
};
```

---

## 4. /announcements Endpoint - Incremental Sync

### ✅ Yeni Parametre: `updated_after`

### 📍 Kullanım
```
GET /node/announcements?updated_after=2026-01-10T00:00:00Z
```

### 🎯 Davranış
**updated_after parametresi varsa:**
- `updated_at >= updated_after` olan TÜM kayıtları döndürür
- Silinmiş (deleted=true) kayıtlar da dahildir
- Response'ta `deleted: true/false` flag'i eklenir

**Diğer parametreler:**
- `include_deleted=true` → Tüm kayıtlar
- Parametresiz → Sadece aktif kayıtlar

### 🔧 Frontend Incremental Sync Örneği
```javascript
const syncAnnouncements = async () => {
  // 1. Lokal DB'den son sync zamanını al
  const lastSync = await getLastSyncTime(); // örn: "2026-01-10T12:00:00Z"
  
  // 2. Backend'den güncellenmiş kayıtları çek
  const response = await fetch(
    `/node/announcements?updated_after=${lastSync}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const announcements = await response.json();
  
  // 3. Lokal DB'yi güncelle
  for (const announcement of announcements) {
    if (announcement.deleted || !announcement.aktif) {
      // Silinmiş kayıt - lokal DB'den kaldır
      await deleteLocalAnnouncement(announcement.id);
    } else {
      // Aktif kayıt - lokal DB'ye kaydet/güncelle
      await saveLocalAnnouncement(announcement);
    }
  }
  
  // 4. Sync zamanını güncelle
  await setLastSyncTime(new Date().toISOString());
};
```

### 📋 Response Örneği
```json
[
  {
    "id": 123,
    "title": "Aktif Duyuru",
    "message": "...",
    "aktif": true,
    "deleted": false,
    "updated_at": "2026-01-12T10:30:00Z",
    ...
  },
  {
    "id": 124,
    "title": "Silinmiş Duyuru",
    "message": "...",
    "aktif": false,
    "deleted": true,
    "updated_at": "2026-01-13T08:15:00Z",
    ...
  }
]
```

---

## 🚀 Test Önerileri

### 1. Harita Testi
- [ ] CartoDB tile'ları düzgün yükleniyor mu?
- [ ] Zoom in/out sorunsuz mu?
- [ ] Offline özelliği aktif kullanıcılar tile indirebiliyor mu?
- [ ] Offline pasif kullanıcılar 403 alıyor mu?

### 2. /users/me Testi
- [ ] offline_enabled ve offline_radius_km alanları geliyor mu?
- [ ] Değerler doğru mu?

### 3. /announcements Incremental Sync Testi
- [ ] updated_after ile sadece güncel kayıtlar geliyor mu?
- [ ] Silinmiş kayıtlar deleted=true ile işaretli mi?
- [ ] Lokal DB sync düzgün çalışıyor mu?

---

## 📞 Sorular?
Backend değişiklikleri ile ilgili sorularınız için iletişime geçin.

**Tarih:** 14 Ocak 2026
**Backend Version:** 1.3+
