## Kamp Alanı (Campground) API - Minimal Spec

Aşağıda frontend için `POST /node/campgrounds` ve `PUT /node/campgrounds/:id` isteklerinde gönderilmesi gereken alanların önerilen sıralaması, tipleri ve kısa açıklamaları bulunmaktadır.

**Headers**:
- `Content-Type: application/json`
- `Authorization: Bearer <TOKEN>` (korumalı endpointler için)

**Zorunlu alanlar (backend kontrolü)**:
1. `name` (string) — zorunlu
2. `latitude` (float) — zorunlu
3. `longitude` (float) — zorunlu
4. `type` (string) — model `allowNull: false`

**Visibility ve ilgili alanlar (önemli sıra ve kurallar)**
5. `visibility` (string) — değerler: `private`, `public`, `community`, `friends`.
   - Eğer `source_id === 0` (yerel kullanıcı) ve `visibility` verilmezse backend `private` atar.
6. `friend_user_ids` (array of ints OR JSON-string) — **sadece** `visibility: "friends"` için gönderin. Backend `friend_user_ids` sütununa JSON-string kaydeder ve `campground_friend_access` tablosunu sync eder.
7. `community_id` (integer) — `visibility: "community"` durumunda backend, kullanıcının üyesi olduğu topluluğu otomatik atar. Frontend göndermek zorunda değil; gönderilirse backend membership ile uyumlu olmalı.

**Diğer önerilen alanların sıralaması** (opsiyonel / normalize edilecek türler notlarıyla):
8. `owner_id` (integer) — `source_id === 0` ise zorunlu
9. `source_id` (integer) — opsiyonel, senkronizasyon için kullanılabilir
10. `external_id` (string) — opsiyonel, idempotency için
11. `description` (string)
12. `website` (string)
13. `phone` (string)
14. `opening_hours` (array of strings OR JSON-string) — DB'ye string(JSON) olarak kaydedilir
15. `capacity` (integer)
16. `fee` (number|boolean|string) — controller normalize eder, veritabanına integer (0/1) veya sayısal değer olarak kaydeder
17. `status` (string)
18. `rating` (float)
19. `review_count` (integer)
20. `price_range` (string)
21. `facilities` (array OR JSON-string) — DB'de JSON-string
22. `accessibility` (array OR JSON-string) — DB'de JSON-string
23. `social_media` (object OR JSON-string) — DB'de JSON-string
24. `amenities` (array OR JSON-string) — controller çeşitli tipleri normalize eder, DB'de JSON-string
25. `images` (array OR JSON-string) — DB'de JSON-string
26. `photo_links` (array OR JSON-string) — controller kesinlikle string (JSON) olarak saklar
27. `tags` (object OR JSON-string) — boş ise backend `'{}'` atıyor
28. `created_at` (ISO string) — gönderilmezse backend atar
29. `updated_at` (ISO string) — çakışma kontrolü için kullanılır; eğer gönderilen `updated_at` sunucudakinden eskiyse update/delete 409 döndürür

---

Örnek `POST /node/campgrounds` gövdesi (community örneği):

```json
{
  "name": "Kamp Alanı Adı",
  "latitude": 39.9334,
  "longitude": 32.8597,
  "type": "tent",
  "visibility": "community",
  "owner_id": 101,
  "source_id": 0,
  "description": "Kısa açıklama",
  "facilities": ["wc","duş"],
  "amenities": ["wifi"],
  "images": ["s3key1","s3key2"],
  "photo_links": ["https://.../1.jpg"],
  "tags": {"season":"summer"}
}
```

Örnek `POST /node/campgrounds` gövdesi (friends örneği):

```json
{
  "name": "Arkadaş Kampı",
  "latitude": 39.9,
  "longitude": 32.8,
  "type": "glamping",
  "visibility": "friends",
  "friend_user_ids": [45, 67],
  "owner_id": 101
}
```

Örnek `PUT /node/campgrounds/:id` güncelleme notları:
- Gönderilecek alanlar `updatableFields` listesine uygun olmalı (controller içinde): `name`, `latitude`, `longitude`, `type`, `description`, `website`, `phone`, `opening_hours`, `capacity`, `fee`, `status`, `rating`, `review_count`, `price_range`, `facilities`, `accessibility`, `social_media`, `amenities`, `images`, `tags`, `booking_url`, `contact_email`, `last_verified`, `visibility`, `external_id`, `source_id`, `photo_links`, `friend_user_ids`.
- Eğer visibility `community` ise backend membership kontrolü yapıp `community_id` atar; membership yoksa 400 döner.
- Eğer visibility `friends` ise `friend_user_ids` beklenir; backend `campground_friend_access` tablosunu sync eder.
- `updated_at` göndererek optimistic concurrency kontrolü kullanılabilir; eski tarih gönderilirse 409 dönebilir.

---

Kısa Özet / Davranış Kuralları:
- `name`, `latitude`, `longitude` zorunlu; `owner_id` `source_id===0` için zorunlu.
- `visibility: "community"` için frontend genelde `community_id` göndermek zorunda değil; backend kullanıcının üyeliğine göre atama yapıyor.
- Dizi/obje alanları için ya gerçek dizi gönderin ya JSON-string; controller her iki durumu da normalize ediyor fakat frontend için diziler tercih edin.
- `friend_user_ids` mutlaka kullanıcı ID'leri array'i olmalı (veya JSON-string) — backend hem sütuna yazar hem `campground_friend_access` tablosunu günceller.

Dosya oluşturuldu: `docs/campground_api_spec.md`
