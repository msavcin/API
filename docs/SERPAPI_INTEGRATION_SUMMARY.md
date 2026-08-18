# SerpAPI Entegrasyonu Özeti

## 📋 Yapılan Değişiklikler

### 1. Cache Süresi Güncellemesi ✅
**Dosya:** `src/services/googleAIOverviewService.js`

```javascript
// ÖNCE: 7 gün
const AI_OVERVIEW_CACHE_TTL = 7 * 24 * 3600;

// SONRA: 6 ay (15552000 saniye)
const AI_OVERVIEW_CACHE_TTL = 180 * 24 * 3600;
```

**Faydası:** 
- SerpAPI sonuçları 6 ay cache'de tutulur
- Tekrar sorgu yapılmadan önce cache kontrol edilir
- Her iki değerlendirme sistemi aynı cache'i kullanır
- SerpAPI kotası korunur (ücretsiz tier: 100 search/ay)

---

### 2. AIOverviewModule Eklendi ✅
**Dosya:** `src/services/promptBuilder.js`

Yeni modül oluşturuldu:
```javascript
class AIOverviewModule {
  get id() { return 'aiOverview'; }

  buildPrompt(ctx) {
    const ao = ctx.aiOverview;
    if (!ao || !ao.aiOverview) return null;

    const lines = [];
    lines.push('[GOOGLE_AI_OZETI]');
    lines.push(ao.aiOverview);

    if (ao.relatedQuestions && ao.relatedQuestions.length > 0) {
      lines.push('');
      lines.push('Sikca Sorulan Sorular:');
      ao.relatedQuestions.forEach(q => lines.push(`- ${q}`));
    }

    return lines.join('\n');
  }
}
```

**Export güncellendi:**
```javascript
module.exports = {
  // ... diğer modüller
  AIOverviewModule,  // ← YENİ
};
```

---

### 3. Kamp Defterim Değerlendirmesine Entegrasyon ✅
**Dosya:** `src/controllers/plannerController.js`

#### 3.1. Import Eklendi
```javascript
const { fetchGoogleAIOverview } = require('../services/googleAIOverviewService');
const {
  // ... diğer modüller
  AIOverviewModule,  // ← YENİ
} = require('../services/promptBuilder');
```

#### 3.2. Paralel Fetch Güncellendi
```javascript
// ÖNCE: 2 paralel istek
const [bookingUrlContent, webResearch] = await Promise.all([
  fetchBookingUrlContent(enrichedCampingArea?.booking_url),
  researchLocation({ name: enrichedCampingArea?.name, lat: campLat, lng: campLng }),
]);

// SONRA: 3 paralel istek (Google AI Overview eklendi)
const [bookingUrlContent, webResearch, aiOverview] = await Promise.all([
  fetchBookingUrlContent(enrichedCampingArea?.booking_url),
  researchLocation({ name: enrichedCampingArea?.name, lat: campLat, lng: campLng }),
  fetchGoogleAIOverview(
    enrichedCampingArea?.name || campingArea?.name || 'Kamp Alanı',
    enrichedCampingArea?.formatted_address || `${campLat}, ${campLng}`
  ),
]);
```

#### 3.3. Context'e Eklendi
```javascript
const ctx = {
  // ... diğer alanlar
  webResearch: (webResearch?.osmTags || webResearch?.googlePlaces) ? webResearch : undefined,
  aiOverview: (aiOverview?.aiOverview || aiOverview?.relatedQuestions?.length) ? aiOverview : undefined,  // ← YENİ
};
```

#### 3.4. Builder'a Register Edildi
```javascript
// Her iki mod için (hiking ve normal kamp) AIOverviewModule eklendi
builder
  .register(new WeatherModule())
  // ... diğer modüller
  .register(new AIOverviewModule());  // ← YENİ
```

---

### 4. AI Review Değerlendirmesi (Zaten Entegre) ✅
**Dosya:** `src/controllers/aiReviewController.js`

Bu dosyada SerpAPI entegrasyonu zaten mevcuttu, sadece cache süresi güncellendi.

```javascript
// evaluateWithAI fonksiyonu içinde
let aiOverviewContext = '';

// Web research tamamlandıktan sonra
if (process.env.SERPAPI_KEY) {
  const aiOverviewData = await fetchGoogleAIOverview(campgroundName, location);
  aiOverviewContext = formatAIOverviewForPrompt(aiOverviewData);
  if (aiOverviewContext) {
    console.log(`[AIReview] Google AI Overview eklendi (${aiOverviewContext.length} karakter)`);
  }
}

// Prompt'a eklenir
const userPrompt = `Kamp alanı: ${campgroundName}
Konum: ${location}${webResearchContext}${aiOverviewContext}

Kullanıcı yorumları (${reviews.length} adet):
...`;
```

---

## 🎯 Kullanım Senaryoları

### Senaryo 1: AI Review Değerlendirmesi (Google Places Yorumları)
```javascript
POST /node/campgrounds/evaluate-review
{
  "campground_id": 123,
  "use_llm": true
}
```

**İçeride olan:**
1. Google Places yorumları çekiliyor
2. Web research (OSM + Google Places rating)
3. **Google AI Overview çekiliyor (cache'den veya SerpAPI'den)** ← YENİ
4. Tüm veriler LLM'e gönderiliyor
5. AI değerlendirmesi oluşturuluyor

### Senaryo 2: Kamp Defterim Planı Değerlendirmesi
```javascript
POST /node/planner/ai-evaluate
{
  "planData": {
    "startDate": "2026-06-15",
    "endDate": "2026-06-18",
    "campType": "çadır",
    "campingArea": {
      "id": 123,
      "name": "Lavender Garden Camping",
      "lat": 36.55,
      "lng": 29.11
    }
  }
}
```

**İçeride olan:**
1. Hava durumu bilgisi
2. Valilik duyuruları
3. Yakın alternatif kamplar
4. Web research (OSM + Google Places)
5. **Google AI Overview çekiliyor (cache'den veya SerpAPI'den)** ← YENİ
6. Tüm veriler LLM'e gönderiliyor
7. Detaylı kamp planı değerlendirmesi oluşturuluyor

---

## 🔍 Cache Mekanizması

### Cache Key Formatı
```javascript
// AI Overview için
`ai_overview:${campgroundName.toLowerCase()}:${location.toLowerCase()}`

// Örnek:
"ai_overview:lavender garden camping:antalya"
```

### Cache Kontrolü
1. İlk sorgu: SerpAPI'ye istek atılır, sonuç 6 ay cache'lenir
2. İkinci sorgu (6 ay içinde): Cache'den döner, SerpAPI kotası harcanmaz
3. 6 ay sonra: Tekrar SerpAPI'ye sorgu atılır, güncel bilgi alınır

### Cache Logging
```
[AI_OVERVIEW] SerpAPI query: Lavender Garden Camping 36.55, 29.11 camping reviews
[AI_OVERVIEW] Sonuç cache'lendi: ai_overview:lavender garden camping:36.55, 29.11
[PLANNER] Google AI Overview alındı (450 karakter)
```

Cache hit:
```
[AI_OVERVIEW] Cache hit: ai_overview:lavender garden camping:36.55, 29.11
[PLANNER] Google AI Overview alındı (450 karakter)
```

---

## 🧪 Test

### 1. Syntax Validation ✅
```powershell
node -e "require('./src/services/googleAIOverviewService.js'); require('./src/services/promptBuilder.js'); require('./src/controllers/plannerController.js'); require('./src/controllers/aiReviewController.js'); console.log('✓ All modules loaded');"
```

**Sonuç:** ✅ Tüm modüller başarıyla yüklendi

### 2. SerpAPI Testi
```powershell
# Test scripti ile manuel sorgu
node scripts/testSerpApi.js "Lavender Garden Camping reviews"

# Sonuç dosyası
cat tmp/serpapi-response.json
```

### 3. AI Review Testi (Yorumlu Kamp)
```powershell
# Sunucuyu başlat
npm run dev

# Yorumlu bir kamp için değerlendirme yap
curl -X POST http://localhost:3000/node/campgrounds/evaluate-review `
  -H "Content-Type: application/json" `
  -d '{"campground_id": 123, "use_llm": true}'
```

**Beklenen log:**
```
[AIReview] Google AI Overview çekiliyor: Turkey Boxing Federation Campground
[AI_OVERVIEW] SerpAPI query: Turkey Boxing Federation Campground ... camping reviews
[AI_OVERVIEW] Sonuç cache'lendi: ai_overview:...
[AIReview] Google AI Overview eklendi (450 karakter)
[AIReview] groq başarılı JSON yanıtı verdi.
```

### 4. Kamp Defterim Planı Testi
```powershell
# Frontend'den POST /node/planner/ai-evaluate endpoint'ine istek at
# Veya curl ile:
curl -X POST http://localhost:3000/node/planner/ai-evaluate `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_TOKEN" `
  -d '{
    "planData": {
      "startDate": "2026-08-20",
      "endDate": "2026-08-23",
      "campType": "çadır",
      "campingArea": {
        "id": 123,
        "name": "Lavender Garden Camping",
        "lat": 36.55,
        "lng": 29.11
      }
    }
  }'
```

**Beklenen log:**
```
[PLANNER] Web araştırması tamamlandı — OSM: false, Google: true
[PLANNER] Google AI Overview alındı (320 karakter)
[PLANNER] Mod: final | Provider: deepseek
[PLANNER] AI yanıtı alındı (4500 karakter)
```

---

## 📊 SerpAPI Sonuç Yapısı

### Örnek Yanıt Anahtarları
```json
{
  "search_metadata": {
    "id": "...",
    "status": "Success",
    "total_time_taken": 18.97
  },
  "search_parameters": {
    "engine": "google",
    "q": "Lavender Garden Camping reviews",
    "hl": "tr",
    "gl": "tr"
  },
  "search_information": {
    "total_results": 1250,
    "organic_results_state": "Results for exact spelling"
  },
  "answer_box": {
    "snippet": "Lavender Garden Camping offers stunning views...",
    "answer": "..."
  },
  "knowledge_graph": {
    "description": "Popular camping destination..."
  },
  "organic_results": [
    {
      "title": "...",
      "link": "...",
      "snippet": "..."
    }
  ],
  "related_questions": [
    {
      "question": "Is Lavender Garden Camping pet-friendly?"
    }
  ]
}
```

### Kullanılan Alanlar
- `answer_box.snippet` veya `answer_box.answer` → AI Overview
- `knowledge_graph.description` → Ek özet
- `organic_results[0].snippet` → Fallback
- `related_questions` → Sık sorulan sorular

---

## ⚙️ Environment Variables

```bash
# SerpAPI Key (opsiyonel - yoksa atlanır)
SERPAPI_KEY=your_serpapi_key_here

# Cache süreleri
AI_OVERVIEW_CACHE_TTL=15552000  # 6 ay (otomatik)
WEB_RESEARCH_CACHE_TTL=2592000  # 30 gün (mevcut)

# AI Providers
AI_PROVIDER=groq
PREVIEW_PROVIDER=groq
FINAL_PROVIDER=deepseek
```

---

## 📈 Avantajlar

### 1. Zengin İçerik
- Google AI Overview → Genel kampçı görüşleri
- Related Questions → Sık sorulan sorular
- Hem AI Review hem Kamp Defterim değerlendirmelerinde kullanılır

### 2. Maliyet Optimizasyonu
- 6 ay cache → SerpAPI kotası korunur
- Aynı kamp için tekrar sorgu yapılmaz
- Ücretsiz tier (100 search/ay) uzun süre yeter

### 3. Performans
- Paralel fetch → Toplam süre artmaz
- Cache hit → Anında sonuç
- Fallback mekanizması → AI Overview yoksa sistem çalışmaya devam eder

### 4. Tutarlılık
- Her iki değerlendirme sistemi aynı cache'i kullanır
- Aynı kamp için farklı yerlerden aynı AI Overview gelir
- Veri güncelliği 6 ay garanti edilir

---

## ⚠️ Önemli Notlar

1. **SERPAPI_KEY opsiyonel:** Yoksa sistem sessizce atlar, diğer değerlendirmeler çalışmaya devam eder
2. **Rate limit:** SerpAPI ücretsiz tier hızlıca tükenebilir, production'da ücretli plan önerilir
3. **Cache temizliği:** 6 ay sonra otomatik yenilenir, manuel temizleme gerekebilir
4. **Dil:** SerpAPI `hl=tr` ve `gl=tr` ile Türkçe sonuçlar getiriyor
5. **Error handling:** SerpAPI hatası verirse sistem fallback'e düşer, değerlendirme devam eder

---

## 🔄 Güncelleme Tarihi
14 Ağustos 2026

## 📝 Dosya Değişiklikleri
- ✅ `src/services/googleAIOverviewService.js` — Cache 6 ay
- ✅ `src/services/promptBuilder.js` — AIOverviewModule eklendi
- ✅ `src/controllers/plannerController.js` — SerpAPI entegrasyonu
- ✅ `src/controllers/aiReviewController.js` — Zaten entegre (cache güncellendi)
- ✅ `scripts/testSerpApi.js` — Test scripti (yeni)
