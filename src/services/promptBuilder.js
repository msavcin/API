/**
 * Prompt Builder — Modüler & Genişletilebilir Sistem
 *
 * EvaluationContext (ctx) alanları:
 *   weather, announcements, campingArea, nearbyAreas,
 *   userLocation, campType, dateRange, routeInfo
 */

// ---------------------------------------------------------------------------
// Basit token tahmincisi (~4 char = 1 token, Türkçe için ~3.5)
// ---------------------------------------------------------------------------
function estimateTokens(text) {
  return Math.ceil((text || '').length / 3.5);
}

// ---------------------------------------------------------------------------
// Modüller
// ---------------------------------------------------------------------------

class WeatherModule {
  get id() { return 'weather'; }

  buildPrompt(ctx) {
    const days = ctx.weather?.days;
    if (!days?.length) return null;

    const rows = days.slice(0, 4).map(d =>
      `${d.date}: ${d.maxTemp ?? d.max_temp_c ?? '?'}/${d.minTemp ?? d.min_temp_c ?? '?'}C yagis%${d.pop ?? d.daily_chance_of_rain ?? 0} ruzgar${d.wind_kph ?? d.maxwind_kph ?? 0}km/h ${d.text ?? d.condition ?? ''}`
    );
    return `[HAVA]\n${rows.join('\n')}`;
  }
}

class AnnouncementModule {
  get id() { return 'announcements'; }

  buildPrompt(ctx) {
    const items = ctx.announcements?.items;
    if (!items?.length) return null;

    const criticalKw = ['yasak', 'yangin', 'sel', 'uyari', 'tahliye', 'kapat', 'kapan'];
    const critical = items.filter(a =>
      criticalKw.some(kw => (a.title + ' ' + (a.message ?? '')).toLowerCase().includes(kw))
    );
    const others = items.filter(a => !critical.includes(a));

    const lines = [];
    critical.slice(0, 2).forEach(a => lines.push(`! ${a.title}`));
    others.slice(0, 2).forEach(a => lines.push(`- ${a.title}`));

    return `[DUYURU]\n${lines.join('\n')}`;
  }
}

class AlternativeLocationModule {
  get id() { return 'alternatives'; }

  buildPrompt(ctx) {
    const areas = ctx.nearbyAreas;
    if (!areas?.length) return null;

    const campType = ctx.campType ?? '';
    const lines = areas.slice(0, 5).map((a, i) => {
      const parts = [a.type ?? '?', `${a.distance_km}km`];
      if (a.rating) parts.push(`${a.rating}/5 puan`);
      if (a.fee === 0) parts.push('ucretsiz');
      else if (a.fee) parts.push('ucretli');
      return `${i + 1}. ${a.name} (${parts.join(', ')})`;
    });
    return `[ALTERNATIF - Konaklama: ${campType}]\n${lines.join('\n')}\nSadece ${campType || 'secilen'} tipine uygun oneri yap.`;
  }
}

class RouteConditionModule {
  get id() { return 'route'; }

  buildPrompt(ctx) {
    const parts = [];

    // Gerçek rota (OSRM/Google'dan)
    if (ctx.routeInfo?.summary) {
      parts.push(`Surus suresi: ${ctx.routeInfo.summary}`);
    }

    // Frontend'den gelen ek yol notu
    if (ctx.routeInfo?.note) {
      parts.push(String(ctx.routeInfo.note).slice(0, 200));
    }

    // Duyurulardan yol ile ilgili olanlar
    const routeKw = ['yol', 'karayol', 'kopru', 'tunel', 'gecit', 'trafig', 'ulasim', 'kapan', 'calisma'];
    const items = ctx.announcements?.items ?? [];
    items.filter(a => {
      const t = ((a.title ?? '') + ' ' + (a.message ?? '')).toLowerCase();
      return routeKw.some(kw => t.includes(kw));
    }).slice(0, 2).forEach(a => parts.push(`- ${a.title}`));

    if (!parts.length) return null;
    return `[YOL]\n${parts.join('\n')}`;
  }
}

class HikingTrailModule {
  get id() { return 'hikingTrail'; }

  buildPrompt(ctx) {
    const campType = String(ctx.campType ?? '').toLowerCase();
    if (!campType.includes('yürüyüş') && !campType.includes('yuruyus') && !campType.includes('parkur') && !campType.includes('trekking') && !campType.includes('hiking')) {
      return null;
    }

    const d = ctx.campingArea?.dbDetails ?? ctx.campingArea ?? {};
    const route = ctx.routeInfo ?? {};
    const lines = [];

    if (d.trail_length) lines.push(`Rota uzunluğu: ${d.trail_length}${typeof d.trail_length === 'number' ? ' km' : ''}`);
    else if (route.distanceKm) lines.push(`Rota uzunluğu (yaklaşık): ${route.distanceKm} km`);

    if (d.elevation_gain) lines.push(`Toplam yükselme: ${d.elevation_gain} m`);
    if (d.difficulty) lines.push(`Zorluk: ${d.difficulty}`);
    if (d.trail_type) lines.push(`Rota tipi: ${d.trail_type}`);
    if (typeof d.camping_allowed !== 'undefined') lines.push(`Rota üzerinde kamp izni: ${d.camping_allowed ? 'Evet' : 'Hayır'}`);
    if (d.water_sources) lines.push(`Su kaynakları: ${Array.isArray(d.water_sources) ? d.water_sources.join(', ') : d.water_sources}`);
    if (d.shelters) lines.push(`Sığınak/Barınak: ${Array.isArray(d.shelters) ? d.shelters.join(', ') : d.shelters}`);
    if (d.permit_required) lines.push(`İzin gerekebilir: ${d.permit_required ? 'Evet' : 'Hayır'}`);
    if (route.summary) lines.push(`Rota özeti: ${String(route.summary).slice(0, 200)}`);
    if (route.note) lines.push(`Rota notu: ${String(route.note).slice(0, 200)}`);

    if (!lines.length) lines.push('Rota bilgisi: (detay yok)');

    lines.push('');
    lines.push('ÖNEMLİ (Yürüyüş parkuru önceliği): Bu değerlendirme yürüyüş parkuru olduğu için LLM\'den özellikle şu bilgileri isteme:');
    lines.push('- Tahmini yürüyüş süresi ve zorluklu etaplar; akarsu/geçişler; taşlık, dik iniş/çıkış; exposure ve tehlikeli bölümler.');
    lines.push('- Gece kampı için güvenli noktalar, su kaynakları, izin gereksinimleri, acil çıkış/erişim noktaları.');
    lines.push('- Ekipman listesi (ayakkabı, baton, su arıtma, harita/GPS, gece ışığı vb.) ve hava değişikliğine karşı öneriler.');
    lines.push('- Kısa alternatif kamp alanı önerileri (en yakın 3) ve nedenleri.');

    return `[YURUYUS]\n${lines.join('\n')}`;
  }
}

class CampgroundDetailModule {
  get id() { return 'campgroundDetail'; }

  buildPrompt(ctx) {
    const d = ctx.campingArea?.dbDetails;
    if (!d) return null;

    const lines = [];
    if (d.description) lines.push(`Aciklama: ${String(d.description).slice(0, 300)}`);
    if (d.rating) lines.push(`Puan: ${d.rating}/5 (${d.review_count ?? 0} yorum)`);
    if (d.fee === 0) lines.push('Ucret: Ucretsiz');
    else if (d.fee) lines.push(`Ucret: Ucretli${d.price_range ? ' (' + d.price_range + ')' : ''}`);
    if (d.capacity) lines.push(`Kapasite: ${d.capacity}`);
    if (Array.isArray(d.facilities) && d.facilities.length) {
      lines.push(`Olanaklar: ${d.facilities.slice(0, 8).join(', ')}`);
    }
    if (Array.isArray(d.amenities) && d.amenities.length) {
      lines.push(`Tesisler: ${d.amenities.slice(0, 8).join(', ')}`);
    }
    if (!lines.length) return null;
    return `[KAMP_ALANI_DB]
${lines.join('\n')}`;
  }
}

// ---------------------------------------------------------------------------
// PromptBuilder
// ---------------------------------------------------------------------------

class BookingUrlModule {
  get id() { return 'bookingUrl'; }

  buildPrompt(ctx) {
    const content = ctx.bookingUrlContent;
    if (!content) return null;
    // ~3200 karakter ≈ 900 token — olanaklar/yorumlar/puan için yeterli bütçe
    return `[ALAN_SAYFASI - Olanaklar/Yorumlar/Fiyatlar/Puanlama]\n${content.slice(0, 3200)}`;
  }
}

class WebResearchModule {
  get id() { return 'webResearch'; }

  // Evet/hayır değerlerini Türkçeye çevirir
  static yn(val, yesLabel = 'Mevcut', noLabel = 'Yok') {
    if (!val) return null;
    if (val === 'yes' || val === 'hot' || val === 'cold' || val === 'hookup') return yesLabel;
    if (val === 'no') return noLabel;
    return val; // 'wlan', 'leashed' gibi özel değerler olduğu gibi
  }

  buildPrompt(ctx) {
    const wr = ctx.webResearch;
    if (!wr) return null;

    const lines = [];

    // --- OSM (Overpass) verileri ---
    if (wr.osmTags) {
      const t = wr.osmTags;
      if (t.osmName)      lines.push(`OSM Adi: ${t.osmName}`);
      if (t.stars)        lines.push(`Yildiz (OSM): ${t.stars}`);
      if (t.description)  lines.push(`Aciklama (OSM): ${t.description}`);
      if (t.operator)     lines.push(`Isletmeci: ${t.operator}`);

      // Ücret
      if (t.fee === 'yes') lines.push('Ucret: Ucretli');
      else if (t.fee === 'no') lines.push('Ucret: Ucretsiz');
      if (t.feeDaily)     lines.push(`Gunluk Ucret: ${t.feeDaily}`);

      // Kapasite
      if (t.capacity)         lines.push(`Toplam Kapasite: ${t.capacity} kisi`);
      if (t.capacityTents)    lines.push(`Cadir Kapasitesi: ${t.capacityTents}`);
      if (t.capacityCaravans) lines.push(`Karavan Kapasitesi: ${t.capacityCaravans}`);
      if (t.maxstay)          lines.push(`Maksimum Kalis: ${t.maxstay}`);

      // Tesis olanakları — mevcut olanları grupla
      const facilities = [];
      const f = (val, label) => { const r = WebResearchModule.yn(val); if (r && r !== 'Yok') facilities.push(label + (r !== 'Mevcut' ? ` (${r})` : '')); };
      f(t.shower,       'Dus');
      f(t.toilets,      'Tuvalet');
      f(t.drinkingWater,'Icme Suyu');
      f(t.electricity,  'Elektrik');
      f(t.internet,     'Internet/WiFi');
      f(t.swimmingPool, 'Yuzme Havuzu');
      f(t.playground,   'Oyun Alani');
      f(t.laundry,      'Camasir');
      f(t.kitchen,      'Ortak Mutfak');
      f(t.sanitaryDump, 'Atik Bosaltma');
      f(t.lit,          'Aydinlatma');
      if (facilities.length) lines.push(`Mevcut Tesisler: ${facilities.join(', ')}`);

      // Konaklama tipleri
      const types = [];
      if (WebResearchModule.yn(t.tents) === 'Mevcut')         types.push('Cadir');
      if (WebResearchModule.yn(t.caravans) === 'Mevcut')      types.push('Karavan');
      if (WebResearchModule.yn(t.staticCaravans) === 'Mevcut') types.push('Sabit Karavan');
      if (types.length) lines.push(`Konaklama Tipleri: ${types.join(', ')}`);

      // Politikalar
      if (t.dogs) lines.push(`Evcil Hayvan: ${t.dogs === 'yes' ? 'Serbest' : t.dogs === 'leashed' ? 'Tasma ile' : 'Yasak'}`);

      // Zaman / iletişim
      if (t.checkIn || t.checkOut) {
        const ci = t.checkIn ? `Giris: ${t.checkIn}` : '';
        const co = t.checkOut ? `Cikis: ${t.checkOut}` : '';
        lines.push([ci, co].filter(Boolean).join(' | '));
      }
      if (t.openingHours) lines.push(`Sezon / Calisma: ${t.openingHours}`);
    }

    // --- Google Places verileri ---
    if (wr.googlePlaces) {
      const g = wr.googlePlaces;
      if (g.rating)     lines.push(`Google Puan: ${g.rating}/5${g.totalRatings ? ` (${g.totalRatings} yorum)` : ''}`);
      if (g.priceLevel) lines.push(`Fiyat Seviyesi: ${g.priceLevel}`);
      if (g.summary)    lines.push(`Google Ozet: ${g.summary}`);
      if (g.phone && !wr.osmTags?.phone)   lines.push(`Telefon: ${g.phone}`);
      if (g.openingHours?.length && !wr.osmTags?.openingHours) {
        lines.push(`Calisma Saatleri: ${g.openingHours.slice(0, 3).join(' | ')}`);
      }
      if (g.reviews?.length) {
        const reviewLines = g.reviews.map(rv => `- ${rv.rating}/5 (${rv.time}): "${rv.text}"`);
        lines.push(`Google Ziyaretci Yorumlari:\n${reviewLines.join('\n')}`);
      }
    }

    if (!lines.length) return null;
    const label = wr.isBusinessLike ? '[WEB_ARASTIRMA - Isletme]' : '[WEB_ARASTIRMA - OSM]';
    return `${label}\n${lines.join('\n')}`;
  }
}

const SYSTEM_PROMPT = `Sen deneyimli bir kamp rehberi, seyahat planlayicisi ve outdoor uzmansin.
Kullanicinin kamp planina gore DETAYLI, GERCEKCI ve PRATIK analiz yap.
Amac: Sahada ise yarayan kritik detaylari vermek.

Yanit formatin:

1. HAVA DURUMU ANALIZI
- Gun gun sicaklik (gunduz/gece), ruzgar, nem
- Kamp etki yorumu (usume, cadir ici nem vb.)
- Ekipman onerisi (uyku tulumu, mat vs.)

2. YOL DURUMU VE ROTA ANALIZI
- Tahmini sure, kritik noktalar, yol kalitesi
- Saat onerisi (gidis/donus), surus riskleri

3. KAMP ALANI ANALIZI
- Artilar/eksiler, kimler icin uygun
- Kalabalik durumu

3a. ALAN SAYFASINDAN ELDE EDILEN BILGILER (yalnizca [ALAN_SAYFASI] verisi mevcutsa)
- Puanlama / yildiz durumu ve genel misafir memnuniyeti
- Mevcut olanaklar ve tesisler (elektrik, dus, wc, wifi, havuz, market vb.)
- Ziyaretci yorumlarindan one cikan artilari ve eksiler
- Guncel fiyatlar ve konaklama secenekleri
- Ozel kurallar, check-in/out saatleri, evcil hayvan politikasi

4. ALTERNATIF KAMP ALANLARI
- En az 3 alternatif, her biri icin kisa bilgi

5. TEMEL IHTIYACLAR
- Market, su, elektrik, tuvalet, dus
- Onceden alinmasi gerekenler

6. KRITIK SAHA TAVSIYELERI
- Ruzgar, zemin, guvenlik, hayvanlar
- Bilinmezse sorun yasanir maddeleri

Kurallar:
- Madde madde ama aciklayici yaz
- Deneyimli kampci gibi konus
- Riskleri ozellikle belirt
- Net oneri yap
- ONEMLI: Konaklama turu ne ise (cadir, bungalov, karavan vb.) tum analiz O TURUNE gore yap. Baska tur icin ekipman veya oneri yapma.
- 3a bolumu yalnizca [ALAN_SAYFASI] verisi varsa yaz; yoksa atla.
- [KAMP_ALANI_DB] verisi varsa 3. KAMP ALANI ANALIZI bolumunde olanaklar, puan ve ucret bilgisi olarak kullan.
- [ALAN_SAYFASI] verisini kullanirken ham HTML kalintisi olan duzensiz cumleleri atla, anlamli bilgileri ozetle.
- [WEB_ARASTIRMA] verisi mevcutsa: OSM etiketlerini (tesis/olanak/kapasite) KAMP ALANI ANALIZI icerisinde kullan. Google yorumlarini ayri bir alt baslik olarak "Ziyaretci Yorumlarindan One Cikanlar" seklinde ozet sun; ham yorum metnini aynen kopyalama, yorumla.
- Turkce yaz, Markdown kullan`;

const TOKEN_BUDGET = 3500; // Varsayılan (Groq free tier: 6000 TPM toplam, output icin ~2500 birak)

// ---------------------------------------------------------------------------
// Yapısal (structured) çıktı için sistem promptu
// ---------------------------------------------------------------------------
const STRUCTURED_SYSTEM_PROMPT = `Sen bir kamp planlama asistanisin. Verilen verileri analiz ederek SADECE gecerli JSON don. Baska hicbir metin, aciklama veya markdown ekleme.

CIKTI FORMATI (salt JSON):
{
  "score":"X/10",
  "stats":[{"icon":string,"label":string,"value":string,"severity":"good"|"warning"|"danger"|"info"}],
  "categories":[{
    "icon":string,"title":string,"severity":"good"|"warning"|"danger"|"info",
    "highlight":string|null,"isWeather":boolean,"items":[...EvalItem]
  }]
}

EVALITEM TIPLERI (type alanina gore):
{"type":"bullet","text":string}
{"type":"subheading","text":string}
{"type":"weather-day","date":string,"dayTemp":number,"nightTemp":number,"rain":number,"wind":number,"condition":string}
{"type":"alert","text":string,"severity":"warning"|"danger"|"info"}
{"type":"key-value","label":string,"value":string,"icon":string,"severity":"good"|"warning"|"danger"|"info"}
{"type":"rating","label":string,"value":number,"max":number}
{"type":"progress","label":string,"percent":number}

ZORUNLU ALANLAR:
- score: Genel degerlendrme puani "X/10" formatinda
- stats: 3-5 adet ozet metrik (sicaklik, yagis, ruzgar, mesafe vb.)
  Ornek: {"icon":"Thermometer","label":"Sicaklik","value":"18°C","severity":"good"}

KATEGORILER (sirayla):
1. icon:"CloudSun" title:"Hava Durumu Analizi" isWeather:true severity:hava riskine gore
   highlight: ortalama sicaklik
   - weather-day itemlari (date:"17.04.2026" formatinda, dayTemp/nightTemp Celsius, rain 0-100, wind km/s, condition Turkce)
   - Ekipman onerileri bullet
   - Risk varsa alert
2. icon:"Navigation" title:"Yol ve Rota" isWeather:false severity:yol durumuna gore
   highlight: tahmini sure
   - Sure ve mesafe key-value
   - Yol notlari bullet
   - Riskli yol alert
3. icon:"Tent" title:"Kamp Alani" isWeather:false severity:genel duruma gore
   highlight: varsa puan
   - Puan varsa rating (max:5)
   - Ucret/kapasite key-value
   - Artilar/eksiler bullet
4. icon:"Info" title:"Alan Detaylari" isWeather:false — YALNIZCA [ALAN_SAYFASI], [KAMP_ALANI_DB] veya [WEB_ARASTIRMA] varsa uret, yoksa bu kategoriyi EKLEME
   - Tesisler/olanaklar bullet ([WEB_ARASTIRMA] OSM verisi dahil)
   - Fiyat key-value
   - [WEB_ARASTIRMA] Google yorumlari varsa: rating item (max:5) + en cok tekrar eden artilari/eksiler bullet
5. icon:"MapPin" title:"Alternatif Alanlar" isWeather:false — YALNIZCA [ALTERNATIF] verisi varsa uret
   - Her alan key-value (label: ad, value: mesafe+puan)
6. icon:"ShoppingBag" title:"Temel Ihtiyaclar" isWeather:false
   - Gerekli malzemeler bullet
7. icon:"AlertTriangle" title:"Kritik Tavsiyeler" isWeather:false severity:"warning"
   - Uyarilar alert
   - Tavsiyeler bullet

KURALLAR:
- Konaklama turu ne ise TUM analiz O TURUNE gore yap
- Riskler mutlaka alert ile belirt
- Veri olmayan kategorileri EKLEME (site_details, alternatives)
- [WEB_ARASTIRMA] verisi varsa: Google rating degerini 4. kategoride rating item olarak, Google yorumlarindaki tekrar eden temaları bullet item olarak ekle
- Sadece gecerli JSON don
- Turkce yaz`;

class PromptBuilder {
  constructor() {
    this._modules = [];
  }

  register(module) {
    this._modules.push(module);
    return this;
  }

  build(ctx) {
    const isReasoning = (process.env.GROQ_MODEL ?? '').includes('qwen3') ||
      (process.env.GROQ_MODEL ?? '').includes('gpt-oss');
    const useSystem = !isReasoning || process.env.GROQ_REASONING === 'false';

    // Modül çıktılarını topla
    const activeModules = [];
    const parts = [];
    for (const mod of this._modules) {
      const snippet = mod.buildPrompt(ctx);
      if (snippet) {
        parts.push(snippet);
        activeModules.push(mod.id);
      }
    }

    // Konum satırı
    const loc = [];
    if (ctx.campingArea?.name) {
      loc.push(`Hedef: ${ctx.campingArea.name} (${ctx.campingArea.lat ?? '?'},${ctx.campingArea.lng ?? '?'})`);
    }
    if (ctx.userLocation?.lat) {
      loc.push(`Cikis konumu: (${ctx.userLocation.lat},${ctx.userLocation.lng})`);
    } else {
      loc.push('Cikis konumu: bilinmiyor');
    }
    if (ctx.userLocation?.lat && ctx.campingArea?.lat) {
      const dLat = ((ctx.campingArea.lat - ctx.userLocation.lat) * Math.PI) / 180;
      const dLng = ((ctx.campingArea.lng - ctx.userLocation.lng) * Math.PI) / 180;
      const h = Math.sin(dLat / 2) ** 2 +
        Math.cos((ctx.userLocation.lat * Math.PI) / 180) *
        Math.cos((ctx.campingArea.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
      const dist = (2 * 6371 * Math.asin(Math.sqrt(h))).toFixed(0);
      loc.push(`~${dist}km`);
    }

    const dateLine = `Tarih: ${ctx.dateRange?.start ?? 'bugun'} - ${ctx.dateRange?.end ?? '?'}`;
    const typeLine = `Konaklama: ${ctx.campType ?? '?'}`;

    // User content'i oluştur
    let dataBlock = parts.join('\n');

    // Reasoning modellerde system prompt user mesajına eklenir
    const sysText = useSystem ? '' : SYSTEM_PROMPT + '\n---\n';

    let userContent = `${sysText}${dateLine} | ${typeLine}\n${loc.join(' | ')}\n\n${dataBlock}`;

    // Token bütçe kontrolü
    const sysTokens = useSystem ? estimateTokens(SYSTEM_PROMPT) : 0;
    let totalTokens = sysTokens + estimateTokens(userContent);

    // Bütçeyi aşıyorsa veri bloğunu kırp
    if (totalTokens > TOKEN_BUDGET) {
      const available = TOKEN_BUDGET - sysTokens - estimateTokens(`${sysText}${dateLine} | ${typeLine}\n${loc.join(' | ')}\n\n`);
      const maxChars = Math.max(200, Math.floor(available * 3.5));
      dataBlock = dataBlock.slice(0, maxChars);
      userContent = `${sysText}${dateLine} | ${typeLine}\n${loc.join(' | ')}\n\n${dataBlock}`;
      console.log(`[PROMPT] Token budge asildi, veri ${maxChars} karaktere kirpildi`);
    }

    console.log(`[PROMPT] Tahmini token: ~${sysTokens + estimateTokens(userContent)} (budget: ${TOKEN_BUDGET})`);

    const messages = useSystem
      ? [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }]
      : [{ role: 'user', content: userContent }];

    return { messages, modules: activeModules };
  }

  /**
   * Yapısal (structured) JSON çıktısı için prompt üretir.
   * build() ile aynı veri hazırlığını yapar, yalnızca sistem promptu farklıdır.
   * @param {object} ctx - EvaluationContext
   * @param {object} [opts]
   * @param {number} [opts.tokenBudget] - Input token bütçesi (provider'a göre ayarlanır)
   */
  buildStructured(ctx, opts = {}) {
    const tokenBudget = opts.tokenBudget ?? TOKEN_BUDGET;
    const isReasoning = (process.env.GROQ_MODEL ?? '').includes('qwen3') ||
      (process.env.GROQ_MODEL ?? '').includes('gpt-oss');
    const useSystem = !isReasoning || process.env.GROQ_REASONING === 'false';

    const activeModules = [];
    const parts = [];
    for (const mod of this._modules) {
      const snippet = mod.buildPrompt(ctx);
      if (snippet) {
        parts.push(snippet);
        activeModules.push(mod.id);
      }
    }

    const loc = [];
    if (ctx.campingArea?.name) {
      loc.push(`Hedef: ${ctx.campingArea.name} (${ctx.campingArea.lat ?? '?'},${ctx.campingArea.lng ?? '?'})`);
    }
    if (ctx.userLocation?.lat) {
      loc.push(`Cikis: (${ctx.userLocation.lat},${ctx.userLocation.lng})`);
    }
    if (ctx.userLocation?.lat && ctx.campingArea?.lat) {
      const dLat = ((ctx.campingArea.lat - ctx.userLocation.lat) * Math.PI) / 180;
      const dLng = ((ctx.campingArea.lng - ctx.userLocation.lng) * Math.PI) / 180;
      const h = Math.sin(dLat / 2) ** 2 +
        Math.cos((ctx.userLocation.lat * Math.PI) / 180) *
        Math.cos((ctx.campingArea.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
      loc.push(`~${(2 * 6371 * Math.asin(Math.sqrt(h))).toFixed(0)}km`);
    }

    const dateLine = `Tarih: ${ctx.dateRange?.start ?? 'bugun'} - ${ctx.dateRange?.end ?? '?'}`;
    const typeLine = `Konaklama: ${ctx.campType ?? '?'}`;

    let dataBlock = parts.join('\n');
    const sysText = useSystem ? '' : STRUCTURED_SYSTEM_PROMPT + '\n---\n';
    // /no_think: qwen3'e özgü — modelin <think> bloğu üretmesini engelleyerek
    // tüm token bütçesini JSON çıktısına ayırır
    let userContent = `${sysText}${dateLine} | ${typeLine}\n${loc.join(' | ')}\n\n${dataBlock}\n/no_think`;

    const sysTokens = useSystem ? estimateTokens(STRUCTURED_SYSTEM_PROMPT) : 0;
    const totalTokens = sysTokens + estimateTokens(userContent);

    if (totalTokens > tokenBudget) {
      const available = tokenBudget - sysTokens - estimateTokens(`${sysText}${dateLine} | ${typeLine}\n${loc.join(' | ')}\n\n`);
      const maxChars = Math.max(200, Math.floor(available * 3.5));
      dataBlock = dataBlock.slice(0, maxChars);
      userContent = `${sysText}${dateLine} | ${typeLine}\n${loc.join(' | ')}\n\n${dataBlock}`;
      console.log(`[PROMPT] Structured — token budget asildi, veri ${maxChars} karaktere kirpildi`);
    }

    console.log(`[PROMPT] Structured — Tahmini token: ~${sysTokens + estimateTokens(userContent)} (budget: ${tokenBudget})`);

    const messages = useSystem
      ? [{ role: 'system', content: STRUCTURED_SYSTEM_PROMPT }, { role: 'user', content: userContent }]
      : [{ role: 'user', content: userContent }];

    return { messages, modules: activeModules };
  }
}

module.exports = {
  PromptBuilder,
  WeatherModule,
  AnnouncementModule,
  AlternativeLocationModule,
  RouteConditionModule,
  HikingTrailModule,
  BookingUrlModule,
  CampgroundDetailModule,
  WebResearchModule,
  estimateTokens,
};
