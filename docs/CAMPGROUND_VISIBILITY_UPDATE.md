# Kamp Alanı Görünürlük Kuralları ve Frontend Uyum Raporu

Bu doküman, backend tarafında yapılan yeni görünürlük filtrelemeleriyle ilgili ayrıntıları ve frontend ekibinin uygulamasını güncellerken dikkat etmesi gereken noktaları içerir.

---

## 1. Arka Uçta Yapılan Değişiklikler

1. **`visibility` mantığı SQL tarafına alındı**
   - Artık `Campground.findAll({ where })` sorgusu, aşağıdaki koşulları içerir:

     ```sql
     WHERE status='active' AND deleted=0
       AND (
         visibility='public'
         OR owner_id IS NULL            -- sistem kayıtları
         OR (visibility='private' AND owner_id = :userId)
         OR (visibility='friends' AND (
                owner_id = :userId
                OR friend_user_ids::jsonb @> '["'||:userId||'"]'
             ))
         OR (visibility='community' AND community_id IN (:userCommunityIds))
         -- superadmin kullanıcılar için bu blok atlanıyor
       )
     ```

   - Bu filtreler hem tam liste (`/campgrounds`) hem de delta
     senkronizasyonu (`updated_after` + `include_deleted`) sırasında uygulanır.

2. **`community_id` alanı**
   - Artık `campgrounds` tablosuna `community_id` sütunu eklendi.
   - Backend kodu hem yaratma hem de güncellemede bu alanı alıp
     integer'a çevirmekte. Görünürlüğü `community` olan kayıtlar yalnızca
     kullanıcının üyeliği olan toplulukla eşleşiyorsa döndürülür.

3. **`friend_user_ids` validasyonu**
   - Dönen kayıtlar içinde bu alan JSON parse edilemiyorsa 500 hata döndürülür.
     Böylece bozuk veriler client tarafında "görünmeme" olarak
     kaybolmaz, sürecin temizlenmesi gerektiği anlaşılır.

4. **Diğer iyileştirmeler**
   - Tüm sorgular artık varsayılan olarak sadece `status='active'` ve
     `deleted=0` olanları getiriyor. `deleted` parametresi ile bu davranış
     ezilebilir.
   - Super‑admin rollerine filtre uygulanmıyor; bu kullanıcılar tüm kayıtları
     görebiliyor.

---

## 2. Frontend'de Yapılması Gereken Güncellemeler

Aşağıdaki maddeler UI/JS kodunun backend ile uyumlu çalışması için önemlidir.

1. **Kamp alanı yaratma / güncelleme formları**
   - Formlarda `community_id` alanı bulunmalı; üst seviye bir seçim ya da
     kullanıcıya atanmış tek topluluk gösterilebilir.
   - Bu değer JSON olarak gönderilmeden önce **tam sayıya çevrilmeli**
     (converted on backend zaten, ama client doğru tip göndermeli).

2. **Görünürlük seçeneklerini sunarken**
   - `visibility` seçenekleri: `public`, `community`, `friends`, `private`.
   - `community` seçildiğinde `community_id` zorunlu hale gelmeli.
   - `friends` seçeneğinde, kullanıcıya ait arkadaş listesi `friend_user_ids`
     dizisine eklenmeli; backend'e JSON string olarak gönderilir.

3. **Listeleme ve senkronizasyon**
   - Normal listeleme sırasında ekstra filtreler eklemeye gerek yok; backend
     gerekli kontrolleri yapıyor.
   - Delta (güncelleme sonrası fetch) için `updated_after` parametresiyle
     çağrı yaparken `include_deleted` kullanılması hâlinde yine aynı görünürlük
     kontrolleri uygulanır; client silinmiş öğeleri manuel filtrelemek zorunda
     değil.

4. **Hata işleme**
   - Sunucu `500` dönerse mesaj kutusunda ya da console'da `friend_user_ids`
     ile ilgili bozuk veri uyarısını göstermelisiniz; bu bir veri kalitesi
     sorunu olduğunu belirtir.
   - Diğer durumlarda tipik `403/404` kontrolleri devam eder.

5. **Topluluk üyelik durumunun güncel tutulması**
   - Kullanıcının hangi topluluklara üye olduğu client tarafında da bilinmeli;
     çünkü `visibility='community'` kayıtlar sadece o topluluk id'leri
     üzerinden filtreleniyor.
   - Üyelik değişiklikleri (katılma/ayrılma) sonrası cache ya da local state
     güncellenmelidir.

6. **Test planı önerisi**
   - Tüm görünürlük tipleri için hem sahibin hem farklı kullanıcıların
     listeleri alınarak beklenen sonuçlar doğrulanmalı.
   - `community` görünürlüğü için, kullanıcı farklı bir topluluğa aitse
     kayıt görmemeli; doğru topluluğa aitse görmeli.
   - Arkadaş kısıtlamasında, `friend_user_ids`'e eklenen/çıkarılan
     kullanıcıların erişimi test edilmeli.
   - `deleted_at` senkronizasyonu sırasında da aynı görünürlük kuralları
     korunmalı.

---

### Ek Notlar

* Backend kodundaki `owner_username` ekleme logic'i değişmedi; frontend bu
  alanı doğrudan kullanmaya devam edebilir.
* Eğer ileride yeni görünürlük türleri eklenecekse (ör. `group`, `region`),
  aynen SQL içinde genişletilmesi ve frontendde ilgili seçim eklenmesi gerekir.
* Bu rapor frontend ekip üyelerine e‑posta ile veya proje yönetim sistemine
  (Jira/Trello) bildirilmelidir; kod qoşma sırasında PR açıklamasına referans
  eklemek yararlı olacaktır.

---

Bu rapor, backend değişikliklerinin etkilerini ve frontend tarafında nereye
dokunulması gerektiğini kapsamlı biçimde ortaya koyar. Lütfen herhangi bir
şüphe durumunda backend ekibiyle irtibata geçiniz.