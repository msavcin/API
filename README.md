# Expo ile Uyumlu PostgreSQL API

Bu proje, Expo (React Native) uygulamanız ile haberleşebilen, PostgreSQL veritabanı kullanan bir Node.js (Express) API örneğidir.

## Kurulum

1. `package.json` içindeki bağımlılıkları yükleyin:
   ```sh
   npm install
   ```
2. `src/models/index.js` dosyasındaki veritabanı adı, kullanıcı adı ve şifreyi kendi PostgreSQL bilgilerinizle değiştirin.
3. API'yi başlatın:
   ```sh
   npm run dev
   ```


## Kullanım

- `/campgrounds` endpointi ile kamp alanı ekleme, listeleme, güncelleme ve silme işlemleri yapılabilir.
- Expo uygulamanızdan HTTP istekleriyle bu endpointlere erişebilirsiniz.


### Örnek Sorgular


#### 1. Kullanıcı Kaydı
```sh
curl -X POST http://localhost:3000/auth/register \
   -H "Content-Type: application/json" \
   -d '{"name": "testuser", "password": "testpass123"}'
```

#### 2. Giriş ve Token Alma
```sh
curl -X POST http://localhost:3000/auth/login \
   -H "Content-Type: application/json" \
   -d '{"name": "testuser", "password": "testpass123"}'
```
Yanıt olarak gelen `token` değerini bir sonraki adımda kullanın.

#### 3. Korumalı Endpoint (Tüm kamp alanlarını listele)
```sh
curl http://localhost:3000/campgrounds \
   -H "Authorization: Bearer <TOKEN>"
```
`<TOKEN>` yerine girişte aldığınız JWT token'ı yazın.

## Notlar
- Geliştirme ortamında `nodemon` ile otomatik yeniden başlatma sağlanır.
- Daha fazla tablo ve ilişki eklemek için `src/models` klasörünü genişletebilirsiniz.
