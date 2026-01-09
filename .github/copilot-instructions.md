
# AI Agent için Kod Tabanı Rehberi

## Mimari ve Bileşenler
- **Node.js + Express** tabanlı REST API, Expo (React Native) istemcileriyle uyumlu.
- **Veri katmanı:** Sequelize ile PostgreSQL. Tüm modeller `src/models/` altında, ilişkiler ve tipler burada tanımlı.
- **Modüler router yapısı:** Tüm endpointler `src/routes/` altında, controller'lar ise `src/controllers/` dizininde.
- **Kimlik doğrulama:** JWT tabanlı, `src/middleware/auth.js` ile. Korumalı endpointlerde `authMiddleware` zorunlu.
- **Rol yönetimi:** `leaderMiddleware` ve JWT içindeki `role` alanı ile topluluk/süperadmin ayrımı.
- **Dosya yükleme:** Multer ile, S3 entegrasyonu için `src/utils/s3.js` kullanılır.
- **Özel entegrasyon:** OpenStreetMap tile proxy (`src/routes/tileProxy.js`) ve apicache ile cache.

## Geliştirici İş Akışları
- **Başlatma:** `npm install` ve `npm run dev` (nodemon ile hot reload).
- **Veritabanı bağlantısı:** Ayarlar `src/models/sequelize.js` ve `config/config.json` dosyalarında.
- **Migration/seeder:** Standart Sequelize CLI ile (`migrations/`, `seeders/`).
- **Test:** Otomatik test altyapısı yok, API endpointleri doğrudan curl/Postman ile test edilir.
- **Debug:** Konsol logları yaygın, özellikle controller ve middleware'lerde.

## Proje Konvansiyonları
- **Endpoint prefix:** Tüm API endpointleri `/node/` ile başlar (örn. `/node/users`, `/node/campgrounds`).
- **Controller pattern:** Her router, ilgili controller fonksiyonlarını çağırır. Örnek: `src/routes/campgrounds.js` → `src/controllers/campgroundController.js`.
- **Model erişimi:** Modeller genellikle `db.ModelName || require('./modelName')` şeklinde çağrılır.
- **JWT ile kimlik doğrulama:** Tüm korumalı endpointlerde `authMiddleware` kullanılır. Token `Authorization: Bearer <TOKEN>` ile iletilir.
- **Rol kontrolü:** Bazı işlemler (örn. topluluk lideri, süperadmin) ek middleware ile sınırlandırılır.
- **Veri tipleri:** Bazı alanlar (örn. `facilities`, `amenities`, `images`, `tags`) JSON-string veya ARRAY olarak saklanır. Controller'da parse/stringify işlemleri yaygın.
- **Dosya yükleme:** Avatar ve resim yükleme için presigned S3 URL'leri kullanılır.

## Entegrasyonlar ve Bağımlılıklar
- **AWS S3:** Dosya yükleme ve presigned URL için `src/utils/s3.js`.
- **OpenStreetMap:** Tile proxy ve cache için `src/routes/tileProxy.js`.
- **JWT:** Kimlik doğrulama için `jsonwebtoken`.
- **Sequelize:** Model, migration ve veri işlemleri için ana ORM.

## Örnekler
- Kullanıcı kaydı: `/node/users/register` (POST)
- Giriş: `/node/users/login` (POST)
- Kamp alanı CRUD: `/node/campgrounds` (GET/POST/PUT/DELETE)
- Token yenileme: `/node/users/refresh-token` (POST)
- Dosya yükleme: `/node/users/avatar/upload-url` (POST)

## Anahtar Dosyalar/Dizinler
- `src/index.js`: Uygulama giriş noktası, router'ların bağlandığı yer.
- `src/routes/`: Tüm endpoint router'ları.
- `src/controllers/`: İş mantığı ve veri işlemleri.
- `src/models/`: Sequelize modelleri.
- `src/middleware/`: JWT, rol ve dosya yükleme middleware'leri.
- `src/utils/s3.js`: S3 entegrasyonu.
- `README.md`: Kurulum ve temel kullanım.

---
Güncel ve kod tabanına özgü AI agent rehberi. Eksik veya belirsiz noktalar için lütfen geri bildirim verin.
