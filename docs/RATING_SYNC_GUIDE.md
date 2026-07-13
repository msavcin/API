# Rating Sync Guide — AI Review ve Delta Sync

- `ai_review_generated_at`: Değerlendirme zamanı
- `updated_fields`: AI'nın tespit ettiği güncel bilgiler (rating, facilities, price_range, vb.)

1. AI'dan elde edilen sonuçlar local database'e kaydedilir.
2. AI review hataları senkronizasyonu engellemez (sadece uyarı loglanır).
3. Cooldown durumunda (6 ay) AI review atlanır.

⚠️ **Google Places API Kısıtlaması**: Backend, Google Places API'den maksimum 5 örnek yorum alır. Ancak `user_ratings_total` ile toplam yorum sayısı alınır ve AI değerlendirmesine dahil edilir.

⚠️ **Delta Sync için Kritik**: Backend'de AI değerlendirmesi yapılırken mutlaka `updated_at = NOW()` alanı güncellenmelidir. Aksi takdirde client tarafındaki delta sync (`fetchAndStoreCampingAreasFromAPI` ile `updated_after` parametresi) yeni değerlendirmeyi alamaz ve detay sayfasında güncel bilgiler gösterilmez.

Not: AI review evaluation 6 aylık cooldown periyoduna sahiptir. Bu süre dolmadan aynı kamp alanı için tekrar AI review yapılmaz (superadmin force parametresi hariç).
