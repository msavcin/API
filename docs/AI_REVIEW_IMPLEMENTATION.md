# AI Review Implementation — Back-end Detayları

Desteklenen endpoint'ler:

- `POST /camping-areas/batch-evaluate-reviews` - Toplu değerlendirme (superadmin)
- `GET /camping-areas/:id/ai-review` - Alan için değerlendirmeyi getirir
- `GET /camping-areas/eligible-for-review` - Değerlendirilebilir alanları listeler
- `DELETE /camping-areas/:id/ai-review` - Değerlendirmeyi siler (superadmin)
- `PUT /camping-areas/:id/ai-review-toggle` - AI review'u aktif/pasif yapar (superadmin)

⚠️ **Kritik**: Tüm AI review işlemlerinde (evaluate, delete, toggle) `updated_at = NOW()` mutlaka güncellenmeli. Aksi takdirde mobil app'teki delta sync yeni değerlendirmeleri alamaz.

## Frontend entegrasyon notları

- Frontend `lib/aiReviewApi.ts` üzerinden değerlendirme isteği atar.
- Zaman damgası `ai_review_generated_at` ve `updated_at` sayesinde client delta sync ile değişiklikleri alır.
- Cooldown ve günlük limit kontrolleri backend tarafından yapılır; frontend `force` parametresiyle süreci yeniden tetikleyebilir (sadece yetkili kullanıcılar).
