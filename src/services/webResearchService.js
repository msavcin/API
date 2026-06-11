/**
 * Web Araştırma Servisi
 *
 * Kamp alanı koordinatlarını ve ismini kullanarak dış kaynaklardan veri toplar:
 *   1. Overpass API (OpenStreetMap) — ücretsiz, key gerektirmez
 *      tourism=camp_site, leisure, amenity node'larından tesis/olanak etiketleri çekilir.
 *   2. Google Places API — GOOGLE_PLACES_API_KEY .env değişkeni tanımlıysa
 *      işletme puanı, toplam yorum sayısı ve son ziyaretçi yorumları alınır.
 *
 * Tüm harici HTTP istekleri AbortSignal.timeout() + hata yönetimiyle sarılmıştır;
 * herhangi bir kaynak yanıt vermese de diğer adımlar çalışmaya devam eder.
 *
 * Cache: Sonuçlar 30 gün Redis/in-memory cache'de tutulur.
 * Google Places yalnızca isBusinessLike() true döndüğünde sorgulanır.
 */

const { getCache } = require('./cache');

const WEB_RESEARCH_CACHE_TTL = 30 * 24 * 3600; // 30 gün (saniye)

// ---------------------------------------------------------------------------
// İşletme tespiti
// ---------------------------------------------------------------------------

const BUSINESS_KEYWORDS = [
  'a.ş', 'ltd', 'şti', 'şirketi', 'işletme', 'tesisi', 'resort',
  'hotel', 'otel', 'tatil köyü', 'pansiyon', 'motel', 'glamping',
  'camp', 'camping', 'kamp alanı', 'kamp yeri',
];

/**
 * Kamp alanı adının ticari bir işletmeye ait olup olmadığını tahmin eder.
 * @param {string} name
 * @returns {boolean}
 */
function isLikelyBusiness(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return BUSINESS_KEYWORDS.some(kw => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Overpass API (OpenStreetMap)
// ---------------------------------------------------------------------------

/**
 * Koordinat etrafındaki OSM tourism/leisure/amenity node & way'lerini çeker.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radiusMeters=300]
 * @returns {Promise<object|null>}
 */
async function fetchOverpassData(lat, lng, radiusMeters = 300) {
  // POST kullanımı — URL encoding'i tetikleyebilecek uzun query'ler için daha güvenli
  const query = [
    '[out:json][timeout:8];(',
    `node(around:${radiusMeters},${lat},${lng})[tourism];`,
    `way(around:${radiusMeters},${lat},${lng})[tourism];`,
    `node(around:${radiusMeters},${lat},${lng})[leisure~"^(camp_site|holiday_camp|nature_reserve)$"];`,
    `node(around:${radiusMeters},${lat},${lng})[amenity~"^(shelter|toilets|showers|drinking_water|camping)$"];`,
    ');out body;',
  ].join('\n');

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'CampingAppBot/1.0 (camping planner; contact@kampdefterim.com)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.warn('[WEB_RESEARCH] Overpass API HTTP hata:', response.status);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.warn('[WEB_RESEARCH] Overpass API hatası:', err.message);
    return null;
  }
}

/**
 * Overpass sonucundan en ilgili OSM elementinin etiketlerini çıkarır.
 * @param {object|null} overpassData
 * @returns {object|null}
 */
function extractOsmTags(overpassData) {
  if (!overpassData?.elements?.length) return null;

  // Öncelik: tourism=camp_site; yoksa ilk element
  const campSite = overpassData.elements.find(el => el.tags?.tourism === 'camp_site');
  const el = campSite || overpassData.elements[0];
  if (!el?.tags) return null;

  const t = el.tags;
  const result = {};

  if (t['name:tr'] || t.name) result.osmName = (t['name:tr'] || t.name).slice(0, 100);
  if (t.stars)                result.stars = t.stars;
  if (t.fee)                  result.fee = t.fee;                   // 'yes' | 'no'
  if (t['fee:daily'])         result.feeDaily = t['fee:daily'];     // günlük ücret bilgisi
  if (t.capacity)             result.capacity = t.capacity;
  if (t['capacity:tents'])    result.capacityTents = t['capacity:tents'];
  if (t['capacity:caravans']) result.capacityCaravans = t['capacity:caravans'];
  if (t.maxstay)              result.maxstay = t.maxstay;           // örn. '14 days'

  // Tesis / Olanaklar
  if (t.shower || t.showers)  result.shower = t.shower || t.showers;
  if (t.toilets)              result.toilets = t.toilets;
  if (t.drinking_water)       result.drinkingWater = t.drinking_water;
  if (t.internet_access)      result.internet = t.internet_access;  // 'wlan'|'no'|'yes'
  if (t.electricity)          result.electricity = t.electricity;   // 'yes'|'no'|'hookup'
  if (t.swimming_pool)        result.swimmingPool = t.swimming_pool;
  if (t.playground)           result.playground = t.playground;
  if (t.laundry)              result.laundry = t.laundry;
  if (t.kitchen)              result.kitchen = t.kitchen;
  if (t.sanitary_dump_station) result.sanitaryDump = t.sanitary_dump_station;
  if (t.lit)                  result.lit = t.lit;                   // 'yes'|'no'
  if (t.dogs)                 result.dogs = t.dogs;                 // 'yes'|'no'|'leashed'
  if (t.tents)                result.tents = t.tents;               // 'yes'|'no'
  if (t.caravans)             result.caravans = t.caravans;
  if (t.static_caravans)      result.staticCaravans = t.static_caravans;

  // İletişim / Işletme
  if (t.opening_hours)        result.openingHours = t.opening_hours.slice(0, 120);
  if (t.check_in)             result.checkIn = t.check_in;
  if (t.check_out)            result.checkOut = t.check_out;
  if (t.operator)             result.operator = t.operator.slice(0, 100);
  if (t.website)              result.website = t.website.slice(0, 200);
  if (t.phone || t['contact:phone']) result.phone = (t.phone || t['contact:phone']).slice(0, 30);

  const desc = t['description:tr'] || t.description;
  if (desc) result.description = desc.slice(0, 300);

  return Object.keys(result).length ? result : null;
}

// ---------------------------------------------------------------------------
// Google Places API (opsiyonel — GOOGLE_PLACES_API_KEY gerektirir)
// ---------------------------------------------------------------------------

/**
 * Google Places Text Search + Details ile işletme verisi çeker.
 * @param {string} name
 * @param {number} lat
 * @param {number} lng
 * @param {string} apiKey
 * @returns {Promise<object|null>}
 */
async function fetchGooglePlacesDetails(name, lat, lng, apiKey) {
  try {
    // 1. Text Search — en yakın eşleşen yeri bul
    const searchUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    searchUrl.searchParams.set('query', name);
    searchUrl.searchParams.set('location', `${lat},${lng}`);
    searchUrl.searchParams.set('radius', '500');
    searchUrl.searchParams.set('language', 'tr');
    searchUrl.searchParams.set('key', apiKey);

    const searchRes = await fetch(searchUrl.toString(), {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'CampingAppBot/1.0' },
    });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    if (!searchData.results?.length) return null;

    const placeId = searchData.results[0].place_id;

    // 2. Place Details — puan, yorumlar, çalışma saatleri
    const detailUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    detailUrl.searchParams.set('place_id', placeId);
    detailUrl.searchParams.set(
      'fields',
      'name,rating,user_ratings_total,reviews,opening_hours,website,formatted_phone_number,editorial_summary,price_level',
    );
    detailUrl.searchParams.set('language', 'tr');
    detailUrl.searchParams.set('key', apiKey);

    const detailRes = await fetch(detailUrl.toString(), {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'CampingAppBot/1.0' },
    });
    if (!detailRes.ok) return null;
    return await detailRes.json();
  } catch (err) {
    console.warn('[WEB_RESEARCH] Google Places API hatası:', err.message);
    return null;
  }
}

/**
 * Google Places API sonucundan değerlendirme bilgisini çıkarır.
 * @param {object|null} placesData
 * @returns {object|null}
 */
function extractGooglePlacesInfo(placesData) {
  const r = placesData?.result;
  if (!r) return null;

  // price_level: 0=ücretsiz, 1=$, 2=$$, 3=$$$, 4=$$$$
  const PRICE_LABELS = ['\u00dccretsiz', 'Ucuz ($)', 'Orta ($$)', 'Pahali ($$$)', 'Cok pahali ($$$$)'];

  const result = {};
  if (r.rating)                         result.rating = r.rating;
  if (r.user_ratings_total)             result.totalRatings = r.user_ratings_total;
  if (typeof r.price_level === 'number') result.priceLevel = PRICE_LABELS[r.price_level] ?? String(r.price_level);
  if (r.editorial_summary?.overview)    result.summary = r.editorial_summary.overview.slice(0, 300);
  if (r.formatted_phone_number)         result.phone = r.formatted_phone_number.slice(0, 30);
  if (r.website)                        result.website = r.website.slice(0, 200);
  if (r.opening_hours?.weekday_text?.length) {
    result.openingHours = r.opening_hours.weekday_text.slice(0, 7);
  }
  if (r.reviews?.length) {
    result.reviews = r.reviews.slice(0, 4).map(rv => ({
      rating: rv.rating,
      text:   (rv.text ?? '').slice(0, 180),
      time:   rv.relative_time_description ?? '',
    }));
  }

  return Object.keys(result).length ? result : null;
}

// ---------------------------------------------------------------------------
// Ana araştırma fonksiyonu
// ---------------------------------------------------------------------------

/**
 * Kamp alanı için web araştırması yapar; Overpass ve Google Places'ı
 * paralel olarak sorgular ve sonuçları döner.
 *
 * @param {{ name?: string, lat?: number, lng?: number }} campingArea
 * @returns {Promise<{
 *   osmTags: object|null,
 *   googlePlaces: object|null,
 *   isBusinessLike: boolean
 * }>}
 */
async function researchLocation(campingArea) {
  const { name, lat, lng } = campingArea ?? {};

  const result = { osmTags: null, googlePlaces: null, isBusinessLike: false };
  if (!lat || !lng) return result;

  result.isBusinessLike = isLikelyBusiness(name ?? '');

  // Cache anahtarı: koordinat ~111m hassasiyetinde (3 ondalık) + normalize isim
  const cacheKey = `webresearch:${parseFloat(lat).toFixed(3)}:${parseFloat(lng).toFixed(3)}:${(name ?? '').toLowerCase().trim().slice(0, 60)}`;
  const cache = getCache();

  const cached = await cache.get(cacheKey);
  if (cached) {
    console.log('[WEB_RESEARCH] Cache hit:', cacheKey);
    return JSON.parse(cached);
  }

  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;

  // WEB_RESEARCH_BUSINESS_ONLY=true (varsayılan) → yalnızca işletme adlarında sorgula
  // WEB_RESEARCH_BUSINESS_ONLY=false → her alan için sorgula
  const businessOnly = (process.env.WEB_RESEARCH_BUSINESS_ONLY ?? 'true') !== 'false';
  const shouldQueryGoogle = googleApiKey && name && (!businessOnly || result.isBusinessLike);

  const [overpassData, googleData] = await Promise.all([
    fetchOverpassData(lat, lng),
    shouldQueryGoogle
      ? fetchGooglePlacesDetails(name, lat, lng, googleApiKey)
      : Promise.resolve(null),
  ]);

  result.osmTags      = extractOsmTags(overpassData);
  result.googlePlaces = extractGooglePlacesInfo(googleData);

  if (result.osmTags) {
    console.log('[WEB_RESEARCH] OSM etiketleri alındı:', Object.keys(result.osmTags).join(', '));
  }
  if (result.googlePlaces) {
    console.log('[WEB_RESEARCH] Google Places verisi alındı — puan:', result.googlePlaces.rating);
  }
  if (!shouldQueryGoogle && googleApiKey) {
    console.log('[WEB_RESEARCH] Google Places atlandı (işletme tespiti yok):', name);
  }

  // Sonucu 30 gün cache'le (veri olmasa bile — tekrar sorgulamayı önler)
  await cache.set(cacheKey, JSON.stringify(result), WEB_RESEARCH_CACHE_TTL);

  return result;
}

module.exports = { researchLocation, isLikelyBusiness };
