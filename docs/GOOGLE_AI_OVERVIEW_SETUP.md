# Google AI Overview Entegrasyonu - Kurulum Rehberi

## 📋 Özet
Google'ın AI Overview (Gemini) yanıtları artık AI Review değerlendirmelerine otomatik olarak dahil ediliyor.

## ✅ Yapılan Değişiklikler

### 1. Yeni Dosyalar
- **`src/services/googleAIOverviewService.js`** — SerpAPI kullanarak Google AI Overview çeker
- **`package.json`** — `google-search-results-nodejs` paketi eklendi ✅ (otomatik yüklendi)

### 2. Güncellenen Dosyalar
- **`src/controllers/aiReviewController.js`** — `evaluateWithAI()` fonksiyonuna Google AI Overview entegrasyonu
- **`.env`** — SERPAPI_KEY ve GROQ_API_KEY notları eklendi

## 🔧 Kurulum Adımları

### 1. Groq API Key'i Düzeltin
```bash
# 1. https://console.groq.com/keys adresine gidin
# 2. Yeni API key oluşturun
# 3. .env dosyasını açın ve güncelleyin:
GROQ_API_KEY=gsk_YENİ_ANAHTARINIZ
```

### 2. SerpAPI Key Alın (Opsiyonel - Google AI Overview için)
```bash
# 1. https://serpapi.com/users/sign_up - hesap oluşturun
# 2. Dashboard'dan API key alın (ücretsiz 100 search/ay)
# 3. .env dosyasına ekleyin:
SERPAPI_KEY=your_serpapi_key_here
```

**NOT:** `SERPAPI_KEY` yoksa sistem sessizce atlar, Google AI Overview olmadan çalışır.

### 3. Sunucuyu Yeniden Başlatın
```powershell
# Dev mode
npm run dev

# Production
npm start
```

## 🎯 Nasıl Çalışıyor?

### Önceki Akış:
```
Google Places Reviews → AI Evaluation → Sonuç
```

### Yeni Akış:
```
1. Google Places Reviews
2. Web Research (OSM + Google Places)
3. Google AI Overview (SerpAPI) ← YENİ!
4. AI Evaluation (JSON format)
5. Sonuç
```

### Örnek Prompt (AI'ya gönderilen):
```
Kamp alanı: John's Beach Camping
Konum: Antalya, Turkey

Ek bilgiler (web araştırmasından):
- Google Puanı: 4.5/5 (128 değerlendirme)
- Tesisler: duş, tuvalet, elektrik

Google AI Özeti:
John's Beach Camping is a popular beachfront camping site known for its 
stunning sunset views and clean facilities. Visitors praise the friendly 
staff and convenient location near local restaurants.

İlgili Sorular:
- Is John's Beach Camping suitable for families?
- Does John's Beach Camping allow pets?
- What are the best months to visit John's Beach Camping?

Kullanıcı yorumları (15 adet):
[Yorum 1] 5/5: Harika bir yer...
...
```

## 📊 Maliyet & Limitler

### SerpAPI Fiyatlandırma:
- **Ücretsiz Tier**: 100 search/ay
- **Developer Plan**: $50/mo - 5,000 search
- **Production Plan**: $150/mo - 25,000 search

### Cache Stratejisi:
- AI Overview sonuçları **7 gün** cache'lenir
- Aynı kamp alanı için tekrar API çağrısı yapılmaz
- Maliyet optimizasyonu için Redis kullanılır

## 🧪 Test

### Manuel Test:
```powershell
# AI Review endpoint'ini çağırın
curl -X POST http://localhost:3000/node/campgrounds/evaluate-review \
  -H "Content-Type: application/json" \
  -d '{"campground_id": 123, "use_llm": true}'
```

### Log Kontrolü:
```
[AIReview] Google AI Overview çekiliyor: John's Beach Camping
[AI_OVERVIEW] SerpAPI query: John's Beach Camping Antalya camping reviews
[AI_OVERVIEW] Sonuç cache'lendi: ai_overview:john's beach camping:antalya
[AIReview] Google AI Overview eklendi (450 karakter)
[AIReview] LLM etkin. Seçilen provider: deepseek (OFFPEAK)
[DEEPSEEK] API Response yapısı: {hasChoices: true, ...}
[AIReview] deepseek başarılı JSON yanıtı verdi.
```

## ⚠️ Önemli Notlar

1. **SERPAPI_KEY opsiyonel**: Yoksa sistem normal çalışır, sadece Google AI Overview atlanır
2. **Rate Limit**: SerpAPI ücretsiz tier hızlıca tükenebilir, production'da ücretli plan önerilir
3. **Cache**: AI Overview'lar 7 gün cache'lenir, güncel tutmak için manuel cache temizliği gerekebilir
4. **Dil**: SerpAPI `hl=tr` ve `gl=tr` ile Türkçe sonuçlar getiriyor

## 🔄 Fallback Mekanizması

Eğer AI Overview bulunamazsa:
1. İlk organik search sonucunun snippet'i kullanılır
2. Hiç sonuç yoksa sistem normal devam eder (sadece Google Places yorumları)

## 📝 Sonuç

✅ Google AI Overview entegrasyonu tamamlandı  
✅ Syntax validation başarılı  
✅ Otomatik cache sistemi aktif  
✅ Fallback mekanizması hazır  
🔑 GROQ API key'i güncellemeniz gerekiyor  
🔑 SERPAPI key'i almak opsiyonel (ama önerilir)
