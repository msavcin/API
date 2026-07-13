# Backend Integration Guide — AI Review Güncellemeleri

Aşağıda backend tarafında AI değerlendirme (AI review) sonucunun veritabanına kaydedilmesine ilişkin örnek SQL ve kritik notlar yer almaktadır.

Örnek güncelleme sorgusu:

```
UPDATE campgrounds 
SET 
  ai_review_evaluation = $1,
  ai_review_generated_at = NOW(),
  google_place_id = $2,
  last_google_sync_at = NOW(),
  rating = $3,
  review_count = $4,
  website = COALESCE($5, website),
  phone = COALESCE($6, phone),
  updated_at = NOW()
WHERE id = $7
```

- Kritik: AI değerlendirmesi yapıldığında `updated_at = NOW()` mutlaka güncellenmelidir. Mobil uygulamadaki delta sync (`updated_after` / `fetchAndStoreCampingAreasFromAPI`) bu alanı kontrol eder; güncelleme yapılmazsa client yeni değerlendirmeyi alamaz.

- Hangi işlemlerde bu uygulanmalı: değerlendirme (evaluate), silme (delete), aktif/pasif toggle işlemleri ve toplu değerlendirme (batch evaluate) gibi AI review ile ilgili her değişiklikte `updated_at` set edilmelidir.

- Ek: Google Places veya AI hatalarında senkronizasyon kesilmemeli; hatalar loglanır ve gerekiyorsa `force=true` ile tekrar deneme mantığı uygulanır.
