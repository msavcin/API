# AI Değerlendirme Sistemi — Frontend Entegrasyon Raporu

## 1. Genel Bakış

Backend'de kamp planlayıcısı için bir **AI değerlendirme endpoint'i** oluşturuldu.
Mobile tarafta (Expo / React Native) bu endpoint'e istek atarak kullanıcıya
şu konularda Türkçe AI yorumu sunabilirsiniz:

- 🌤️ Hava durumu değerlendirmesi
- 🚫 Valilik duyurularına göre kamp yasağı / güvenlik uyarıları
- 📍 Alternatif yakın kamp alanı önerileri
- 🛣️ Yol / güzergah durumu (veri gönderilirse)
- 💡 Genel tavsiyeler

---

## 2. Endpoint Bilgisi

| Alan | Değer |
|------|-------|
| **Method** | `POST` |
| **URL** | `BASE_URL/node/planner/ai-evaluate` |
| **Auth** | `Authorization: Bearer <JWT_TOKEN>` (zorunlu) |
| **Content-Type** | `application/json` |
| **Timeout önerisi** | 60–90 saniye (LLM işlemi zaman alabilir) |

---

## 3. Request Body

```jsonc
{
  "planData": {
    // --- ZORUNLU ---
    "startDate": "2026-06-15",          // Kamp başlangıç tarihi (YYYY-MM-DD)
    "endDate":   "2026-06-18",          // Kamp bitiş tarihi (YYYY-MM-DD)
    "campType":  "çadır",               // Kamp türü (çadır | karavan | bungalov | ...)

    // --- ZORUNLU (AI değerlendirmesi için) ---
    "campingArea": {
      "id":   123,                      // DB'deki campground id
      "name": "Ölüdeniz Kamp Alanı",
      "lat":  36.5500,
      "lng":  29.1167,
      "type": "çadır"
    },

    // --- OPSIYONEL ama önerilen ---
    "valilikId": 48,                    // Duyuru filtrelemesi için (Muğla = 48 vb.)

    "weather": {                        // İstemci tarafında zaten hava verisi varsa gönder
      "days": [
        {
          "date":                "2026-06-15",
          "maxTemp":             28,
          "minTemp":             18,
          "pop":                 20,    // Yağış olasılığı (%)
          "wind_kph":            15,
          "text":                "Parçalı bulutlu"
        }
        // ... diğer günler
      ],
      "summary": "Genel olarak güneşli"
    },

    // --- OPSIYONEL ---
    "userLocation": {
      "lat": 36.8,
      "lng": 28.9
    },

    "routeInfo": "D400 üzerinde yol yapım çalışması var, Fethiye güzergahı önerilir."
    // string veya { distance_km, duration_min, warnings: [] } objesi olabilir
  }
}
```

> **Not:** `weather` verisini göndermezseniz sistem yalnızca duyurular ve alternatif alanlar üzerinden değerlendirme yapar. `valilikId` gönderilmezse duyuru modülü devre dışı kalır.

---

## 4. Başarılı Response

**HTTP 200**

```jsonc
{
  "evaluation": "## 🌤️ Hava Durumu Değerlendirmesi\nSeçtiğiniz tarihler için hava ...",
  "generatedAt": "2026-06-10T14:32:00.000Z",
  "modules": ["weather", "announcements", "alternatives"],
  "cached": false,
  "fallback": false
}
```

| Alan | Tip | Açıklama |
|------|-----|----------|
| `evaluation` | `string` | LLM'den gelen Türkçe değerlendirme metni (Markdown formatında) |
| `generatedAt` | `string` | ISO 8601 zaman damgası |
| `modules` | `string[]` | Aktif olan prompt modülleri |
| `cached` | `boolean` | `true` ise aynı plan için önceden üretilmiş sonuç döndürüldü |
| `fallback` | `boolean` | `true` ise LLM yanıt veremedi, kural tabanlı sonuç döndürüldü |

| `remaining` | `number` | Kullanıcının o gün için kalan değerlendirme hakkı |
| `limit` | `number` | Günlük maksimum değerlendirme hakkı (sunucu tarafı ayarı) |

---

## 5. Hata Yanıtları

| HTTP | `error` | Sebep |
|------|---------|-------|
| `400` | `"planData alanı zorunlu"` | Body'de `planData` yok |
| `401` | `"Token gerekli"` | Authorization header eksik |
| `403` | `"Geçersiz token"` | JWT süresi dolmuş ya da hatalı |
| `500` | `"Değerlendirme sırasında bir hata oluştu"` | Beklenmeyen sunucu hatası |

---

## 6. Frontend Kod Örneği (TypeScript / Expo)

### `lib/aiEvaluationApi.ts`

```typescript
import { BASE_URL } from '../constants/api';

export interface CampingArea {
  id: number;
  name: string;
  lat: number;
  lng: number;
  type: string;
}

export interface WeatherDay {
  date: string;
  maxTemp: number;
  minTemp: number;
  pop: number;        // yağış olasılığı %
  wind_kph: number;
  text: string;
}

export interface AiEvaluatePayload {
  startDate: string;
  endDate: string;
  campType: string;
  campingArea: CampingArea;
  valilikId?: number | string;
  weather?: { days: WeatherDay[]; summary?: string };
  userLocation?: { lat: number; lng: number };
  routeInfo?: string | object;
}

export interface AiEvaluateResult {
  evaluation: string;
  generatedAt: string;
  modules: string[];
  cached: boolean;
  fallback: boolean;
  // Kullanıcının o gün için kalan değerlendirme hakkı (opsiyonel)
  remaining?: number;
  // Günlük limit (sunucu tarafı ayarı, opsiyonel)
  limit?: number;
}

export async function fetchAiEvaluation(
  token: string,
  planData: AiEvaluatePayload,
): Promise<AiEvaluateResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000); // 90 sn timeout

  try {
    const res = await fetch(`${BASE_URL}/node/planner/ai-evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ planData }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}
```

---

### Kullanım (Özet ekranında — `camp-plan.tsx` Adım 4)

```typescript
import { fetchAiEvaluation } from '../../lib/aiEvaluationApi';
import Markdown from 'react-native-markdown-display'; // veya Text

const [aiResult, setAiResult]   = useState<AiEvaluateResult | null>(null);
const [aiLoading, setAiLoading] = useState(false);
const [aiError, setAiError]     = useState<string | null>(null);

const handleAiEvaluate = async () => {
  setAiLoading(true);
  setAiError(null);
  try {
    const result = await fetchAiEvaluation(userToken, {
      startDate:   plan.startDate,
      endDate:     plan.endDate,
      campType:    plan.campType,
      campingArea: plan.campingArea,
      valilikId:   plan.campingArea.valilikId,  // varsa
      weather:     plan.weather,                // varsa
    });
    setAiResult(result);
  } catch (e: any) {
    // fallback UI hata mesajı — evaluateForecast() kural motoru zaten aktif
    setAiError(e.message ?? 'Değerlendirme alınamadı');
  } finally {
    setAiLoading(false);
  }
};

// JSX
{aiLoading && <ActivityIndicator />}
{aiError   && <Text style={styles.error}>{aiError}</Text>}
{aiResult  && (
  <View style={styles.aiCard}>
    <Text style={styles.aiTitle}>🤖 AI Değerlendirmesi</Text>
    <Markdown>{aiResult.evaluation}</Markdown>
    {aiResult.fallback && (
      <Text style={styles.badge}>Kural tabanlı sonuç</Text>
    )}
    {aiResult.cached && (
      <Text style={styles.badge}>Önbellekten</Text>
    )}
  </View>
)}
```

---

## 7. Önemli Notlar

### LLM yanıt süresi
Ollama ile `llama3.1:8b` modeli ilk istekte **10–40 saniye** sürebilir. Önbellek dolduktan sonra aynı plan için yanıt aniden (cached: true) gelir.  
UI'da kesinlikle **loading spinner + açıklayıcı metin** gösterin: `"AI değerlendirmeniz hazırlanıyor..."`

### Groq modeli - Önemli (güncelleme)
Groq tarafında "Llama 3.1 8B Instant" (örnek model adı: `llama-3.1-8b-instant`) modeli 16 Ağustos 2026 tarihinde kullanımdan kaldırılmıştır. Sunucuda veya ortam değişkenlerinde bu modele işaret eden `GROQ_MODEL` veya `GROQ_FALLBACK_MODELS` ayarları varsa güncelleyin.

Önerilen ikame model: `openai/gpt-oss-20b` — GroqCloud üzerinde desteklenen ve tavsiye edilen alternatiftir. Hız ve token bütçesi farklılıkları olabileceği için geçiş sonrası entegrasyon testleri yapın.

### Fallback davranışı
`"fallback": true` döndüğünde LLM çalışmıyor demektir. Bu durumda `evaluation` alanı kural tabanlı kısa bir metindir. Kullanıcıya gösterimde ayrım yapmak isterseniz `fallback` flag'ini kullanın.

### Cache
Aynı plan verisiyle gelen ikinci istek **anında** (`cached: true`) döner. Cache süresi sunucuda `AI_EVAL_CACHE_TTL_SEC` ile ayarlanmıştır (varsayılan 1 saat). Kullanıcının planı değiştiğinde önbellek otomatik olarak farklı bir key üretir.

### Evaluation metni formatı
`evaluation` alanı **Markdown** (`##` başlıklar, `-` listeler, emoji) içerir.  
`react-native-markdown-display` veya benzeri bir kütüphane ile render etmeniz önerilir.
