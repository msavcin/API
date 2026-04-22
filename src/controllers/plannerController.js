/**
 * Planner AI Evaluate Controller
 *
 * POST /node/planner/ai-evaluate
 *
 * Request body:
 * {
 *   planData: {
 *     startDate      : string        // Örn: "2026-06-15"
 *     endDate        : string        // Örn: "2026-06-18"
 *     campType       : string        // Örn: "çadır", "karavan"
 *     campingArea    : { id, name, lat, lng, type, external_id } // external_id varsa DB'den güncel veri çekilir
 *     userLocation   : { lat, lng }  // Opsiyonel
 *     weather        : { days: [...], summary: string }  // Opsiyonel, istemci gönderebilir
 *     valilikId      : number|string // Duyuru filtrelemesi için
 *     routeInfo      : any           // Opsiyonel yol durumu verisi
 *     [key]          : any           // Esnek ek alanlar (ileride yeni modüller için)
 *   }
 * }
 *
 * Response:
 * {
 *   evaluation  : string   // LLM'den gelen Türkçe değerlendirme metni
 *   generatedAt : string   // ISO zaman damgası
 *   modules     : string[] // Kullanılan prompt modülleri
 *   cached      : boolean  // Cache'den mi geldi?
 *   fallback    : boolean  // Kural tabanlı fallback mı kullanıldı?
 * }
 */

const db = require('../models');
const { Op } = require('sequelize');
const { AIAdapterFactory } = require('../services/aiAdapter');
const {
  PromptBuilder,
  WeatherModule,
  AnnouncementModule,
  AlternativeLocationModule,
  RouteConditionModule,
  HikingTrailModule,
  CampgroundDetailModule,
  BookingUrlModule,
} = require('../services/promptBuilder');
const { getCache, computeHash } = require('../services/cache');
const { getRouteInfo } = require('../services/routeService');

const CACHE_TTL = parseInt(process.env.AI_EVAL_CACHE_TTL_SEC ?? '3600', 10);
const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';

// Hybrid mod: hangi mode hangi provider'a gider
const HYBRID_PROVIDERS = {
  preview: process.env.PREVIEW_PROVIDER || 'groq',   // Groq/qwen3 → hızlı
  final:   process.env.FINAL_PROVIDER   || 'deepseek', // DeepSeek → detaylı
};

// ---------------------------------------------------------------------------
// Veri yardımcıları
// ---------------------------------------------------------------------------

/** Valilik ID'sine göre son 30 günlük aktif duyuruları getirir */
async function getRelevantAnnouncements(valilikId) {
  if (!valilikId) return [];
  try {
    const Announcement = db.Announcement || require('../models/announcement');
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const items = await Announcement.findAll({
      where: {
        valilik_id: String(valilikId),
        aktif: true,
        [Op.or]: [
          { created_at: { [Op.gte]: since } },
          { date: { [Op.gte]: since } },
        ],
      },
      order: [['created_at', 'DESC']],
      limit: 6,
      attributes: ['id', 'title', 'date', 'created_at'],
    });
    return items.map(a => a.toJSON());
  } catch (err) {
    console.error('[PLANNER] Duyuru sorgulama hatası:', err.message);
    return [];
  }
}

/** Verilen konuma en yakın kamp alanlarını mesafeye göre getirir (Haversine) */
async function getNearbyAlternatives(lat, lng, campType, excludeId, limit = 5) {
  if (!lat || !lng) return [];
  try {
    const Campground = db.Campground || require('../models/campground');
    const radiusKm = 50;
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const baseWhere = {
      latitude: { [Op.between]: [lat - latDelta, lat + latDelta] },
      longitude: { [Op.between]: [lng - lngDelta, lng + lngDelta] },
      status: 'active',
      deleted: 0,
      visibility: 'public',
    };
    if (excludeId) baseWhere.id = { [Op.ne]: excludeId };

    // Önce aynı türden dene
    const where = campType ? { ...baseWhere, type: campType } : baseWhere;

    const toHaversineList = (rows) => rows
      .map(r => {
        const a = r.toJSON();
        const dLat = ((a.latitude - lat) * Math.PI) / 180;
        const dLng = ((a.longitude - lng) * Math.PI) / 180;
        const h = Math.sin(dLat / 2) ** 2 +
          Math.cos((lat * Math.PI) / 180) *
          Math.cos((a.latitude * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
        a.distance_km = parseFloat((2 * 6371 * Math.asin(Math.sqrt(h))).toFixed(1));
        return a;
      })
      .filter(a => a.distance_km <= radiusKm);

    let rows = await Campground.findAll({
      where,
      limit: limit * 6,
      attributes: ['id', 'name', 'type', 'latitude', 'longitude', 'rating', 'province'],
    });

    // Haversine ile gerçek mesafeyi hesapla
    let withDist = toHaversineList(rows);

    if (withDist.length === 0 && campType) {
      console.log(`[PLANNER] ${campType} türünden 50km içinde sonuç bulunamadı — alternatif önerilmeyecek`);
    }

    // Combined score: mesafe ağırlığı %70, rating ağırlığı %30
    // Mesafe skoru: en yakın = 1, en uzak = 0
    const maxDist = Math.max(...withDist.map(a => a.distance_km), 1);
    withDist.sort((a, b) => {
      const aScore = (1 - a.distance_km / maxDist) * 0.7 + ((a.rating ?? 0) / 5) * 0.3;
      const bScore = (1 - b.distance_km / maxDist) * 0.7 + ((b.rating ?? 0) / 5) * 0.3;
      return bScore - aScore;
    });

    return withDist.slice(0, limit);
  } catch (err) {
    console.error('[PLANNER] Yakın alan sorgulama hatası:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// external_id ile kamp alanı DB kaydı sorgulama
// ---------------------------------------------------------------------------

/** external_id'ye göre campgrounds tablosundan güncel kamp alanı verisini getirir */
async function getCampgroundByExternalId(externalId) {
  if (!externalId) return null;
  try {
    const Campground = db.Campground || require('../models/campground');
    const row = await Campground.findOne({
      where: {
        external_id: String(externalId),
        status: 'active',
        deleted: 0,
      },
      attributes: [
        'id', 'name', 'latitude', 'longitude', 'type', 'description', 'province',
        'facilities', 'amenities', 'rating', 'review_count', 'fee',
        'price_range', 'booking_url', 'capacity',
      ],
    });
    if (!row) return null;
    const data = row.toJSON();
    if (typeof data.facilities === 'string') {
      try { data.facilities = JSON.parse(data.facilities); } catch { data.facilities = []; }
    }
    if (typeof data.amenities === 'string') {
      try { data.amenities = JSON.parse(data.amenities); } catch { data.amenities = []; }
    }
    return data;
  } catch (err) {
    console.error('[PLANNER] Campground external_id sorgusu hatası:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Booking URL içerik çekme (SSRF korumalı)
// ---------------------------------------------------------------------------

/** URL'nin güvenli bir dış adrese işaret ettiğini doğrular */
function isUrlSafe(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    // Özel/loopback/link-local adresleri engelle
    if (
      host === 'localhost' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
      /^192\.168\./.test(host) ||
      host === '::1' ||
      host === '0.0.0.0' ||
      /^169\.254\./.test(host)
    ) return false;
    return true;
  } catch {
    return false;
  }
}

// Olanaklar, yorumlar ve puan bölümlerini tespit eden anahtar kelimeler
const CONTENT_KEYWORDS = ['olanak', 'tesis', 'imkan', 'hizmet', 'yorum', 'degerlendirme', 'puan', 'yildiz', 'ucret', 'fiyat', 'kural', 'kamp', 'rezervasyon'];

/**
 * Verilen metin içinde CONTENT_KEYWORDS bakımından en yoğun pencereyi bulur.
 * @param {string} text - Düz metin
 * @param {number} windowSize - Arama penceresi (karakter)
 * @returns {number} Pencere başlangıç indeksi
 */
function findKeywordDenseSection(text, windowSize = 2000) {
  if (text.length <= windowSize) return 0;
  const lower = text.toLowerCase();
  let bestStart = 0;
  let bestScore = 0;
  const step = 300;
  for (let i = 0; i < text.length - windowSize; i += step) {
    const segment = lower.slice(i, i + windowSize);
    const score = CONTENT_KEYWORDS.reduce(
      (sum, kw) => sum + (segment.split(kw).length - 1), 0
    );
    if (score > bestScore) { bestScore = score; bestStart = i; }
  }
  return bestStart;
}

/**
 * booking_url sayfasından düz metin içerik çeker.
 * İlk ~1000 karakter (başlık/açıklama) + anahtar-kelime yoğun bölümü birleştirir.
 * @param {string|undefined} url
 * @returns {Promise<string|null>}
 */
async function fetchBookingUrlContent(url) {
  if (!url) return null;
  if (!isUrlSafe(url)) {
    console.warn('[PLANNER] Güvensiz booking_url engellendi:', url);
    return null;
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CampingAppBot/1.0)' },
    });
    if (!response.ok) return null;
    const html = await response.text();
    // Script/style taglerini, HTML taglerini ve HTML entity'lerini temizle
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const MAX_CHARS = 5500;
    let result;
    if (text.length <= MAX_CHARS) {
      result = text;
    } else {
      // İlk 1000 kar. (başlık/genel bilgi) + en bilgi-yoğun bölüm
      const intro = text.slice(0, 1000);
      const denseStart = findKeywordDenseSection(text, 2500);
      const dense = text.slice(denseStart, denseStart + (MAX_CHARS - 1000));
      result = denseStart > 1000
        ? `${intro}\n[...]\n${dense}`
        : text.slice(0, MAX_CHARS);
    }
    console.log(`[PLANNER] booking_url içeriği çekildi: ${text.length} ham, ${result.length} seçildi`);
    return result;
  } catch (err) {
    console.warn('[PLANNER] booking_url çekme hatası:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// JSON yapısal çıktı parser (AI'dan gelen ham string → structuredData)
// ---------------------------------------------------------------------------

/**
 * AI yanıtını structured JSON olarak parse etmeye çalışır.
 * - Markdown kod bloklarını soyar
 * - qwen3 <think>...</think> etiketlerini temizler
 * - categories dizisi yoksa null döner
 */
function tryParseStructured(rawText) {
  try {
    // Reasoning etiketlerini temizle — kapatılmış ve kapatılmamış <think> blokları
    let text = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Kapatılmamış <think> bloğu (token kesilmesi durumu)
    text = text.replace(/<think>[\s\S]*/gi, '').trim();
    // Markdown kod bloklarını soy
    text = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();

    // İlk { konumunu bul
    const start = text.indexOf('{');
    if (start === -1) return null;

    // Bracket matching ile eşleşen kapanış } bul (lastIndexOf yerine güvenli yol)
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) {
      console.warn('[PLANNER] tryParseStructured: açık brace kapatılmadı (JSON truncated?)');
      return null;
    }

    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!parsed.categories || !Array.isArray(parsed.categories)) return null;
    return parsed;
  } catch (e) {
    console.warn('[PLANNER] tryParseStructured JSON.parse hatası:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
function ruleBased(ctx) {
  const lines = [];
  const days = ctx.weather?.days ?? [];

  if (days.length) {
    const rainyDays = days.filter(d => (d.pop ?? d.daily_chance_of_rain ?? 0) > 60);
    const windyDays = days.filter(d => (d.wind_kph ?? d.maxwind_kph ?? 0) > 50);
    if (rainyDays.length > 1) {
      lines.push('⚠️ Seçtiğiniz tarih aralığında yoğun yağış bekleniyor. Kamp planınızı gözden geçirin.');
    }
    if (windyDays.length) {
      lines.push('💨 Bazı günlerde güçlü rüzgar bekleniyor. Çadır ve ekipmanlarınızı sağlamlaştırın.');
    }
    if (!rainyDays.length && !windyDays.length) {
      lines.push('✅ Hava koşulları kamp için genel olarak uygun görünüyor.');
    }
  }

  const announcements = ctx.announcements?.items ?? [];
  if (announcements.length) {
    const campBanKeywords = ['yasak', 'kamp yasağı', 'yangın', 'sel', 'tahliye', 'giriş yasak', 'uyarı', 'tehlike', 'kapalı'];
    const risky = announcements.filter(a =>
      campBanKeywords.some(kw =>
        (a.title + ' ' + (a.message ?? '')).toLowerCase().includes(kw)
      )
    );
    const others = announcements.filter(a => !risky.includes(a));

    if (risky.length) {
      lines.push('🚫 Bölgede kamp kısıtlamasına yol açabilecek resmi duyurular mevcut:');
      risky.forEach(a => lines.push(`   - ${a.title}${a.message ? ': ' + a.message.slice(0, 120) : ''}`));
    }
    if (others.length) {
      lines.push('📢 Bölgeyle ilgili diğer güncel duyurular:');
      others.slice(0, 5).forEach(a => lines.push(`   - ${a.title}`));
    }
  }

  const alts = ctx.nearbyAreas ?? [];
  if (alts.length) {
    lines.push(`📍 Alternatif yakın kamp alanları: ${alts.slice(0, 3).map(a => a.name).join(', ')}`);
  }

  if (!lines.length) {
    lines.push('ℹ️ Değerlendirme için yeterli veri bulunamadı.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
exports.aiEvaluate = async (req, res) => {
  try {
    const { planData } = req.body;
    if (!planData) {
      return res.status(400).json({ error: 'planData alanı zorunlu' });
    }

    // mode: 'preview' (hızlı/Groq) | 'final' (detaylı/DeepSeek) — default: final
    const mode = planData.mode === 'preview' ? 'preview' : 'final';
    const { startDate, endDate, campType, campingArea, userLocation, weather, valilikId, routeInfo: clientRouteInfo, announcements: frontendAnnouncements, nearbyAreas: frontendNearbyAreas } = planData;

    // --- Günlük kullanım limiti kontrolü (kullanıcı başına) ---
    // Limit: process.env.AI_DAILY_EVAL_LIMIT veya app_settings tablosundaki 'ai_daily_eval_limit' anahtarı
    let evalLimit = parseInt(process.env.AI_DAILY_EVAL_LIMIT ?? '10', 10);
    let evalRemaining = null;
    try {
      const User = db.User || require('../models/user');
      const AppSetting = db.AppSetting || require('../models/appSetting');

      // DB üzerinden override varsa oku (opsiyonel tablo)
      try {
        const s = await AppSetting.findByPk('ai_daily_eval_limit');
        if (s && s.value) {
          const p = parseInt(s.value, 20); // Günlük limit. Deneme süresi bittiğinde düşürülebilir.
          if (!Number.isNaN(p)) evalLimit = p;
        }
      } catch (e) {
        // app_settings yoksa devam et (opsiyonel)
      }

      // Eğer auth bilgisi yoksa limit uygulama
      if (req.user && req.user.id) {
        const today = new Date().toISOString().slice(0, 10);

        // Atomik artış: tarih bugününse sayaç++ yoksa 1 olacak.
        const [updated] = await User.update(
          {
            ai_eval_count_date: today,
            ai_eval_count: db.sequelize.literal(`CASE WHEN ai_eval_count_date = '${today}' THEN ai_eval_count + 1 ELSE 1 END`),
          },
          {
            where: {
              id: req.user.id,
              [Op.or]: [
                { ai_eval_count_date: { [Op.ne]: today } },
                { ai_eval_count: { [Op.lt]: evalLimit } },
              ],
            },
          }
        );

        if (!updated) {
          // Limit aşıldı — mevcut kullanım bilgisini al ve 429 dön
          const u = await User.findByPk(req.user.id, { attributes: ['ai_eval_count', 'ai_eval_count_date'] });
          const used = (u && u.ai_eval_count_date && String(u.ai_eval_count_date).slice(0, 10) === today) ? (u.ai_eval_count || 0) : 0;
          evalRemaining = Math.max(0, evalLimit - used);
          return res.status(429).json({ error: 'Günlük değerlendirme limiti aşıldı', remaining: evalRemaining, limit: evalLimit });
        }

        // Güncel kullanım bilgisini al
        const u2 = await User.findByPk(req.user.id, { attributes: ['ai_eval_count', 'ai_eval_count_date'] });
        const used2 = (u2 && u2.ai_eval_count) ? u2.ai_eval_count : 0;
        evalRemaining = Math.max(0, evalLimit - used2);
      }
    } catch (e) {
      console.warn('[PLANNER] ai-eval usage check failed:', e && e.message ? e.message : e);
      // Limit kontrolü hata verirse servisi engelleme — değerlendirme devam eder
    }

    const campLat = campingArea?.lat ?? campingArea?.latitude;
    const campLng = campingArea?.lng ?? campingArea?.longitude;

    // Faz 1: Paralel DB/rota sorguları (hızlı)
    const [dbCampground, dbAnnouncements, dbNearbyAreas, realRouteInfo] = await Promise.all([
      getCampgroundByExternalId(campingArea?.external_id),
      getRelevantAnnouncements(valilikId),
      getNearbyAlternatives(campLat, campLng, campType, campingArea?.id),
      getRouteInfo(userLocation, { lat: campLat, lng: campLng }),
    ]);

    // Frontend'den gelen nearbyAreas ile DB sonuçlarını birleştir
    // Öncelik: DB'deki alanlar (güncel veri), frontend sadece ek alan sağlar
    const nearbyMap = new Map();
    dbNearbyAreas.forEach(a => nearbyMap.set(String(a.id), a));
    if (Array.isArray(frontendNearbyAreas)) {
      frontendNearbyAreas.forEach(a => {
        // DB'de bulunmayan ama frontend'in gönderdiği alanları ekle (external_id ile)
        const key = a.external_id ? `ext:${a.external_id}` : `name:${a.name}`;
        if (!nearbyMap.has(key)) nearbyMap.set(key, a);
      });
    }
    const nearbyAreas = Array.from(nearbyMap.values()).slice(0, 5);
    if (nearbyAreas.length) {
      console.log(`[PLANNER] Yakın alanlar — DB: ${dbNearbyAreas.length}, Frontend: ${(frontendNearbyAreas ?? []).length}, Toplam: ${nearbyAreas.length}`);
    }

    // campingArea'yı DB verisiyle zenginleştir
    const enrichedCampingArea = dbCampground
      ? {
          ...campingArea,
          id: dbCampground.id,
          name: dbCampground.name,
          lat: dbCampground.latitude,
          lng: dbCampground.longitude,
          type: dbCampground.type,
          booking_url: campingArea.booking_url || dbCampground.booking_url,
          dbDetails: {
            description: dbCampground.description,
            facilities: dbCampground.facilities,
            amenities: dbCampground.amenities,
            rating: dbCampground.rating,
            review_count: dbCampground.review_count,
            fee: dbCampground.fee,
            price_range: dbCampground.price_range,
            capacity: dbCampground.capacity,
          },
        }
      : campingArea;

    if (dbCampground) {
      console.log(`[PLANNER] Kamp alanı DB'den yüklendi: ${dbCampground.name} (external_id: ${campingArea?.external_id})`);
    }

    // Faz 2: Dış HTTP isteği (zenginleştirilmiş booking_url kullanır)
    const bookingUrlContent = await fetchBookingUrlContent(enrichedCampingArea?.booking_url);

    // Frontend'den gelen duyuruları DB sonuçlarıyla birleştir (id ile deduplicate)
    const frontendItems = (Array.isArray(frontendAnnouncements)
      ? frontendAnnouncements
      : (frontendAnnouncements?.items ?? [])
    ).map(a => ({ id: a.id, title: a.title, date: a.date })); // Sadece gerekli alanlar
    const mergedMap = new Map();
    [...dbAnnouncements, ...frontendItems].forEach(a => {
      const key = a.id ? String(a.id) : `${a.title}-${a.date ?? a.created_at ?? ''}`;
      if (!mergedMap.has(key)) mergedMap.set(key, a);
    });
    const announcementItems = Array.from(mergedMap.values()).slice(0, 6);

    // Weather days'i de sınırla
    const trimmedWeather = weather ? {
      summary: weather.summary,
      days: (weather.days ?? []).slice(0, 4).map(d => ({
        date: d.date, maxTemp: d.maxTemp ?? d.max_temp_c,
        minTemp: d.minTemp ?? d.min_temp_c,
        pop: d.pop ?? d.daily_chance_of_rain,
        wind_kph: d.wind_kph ?? d.maxwind_kph,
        text: d.text ?? d.condition,
      })),
    } : undefined;

    console.log(`[PLANNER] Duyuru sayısı — DB: ${dbAnnouncements.length}, Frontend: ${frontendItems.length}, Toplam (birleştirilmiş): ${announcementItems.length}`);
    if (realRouteInfo) console.log(`[PLANNER] Rota: ${realRouteInfo.summary}`);
    if (bookingUrlContent) console.log(`[PLANNER] booking_url içeriği hazır (${bookingUrlContent.length} karakter)`);

    // Gerçek rota bilgisini frontend'dan gelen veriyle birleştir
    const routeInfo = realRouteInfo
      ? { ...( clientRouteInfo ?? {}), duration: realRouteInfo.durationMin, distanceKm: realRouteInfo.distanceKm, summary: realRouteInfo.summary }
      : clientRouteInfo;

    /** @type {import('../services/promptBuilder').EvaluationContext} */
    const ctx = {
      dateRange: { start: startDate, end: endDate },
      campType,
      campingArea: enrichedCampingArea,
      userLocation,
      weather: trimmedWeather,
      announcements: { items: announcementItems, valilikId },
      nearbyAreas,
      routeInfo,
      bookingUrlContent,
    };

    // 2. Cache kontrol — key: provider + içerik hash'i (aynı ctx+mode tekrar API'ye gitmez)
    const cache = getCache();
    const cacheKey = `ai-eval:${mode}:${computeHash(ctx)}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      const cachedObj = JSON.parse(cached);
      if (typeof evalRemaining === 'number') cachedObj.remaining = evalRemaining;
      if (typeof evalLimit === 'number') cachedObj.limit = evalLimit;
      return res.json({ ...cachedObj, cached: true });
    }

    // 3. Prompt oluştur ve LLM'e gönder
    const builder = new PromptBuilder();

    const normalizedType = String(campType ?? '').toLowerCase();
    const isHiking = normalizedType.includes('yürüyüş') || normalizedType.includes('yuruyus') || normalizedType.includes('parkur') || normalizedType.includes('trekking') || normalizedType.includes('hiking');

    if (isHiking) {
      builder
        .register(new WeatherModule())
        .register(new AnnouncementModule())
        .register(new HikingTrailModule())
        .register(new RouteConditionModule())
        .register(new CampgroundDetailModule())
        .register(new AlternativeLocationModule())
        .register(new BookingUrlModule());
    } else {
      builder
        .register(new WeatherModule())
        .register(new AnnouncementModule())
        .register(new AlternativeLocationModule())
        .register(new RouteConditionModule())
        .register(new CampgroundDetailModule())
        .register(new BookingUrlModule());
    }

    const { messages, modules } = builder.buildStructured(ctx);

    // 4. LLM'e gönder — mode'a göre provider seç
    const activeProvider = HYBRID_PROVIDERS[mode] ?? AI_PROVIDER;
    let rawResponse;
    let structuredData = null;
    let evaluation = null;
    let fallback = false;

    // Controller-level timeout: proxy/frontend 504 dönmeden önce fallback'e düş
    const CONTROLLER_TIMEOUT_MS = parseInt(process.env.AI_CONTROLLER_TIMEOUT_MS ?? '50000', 10);

    console.log(`[PLANNER] Mod: ${mode} | Provider: ${activeProvider}`);

    try {
      const ai = AIAdapterFactory.create(activeProvider);
      // Structured JSON çıktısı için:
      // - jsonMode: Groq/DeepSeek response_format ile JSON zorunlu — <think> baskılanır
      // - noReasoning: reasoning_format eklenmez (yedek güvenlik)
      // - temperature: 0.2  → format tutarlılığı
      // - maxTokens: 4000   → tüm kategoriler kesilmeden sığsın
      const aiPromise = ai.chat(messages, { temperature: 0.2, noReasoning: true, jsonMode: true, maxTokens: 4000 });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Controller timeout (${CONTROLLER_TIMEOUT_MS}ms)`)), CONTROLLER_TIMEOUT_MS)
      );
      rawResponse = await Promise.race([aiPromise, timeoutPromise]);
      console.log(`[PLANNER] AI yanıtı alındı (${String(rawResponse).length} karakter)`);
    } catch (aiErr) {
      console.warn('[PLANNER] LLM hatası, kural tabanlı fallback devreye girdi.');
      console.warn('[PLANNER] Provider:', activeProvider, '| Hata:', aiErr.message);
      evaluation = ruleBased(ctx);
      fallback = true;
    }

    // JSON parse — başarısız olursa ruleBased fallback
    if (!fallback) {
      structuredData = tryParseStructured(rawResponse);
      if (!structuredData) {
        console.warn('[PLANNER] Structured JSON parse başarısız, kural tabanlı fallback devreye girdi.');
        console.warn('[PLANNER] Ham yanıt (ilk 800 kar.):', String(rawResponse).slice(0, 800));
        evaluation = ruleBased(ctx);
        fallback = true;
      }
    }

    // 5. Yanıtı yapılandır ve cache'le
    // Frontend kontrol: if (!data.evaluation) return null — bu yüzden evaluation her zaman truthy olmalı
    const result = {
      evaluation: evaluation || (structuredData ? 'Yapısal değerlendirme hazır.' : 'Değerlendirme yapılamadı.'),
      structured: structuredData,   // { score, stats, categories } veya null
      generatedAt: new Date().toISOString(),
      modules,
      mode,
      provider: activeProvider,
      cached: false,
      fallback,
    };

    // Cache'a user-a özel alanlar eklemeyin (remaining kullanıcıya özeldir)
    const cachePayload = { ...result };
    await cache.set(cacheKey, JSON.stringify(cachePayload), CACHE_TTL);

    if (typeof evalRemaining === 'number') result.remaining = evalRemaining;
    if (typeof evalLimit === 'number') result.limit = evalLimit;

    return res.json(result);
  } catch (err) {
    console.error('[PLANNER] aiEvaluate hatası:', err);
    return res.status(500).json({ error: 'Değerlendirme sırasında bir hata oluştu' });
  }
};
