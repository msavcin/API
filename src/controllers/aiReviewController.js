/**
 * AI Review Controller
 * Google Places entegrasyonu ve AI ile kamp alanı değerlendirme
 */

const { Client } = require('@googlemaps/google-maps-services-js');
const db = require('../models');
const { AIAdapterFactory } = require('../services/aiAdapter');
const { researchLocation } = require('../services/webResearchService');
const { fetchGoogleAIOverview, formatAIOverviewForPrompt } = require('../services/googleAIOverviewService');
const Sequelize = require('sequelize');
const { Op } = Sequelize;

// Google Places client
const googleMapsClient = new Client({});

// AI provider seçimi (.env dosyasından)
const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';
const AI_REVIEW_TEMPERATURE = parseFloat(process.env.AI_REVIEW_TEMPERATURE || '0.35');
const AI_REVIEW_MAX_TOKENS = parseInt(process.env.AI_REVIEW_MAX_TOKENS || '900', 10);
// Groq ücretsiz/on_demand kotasında toplu değerlendirmelerde hızlıca rate-limit oluşuyor.
// Varsayılan olarak yorum metinlerinden kural tabanlı güvenli değerlendirme üretiyoruz.
// LLM kullanmak istenirse .env: AI_REVIEW_USE_LLM=true yapılabilir.
const AI_REVIEW_USE_LLM = process.env.AI_REVIEW_USE_LLM === 'true';
const AI_REVIEW_LLM_FOR_BATCH = process.env.AI_REVIEW_LLM_FOR_BATCH === 'true';
const AI_REVIEW_MAX_REVIEW_CHARS = parseInt(process.env.AI_REVIEW_MAX_REVIEW_CHARS || '1800', 10);
// Eğer LLM kapalıysa bile Groq/DeepSeek gibi uzak sağlayıcılarla değerlendirme
// yapılmasını isterseniz şu env değişkenini kullanın (örnek: "groq,deepseek"):
// AI_REVIEW_FALLBACK_PROVIDERS=groq,deepseek
const AI_REVIEW_FALLBACK_PROVIDERS = (process.env.AI_REVIEW_FALLBACK_PROVIDERS || '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

// Peak window config (UTC hours) — plannerController ile uyumlu env değişkenleri kullanır
const AI_PEAK_START_UTC = Number.parseInt(process.env.AI_PEAK_START_UTC ?? '', 10);
const AI_PEAK_END_UTC = Number.parseInt(process.env.AI_PEAK_END_UTC ?? '', 10);
function isPeakNow() {
  if (!Number.isFinite(AI_PEAK_START_UTC) || !Number.isFinite(AI_PEAK_END_UTC)) return false;
  const hour = new Date().getUTCHours();
  if (AI_PEAK_START_UTC <= AI_PEAK_END_UTC) {
    return hour >= AI_PEAK_START_UTC && hour < AI_PEAK_END_UTC;
  }
  return hour >= AI_PEAK_START_UTC || hour < AI_PEAK_END_UTC;
}

// Provider override for AI review (optional)
const AI_REVIEW_PROVIDER_PEAK = process.env.AI_REVIEW_PROVIDER_PEAK || '';
const AI_REVIEW_PROVIDER_OFFPEAK = process.env.AI_REVIEW_PROVIDER_OFFPEAK || '';
const AI_REVIEW_FALLBACK_PROVIDERS_PEAK = (process.env.AI_REVIEW_FALLBACK_PROVIDERS_PEAK || '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);
const AI_REVIEW_FALLBACK_PROVIDERS_OFFPEAK = (process.env.AI_REVIEW_FALLBACK_PROVIDERS_OFFPEAK || '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

/**
 * Helper: booking_url'den Google Place ID parse et
 * Not: CID formatı Google Places API tarafından desteklenmediği için atlanır
 */
function parseGooglePlaceIdFromUrl(bookingUrl) {
  if (!bookingUrl) return null;

  try {
    const url = new URL(bookingUrl);
    
    // Format 1: place_id parametresi (gerçek place_id)
    const placeId = url.searchParams.get('place_id');
    if (placeId) return placeId;

    // Format 2: q parametresinde place_id
    const q = url.searchParams.get('q');
    if (q && q.includes('place_id:')) {
      const match = q.match(/place_id:([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }

    // Format 3: URL path'de place ID
    const pathMatch = url.pathname.match(/place\/([A-Za-z0-9_-]+)/);
    if (pathMatch) return pathMatch[1];

    // CID formatını atla - Google Places API desteklemiyor
    // Bunun yerine isim+koordinat araması yapılacak

  } catch (e) {
    console.warn('URL parse hatası:', e);
  }

  return null;
}

/**
 * Helper: 6 ay cooldown kontrolü
 */
function isCooldownExpired(lastEvaluatedDate) {
  if (!lastEvaluatedDate) return true;
  
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  return new Date(lastEvaluatedDate) < sixMonthsAgo;
}

/**
 * Helper: Günlük limit kontrolü
 */
async function checkDailyLimit() {
  try {
    // Admin settings'den limiti al
    const limitSetting = await db.AppSetting.findOne({
      where: { key: 'ai_review_daily_limit' }
    });
    const dailyLimit = parseInt(limitSetting?.value || '100', 10);

    // Bugün yapılan değerlendirme sayısını al
    const todayCount = await db.Campground.count({
      where: {
        ai_review_generated_at: {
          [Op.gte]: Sequelize.fn('DATE', Sequelize.literal('CURRENT_DATE'))
        }
      }
    });

    return {
      limit: dailyLimit,
      used: todayCount,
      remaining: Math.max(0, dailyLimit - todayCount),
      canProceed: todayCount < dailyLimit
    };
  } catch (error) {
    console.error('Günlük limit kontrolü hatası:', error);
    return {
      limit: 100,
      used: 0,
      remaining: 100,
      canProceed: true
    };
  }
}

const GENERIC_AI_REVIEW_PATTERNS = [
  /detayl[ıi]\s+bilgi\s+i[cç]in\s+google\s+places/i,
  /bu\s+kamp\s+alan[ıi]\s+hakk[ıi]nda(?:\s+google\s+places\s+(?:üzerinde|[üu]zerinde))?\s+[\w\s]+\s+kullan[ıi]c[ıi]\s+yorumu\s+bulunmaktad[ıi]r/i,
  /google\s+places\s+(?:üzerinde|[üu]zerinde|['’]te).*kullan[ıi]c[ıi]\s+yorumu\s+bulunmaktad[ıi]r/i,
];

const REVIEW_POSITIVE_WORDS = [
  'güzel', 'guzel', 'harika', 'mükemmel', 'mukemmel', 'iyi', 'temiz', 'sakin',
  'huzurlu', 'ilgili', 'yardımcı', 'yardimci', 'beğendik', 'begendik', 'memnun',
  'tavsiye', 'öneririm', 'oneririm', 'uygun', 'ferah', 'keyifli', 'rahat', 'başarılı', 'basarili'
];

const REVIEW_NEGATIVE_WORDS = [
  'kötü', 'kotu', 'pis', 'kirli', 'pahalı', 'pahali', 'kalabalık', 'kalabalik',
  'gürültü', 'gurultu', 'yetersiz', 'sorun', 'problem', 'bozuk', 'ilgisiz',
  'zor', 'eksik', 'çöp', 'cop', 'rahatsız', 'rahatsiz', 'şikayet', 'sikayet',
  'beğenmedik', 'begenmedik', 'berbat', 'rezalet'
];

const REVIEW_TOPIC_RULES = [
  {
    key: 'location',
    label: 'konum ve ulaşım',
    keywords: ['konum', 'lokasyon', 'ulaşım', 'ulasim', 'yol', 'yakın', 'yakin', 'merkez'],
    pro: 'Konum, yakınlık veya ulaşım yorumlarda olumlu öne çıkıyor.',
    con: 'Konum, yol veya ulaşım tarafında dikkat edilmesi gereken yorumlar var.',
    mixed: 'Konum ve ulaşım konusunda hem memnuniyet hem de dikkat edilmesi gereken deneyimler aktarılmış.',
  },
  {
    key: 'cleanliness',
    label: 'temizlik ve hijyen',
    keywords: ['temiz', 'temizlik', 'hijyen', 'pis', 'kirli', 'çöp', 'cop'],
    pro: 'Temizlik ve düzen konusunda olumlu geri bildirimler bulunuyor.',
    con: 'Temizlik, hijyen veya çevre düzeniyle ilgili olumsuz geri bildirimler var.',
    mixed: 'Temizlik ve hijyen algısı yorumlara göre değişiyor; bazı kullanıcılar memnunken bazıları bakım beklentisini vurgulamış.',
  },
  {
    key: 'facilities',
    label: 'tesis olanakları',
    keywords: ['tuvalet', 'wc', 'duş', 'dus', 'banyo', 'elektrik', 'su', 'tesis', 'olanak', 'imkan', 'imkân'],
    pro: 'Tuvalet, duş, su/elektrik gibi tesis olanakları bazı yorumlarda artı olarak belirtiliyor.',
    con: 'Tuvalet, duş, su/elektrik veya tesis altyapısı konusunda eksiklerden söz ediliyor.',
    mixed: 'Tesis olanakları konusunda yorumlar karışık; bazı kullanıcılar imkanları yeterli bulurken bazıları altyapı ve bakım tarafında eksik belirtmiş.',
  },
  {
    key: 'staff',
    label: 'işletme ve personel',
    keywords: ['personel', 'işletme', 'isletme', 'çalışan', 'calisan', 'sahip', 'ilgi', 'ilgili', 'yardımcı', 'yardimci'],
    pro: 'İşletme veya personel ilgisi olumlu yorumlanan başlıklar arasında.',
    con: 'İşletme/personel iletişimi veya hizmet yaklaşımıyla ilgili olumsuz deneyimler aktarılmış.',
    mixed: 'İşletme ve personel deneyimi yorumlarda tek yönlü değil; olumlu iletişim kadar bazı olumsuz temaslar da aktarılmış.',
  },
  {
    key: 'atmosphere',
    label: 'sakinlik ve atmosfer',
    keywords: ['sakin', 'sessiz', 'huzur', 'huzurlu', 'kalabalık', 'kalabalik', 'gürültü', 'gurultu', 'müzik', 'muzik'],
    pro: 'Sakinlik ve huzurlu atmosfer olumlu yön olarak öne çıkıyor.',
    con: 'Kalabalık, gürültü veya sakinlik beklentisiyle ilgili uyarılar var.',
    mixed: 'Atmosfer ve sakinlik beklentisi kullanıcıya göre değişiyor; bazı yorumlar huzuru, bazıları kalabalık/gürültü ihtimalini vurguluyor.',
  },
  {
    key: 'price',
    label: 'fiyat ve performans',
    keywords: ['fiyat', 'ücret', 'ucret', 'pahalı', 'pahali', 'ucuz', 'uygun', 'performans'],
    pro: 'Fiyat/performans algısı bazı yorumlarda olumlu değerlendiriliyor.',
    con: 'Fiyat, ücret veya alınan hizmetin karşılığı konusunda eleştiriler var.',
    mixed: 'Fiyat/performans algısı yorumlarda karışık; bazı kullanıcılar makul bulurken bazıları ücret-hizmet dengesini sorgulamış.',
  },
  {
    key: 'nature',
    label: 'doğal çevre ve manzara',
    keywords: ['manzara', 'deniz', 'sahil', 'plaj', 'göl', 'gol', 'orman', 'doğa', 'doga', 'çevre', 'cevre'],
    pro: 'Doğal çevre, manzara veya deniz/sahil yakınlığı olumlu şekilde anılıyor.',
    con: 'Çevre koşulları, doğal alan kullanımı veya bakım konusunda olumsuz notlar var.',
    mixed: 'Doğal çevre ve manzara güçlü bir unsur olsa da çevre bakımı konusunda farklı deneyimler aktarılmış.',
  },
  {
    key: 'safety_family',
    label: 'güvenlik ve aile uygunluğu',
    keywords: ['güvenli', 'guvenli', 'güvenlik', 'guvenlik', 'aile', 'çocuk', 'cocuk'],
    pro: 'Güvenlik veya aileye uygunluk açısından olumlu yorumlar bulunuyor.',
    con: 'Güvenlik, aile/çocuk uygunluğu veya alan düzeniyle ilgili çekinceler belirtilmiş.',
    mixed: 'Güvenlik ve aile uygunluğu konusunda yorumlar sınırlı veya karışık; beklentiye göre önceden bilgi almak faydalı olabilir.',
  },
];

function normalizeReviewText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function hasAnyWord(text, words) {
  return words.some((word) => text.includes(word));
}

function uniqueNonEmpty(items, limit = 5) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const clean = normalizeReviewText(item);
    if (!clean) continue;
    const key = clean.toLocaleLowerCase('tr-TR');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= limit) break;
  }
  return result;
}

function isGenericAIReviewText(text) {
  const raw = normalizeReviewText(text);
  if (!raw) return true;

  // Genişletilmiş başlık eşlemeleri (Türkçe + İngilizce yaygın varyantlar)
  const prosHeaderRegex = /(?:Artılar|Avantajlar|Pros|Advantages|Positives|Olumlu|Güçlü Yönler)/i;
  const consHeaderRegex = /(?:Eksiler|Dezavantajlar|Cons|Disadvantages|Negatives|Olumsuz|Zayıf Yönler)/i;

  const hasProsConsHeaders = prosHeaderRegex.test(text || '') && consHeaderRegex.test(text || '');

  // Alternatif: Başlık yoksa madde işaretleri ve hem olumlu hem olumsuz kelimelerin varlığı
  const rawLower = raw.toLocaleLowerCase('tr-TR');
  const bulletLines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-•\*]\s+/.test(l) || /^\d+\./.test(l));
  const hasPosWords = REVIEW_POSITIVE_WORDS.some((w) => rawLower.includes(w));
  const hasNegWords = REVIEW_NEGATIVE_WORDS.some((w) => rawLower.includes(w));
  const altProsCons = bulletLines.length >= 2 && hasPosWords && hasNegWords;

  const hasProsCons = hasProsConsHeaders || altProsCons;
  const isGeneric = GENERIC_AI_REVIEW_PATTERNS.some((pattern) => pattern.test(raw));

  return isGeneric || !hasProsCons;
}

function resolveReviewTopics(topicScores) {
  const pros = [];
  const cons = [];
  const mixed = [];

  topicScores.forEach((topic) => {
    const pro = topic.pro || 0;
    const con = topic.con || 0;
    if (pro <= 0 && con <= 0) return;

    // Aynı başlığı hem artıya hem eksiye yazma. Dengeli/karışık durumları
    // madde listesine değil değerlendirme paragrafına taşı.
    if (pro > 0 && con > 0) {
      if (pro >= con + 2) {
        pros.push(topic.rule.pro);
      } else if (con >= pro + 2) {
        cons.push(topic.rule.con);
      } else {
        mixed.push(topic.rule.mixed || `${topic.rule.label || 'Bazı başlıklar'} için yorumlar karışık; deneyim kullanıcı beklentisine göre değişebilir.`);
      }
      return;
    }

    if (pro > 0) pros.push(topic.rule.pro);
    if (con > 0) cons.push(topic.rule.con);
  });

  return {
    pros: uniqueNonEmpty(pros, 5),
    cons: uniqueNonEmpty(cons, 5),
    mixed: uniqueNonEmpty(mixed, 3),
  };
}

function buildNarrativeReview(campgroundName, totalReviewCount, averageRating, pros, cons, mixed, commentCount) {
  const areaName = campgroundName || 'Bu kamp alanı';
  const countLabel = totalReviewCount > 0 ? `${totalReviewCount} yorum` : 'mevcut yorumlar';
  const ratingSentence = typeof averageRating === 'number'
    ? ` İncelenen yorumlarda puan ortalaması yaklaşık ${averageRating.toFixed(1)}/5 seviyesinde.`
    : '';

  const positiveSentence = pros.length > 0
    ? ` Olumlu tarafta ${pros.slice(0, 3).map((item) => item.replace(/\.$/, '').toLocaleLowerCase('tr-TR')).join(', ')} gibi noktalar öne çıkıyor.`
    : ' Olumlu yönler yorumlarda belirgin bir başlık altında yoğunlaşmıyor.';

  const cautionSentence = cons.length > 0
    ? ` Dikkat edilmesi gereken taraflarda ise ${cons.slice(0, 3).map((item) => item.replace(/\.$/, '').toLocaleLowerCase('tr-TR')).join(', ')} başlıkları görülüyor.`
    : ' Tekrar eden güçlü bir olumsuz başlık öne çıkmadığı için genel izlenim daha dengeli görünüyor.';

  const mixedSentence = mixed.length > 0
    ? ` Bazı konularda yorumlar karışık: ${mixed.map((item) => item.replace(/\.$/, '').toLocaleLowerCase('tr-TR')).join('; ')}. Bu nedenle bu başlıklar artı/eksi listelerinde tekrar edilmeden genel değerlendirmede tutuldu.`
    : '';

  const firstParagraph = `${areaName} için kullanıcı yorumları incelendiğinde ${countLabel} içinde kamp deneyimini etkileyen başlıklar daha çok konfor, hizmet, çevre koşulları ve beklenti yönetimi etrafında toplanıyor.${ratingSentence}${positiveSentence}`;
  const secondParagraph = `${cautionSentence}${mixedSentence ? ` ${mixedSentence}` : ''} Bu nedenle alanı değerlendiren kampçıların, özellikle kendi önceliklerine göre yorumlardaki bu ayrımları dikkate alması faydalı olur.`;
  const thirdParagraph = commentCount > 0
    ? `Genel tablo, kısa ziyaret veya konaklama planlayan kullanıcılar için güçlü yanların yanında kontrol edilmesi gereken birkaç pratik nokta olduğunu gösteriyor.`
    : `Ayrıntılı yorum metni sınırlı olduğu için değerlendirme temkinli tutulmuştur.`;

  return [firstParagraph, secondParagraph, thirdParagraph].join('\n\n');
}

function parseAIReviewBullets(text) {
  const raw = typeof text === 'string' ? text : '';

  // Daha geniş başlık seti: Türkçe ve İngilizce varyantlar
  const prosHeader = '(?:Artılar|Avantajlar|Pros|Advantages|Positives|Olumlu|Güçlü Yönler)';
  const consHeader = '(?:Eksiler|Dezavantajlar|Cons|Disadvantages|Negatives|Olumsuz|Zayıf Yönler)';

  const prosMatch = raw.match(new RegExp(`${prosHeader}\s*:\s*([\s\S]*?)(?=(?:\n\s*${consHeader}\s*:)|$)`, 'i'));
  const consMatch = raw.match(new RegExp(`${consHeader}\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:Not|Sonuç|Conclusion)\s*:)|$)`, 'i'));

  const parseBullets = (block) => !block ? [] : block
    .split(/\r?\n/)
    .map((line) => normalizeReviewText(line).replace(/^[\-\*•\s\d\.]+/, '').trim())
    .filter(Boolean);

  // Eğer başlıklar bulunmuyorsa, madde işaretli blokları ayıkla ve içeriğe göre sınıflandır
  if (!prosMatch?.[1] && !consMatch?.[1]) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const pros = [];
    const cons = [];
    for (const line of lines) {
      const clean = line.replace(/^[\-\*•\s\d\.]+/, '').trim();
      if (!clean) continue;
      const low = clean.toLocaleLowerCase('tr-TR');
      const isPos = REVIEW_POSITIVE_WORDS.some((w) => low.includes(w));
      const isNeg = REVIEW_NEGATIVE_WORDS.some((w) => low.includes(w));
      if (isPos && !isNeg) pros.push(clean);
      else if (isNeg && !isPos) cons.push(clean);
      else {
        // Eğer karışık görünüyorsa, hem pro hem con adaylarına kat
        if (isPos) pros.push(clean);
        if (isNeg) cons.push(clean);
      }
    }

    return { pros: uniqueNonEmpty(pros), cons: uniqueNonEmpty(cons) };
  }

  return {
    pros: parseBullets(prosMatch?.[1]),
    cons: parseBullets(consMatch?.[1]),
  };
}

function getBulletTopicKeys(bullet) {
  const lower = normalizeReviewText(bullet).toLocaleLowerCase('tr-TR');
  return REVIEW_TOPIC_RULES
    .map((rule, index) => ({ key: rule.key || rule.label || String(index), rule }))
    .filter(({ rule }) => hasAnyWord(lower, rule.keywords))
    .map(({ key }) => key);
}

function hasContradictoryProsCons(text) {
  const raw = normalizeReviewText(text);
  if (!raw) return false;

  // Eğer metinde açıkça 'karışık' / 'dengeli' gibi ifadeler varsa çelişki sayma
  if (/(karışık|karisik|dengeli|mixed|ambiguous|her iki|both|hem\s+.*\s+hem)/i.test(raw)) return false;

  const { pros, cons } = parseAIReviewBullets(text);
  if (pros.length === 0 || cons.length === 0) return false;

  const proTopics = new Set(pros.flatMap(getBulletTopicKeys));
  const conTopics = new Set(cons.flatMap(getBulletTopicKeys));
  const intersection = [...proTopics].filter((t) => conTopics.has(t));

  if (intersection.length === 0) return false;

  // Küçük örtüşmeler toleranslı olsun: örtüşme küçükse çelişki sayma
  const proCount = proTopics.size || 1;
  const conCount = conTopics.size || 1;
  const relativeOverlap = intersection.length / Math.min(proCount, conCount);
  if (relativeOverlap <= 0.4) return false;

  // Diğer durumlarda çelişkili kabul et
  return true;
}

function buildRuleBasedReviewEvaluation(campgroundName, totalReviewCount = 0, reviews = []) {
  const normalizedReviews = (Array.isArray(reviews) ? reviews : [])
    .map((review) => {
      const text = normalizeReviewText(review?.text || review?.comment || review?.review_text || '');
      const rating = review?.rating != null ? Number(review.rating) : null;
      return {
        text,
        rating: rating != null && Number.isFinite(rating) ? rating : null,
      };
    })
    .filter((review) => review.text || review.rating != null);

  const commentReviews = normalizedReviews.filter((review) => review.text);
  const ratedReviews = normalizedReviews.filter((review) => review.rating != null);
  const averageRating = ratedReviews.length > 0
    ? ratedReviews.reduce((sum, review) => sum + Number(review.rating), 0) / ratedReviews.length
    : null;

  const topicScores = REVIEW_TOPIC_RULES.map((rule) => ({ rule, pro: 0, con: 0 }));
  let positiveGeneral = 0;
  let negativeGeneral = 0;

  commentReviews.forEach((review) => {
    const text = review.text.toLocaleLowerCase('tr-TR');
    const explicitPositive = hasAnyWord(text, REVIEW_POSITIVE_WORDS);
    const explicitNegative = hasAnyWord(text, REVIEW_NEGATIVE_WORDS);
    const positive = (typeof review.rating === 'number' && review.rating >= 4) || explicitPositive;
    const negative = (typeof review.rating === 'number' && review.rating <= 2) || explicitNegative;

    let matchedTopic = false;
    topicScores.forEach((topic) => {
      if (!hasAnyWord(text, topic.rule.keywords)) return;
      matchedTopic = true;
      if (positive) topic.pro += 1;
      if (negative) topic.con += 1;
    });

    if (!matchedTopic) {
      if (positive) positiveGeneral += 1;
      if (negative) negativeGeneral += 1;
    }
  });

  const resolved = resolveReviewTopics(topicScores);
  const pros = [...resolved.pros];
  const cons = [...resolved.cons];
  const mixed = [...resolved.mixed];

  if (positiveGeneral > 0) {
    pros.push('Yorumların bir bölümünde genel memnuniyet ve tavsiye etme eğilimi görülüyor.');
  }
  if (negativeGeneral > 0) {
    cons.push('Bazı yorumlarda genel memnuniyetsizlik veya beklentinin karşılanmaması dikkat çekiyor.');
  }

  if (pros.length === 0) {
    if (typeof averageRating === 'number' && averageRating >= 4) {
      pros.push('Genel puan ortalaması olumlu görünüyor; kullanıcı deneyimi ağırlıklı olarak memnuniyet yönünde.');
    } else if (commentReviews.length > 0) {
      pros.push('Yorumlarda belirgin bir olumlu tema ayrışmıyor; kullanıcı yorumları arttıkça tablo netleşecektir.');
    } else {
      pros.push('Olumlu yönleri güvenilir biçimde çıkarmak için yeterli yorum metni bulunmuyor.');
    }
  }

  if (cons.length === 0) {
    if (typeof averageRating === 'number' && averageRating < 3.5) {
      cons.push('Genel puan ortalaması karışık; yorum metinleri arttıkça olumsuz başlıklar daha net ayrışacaktır.');
    } else if (commentReviews.length > 0) {
      cons.push('Yorumlarda tekrar eden belirgin bir olumsuz başlık öne çıkmıyor.');
    } else {
      cons.push('Olumsuz yönleri güvenilir biçimde çıkarmak için yeterli yorum metni bulunmuyor.');
    }
  }

  const finalPros = uniqueNonEmpty(pros, 5);
  const finalCons = uniqueNonEmpty(cons, 5);
  const narrative = buildNarrativeReview(
    campgroundName,
    totalReviewCount,
    averageRating,
    finalPros,
    finalCons,
    mixed,
    commentReviews.length,
  );

  return [
    narrative,
    '',
    'Artılar:',
    ...finalPros.map((item) => `- ${item}`),
    '',
    'Eksiler:',
    ...finalCons.map((item) => `- ${item}`),
    '',
    `Not: Bu değerlendirme kullanıcı yorum metinlerinden otomatik olarak oluşturulmuştur${commentReviews.length > 0 ? ` (${commentReviews.length} yorum metni analiz edildi)` : ''}.`,
  ].join('\n');
}

/**
 * JSON schema for structured AI review output
 */
const AI_REVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2-3 cümlelik kısa özet değerlendirme' },
    pros: {
      type: 'array',
      items: { type: 'string' },
      description: 'En fazla 5 olumlu özellik',
      maxItems: 5
    },
    cons: {
      type: 'array',
      items: { type: 'string' },
      description: 'En fazla 5 olumsuz özellik',
      maxItems: 5
    }
  },
  required: ['summary', 'pros', 'cons']
};

function compactReviewsForAI(reviews = [], fallbackSummary = '') {
  const lines = [];
  const sourceReviews = Array.isArray(reviews) ? reviews : [];
  for (let i = 0; i < sourceReviews.length; i += 1) {
    const review = sourceReviews[i] || {};
    const text = normalizeReviewText(review.text || review.comment || review.review_text || '');
    if (!text) continue;
    lines.push(`[Yorum ${lines.length + 1}] ${review.rating || '-'} / 5: ${text}`);
    if (lines.join('\n\n').length >= AI_REVIEW_MAX_REVIEW_CHARS) break;
  }

  const joined = lines.join('\n\n').slice(0, AI_REVIEW_MAX_REVIEW_CHARS);
  return joined || String(fallbackSummary || '').slice(0, AI_REVIEW_MAX_REVIEW_CHARS);
}

/**
 * Format structured JSON review as readable text
 */
function formatStructuredReview(reviewObj) {
  if (!reviewObj || typeof reviewObj !== 'object') return null;
  
  const summary = reviewObj.summary || '';
  const pros = Array.isArray(reviewObj.pros) ? reviewObj.pros : [];
  const cons = Array.isArray(reviewObj.cons) ? reviewObj.cons : [];
  
  if (!summary && pros.length === 0 && cons.length === 0) return null;
  
  const parts = [];
  if (summary) parts.push(summary);
  
  if (pros.length > 0) {
    parts.push('\n\nArtılar:');
    pros.forEach(p => parts.push(`- ${p}`));
  }
  
  if (cons.length > 0) {
    parts.push('\n\nEksiler:');
    cons.forEach(c => parts.push(`- ${c}`));
  }
  
  parts.push('\n\nNot: Bu değerlendirme kullanıcı yorum metinlerinden otomatik olarak oluşturulmuştur.');
  
  return parts.join('\n');
}

/**
 * Helper: AI ile kamp alanı yorumlarını değerlendir
 * @param {string} campgroundName
 * @param {string} location
 * @param {string} reviewSummary
 * @param {number} totalReviewCount
 * @param {number} sampleReviewCount
 * @param {Array} reviews
 * @param {object} options - { useLLM, webResearch, bookingUrl }
 */
async function evaluateWithAI(campgroundName, location, reviewSummary, totalReviewCount, sampleReviewCount, reviews = [], options = {}) {
  const fallbackEvaluation = () => buildRuleBasedReviewEvaluation(
    campgroundName,
    totalReviewCount,
    reviews
  );

  const useLLM = options.useLLM === true;
  const hasReviewText = Array.isArray(reviews) && reviews.some((review) => normalizeReviewText(review?.text || review?.comment || review?.review_text || '').length > 0);

  // Google AI Overview değişkenini önce tanımla (tüm return path'lerde kullanılacak)
  let aiOverviewData = null;

  if (!hasReviewText) {
    console.log('[AIReview] Yorum metni yok; LLM çağrılmadan fallback kullanılacak:', campgroundName);
    return { evaluation: fallbackEvaluation(), aiOverviewData };
  }

  // Google AI Overview çek (eğer etkinse)
  let aiOverviewContext = '';
  if (process.env.SERPAPI_KEY) {
    try {
      console.log(`[AIReview] Google AI Overview çekiliyor: ${campgroundName}`);
      aiOverviewData = await fetchGoogleAIOverview(campgroundName, location);
      aiOverviewContext = formatAIOverviewForPrompt(aiOverviewData);
      if (aiOverviewContext) {
        console.log(`[AIReview] Google AI Overview eklendi (${aiOverviewContext.length} karakter)`);
      }
    } catch (aiErr) {
      console.warn(`[AIReview] Google AI Overview hatası (devam ediliyor):`, aiErr.message);
    }
  }

  const peak = isPeakNow();

  // LLM kapalıysa fallback sağlayıcıları peak/offpeak bazlı seç
  if (!useLLM) {
    let fallbackProviders = Array.isArray(AI_REVIEW_FALLBACK_PROVIDERS) ? AI_REVIEW_FALLBACK_PROVIDERS.slice() : [];
    if (peak && AI_REVIEW_FALLBACK_PROVIDERS_PEAK.length > 0) fallbackProviders = AI_REVIEW_FALLBACK_PROVIDERS_PEAK.slice();
    else if (!peak && AI_REVIEW_FALLBACK_PROVIDERS_OFFPEAK.length > 0) fallbackProviders = AI_REVIEW_FALLBACK_PROVIDERS_OFFPEAK.slice();

    if (!fallbackProviders || fallbackProviders.length === 0) {
      console.log('[AIReview] LLM kapalı ve fallback sağlayıcı yok; yorum tabanlı kural değerlendirmesi kullanılacak:', campgroundName);
      return { evaluation: fallbackEvaluation(), aiOverviewData };
    }

    const systemPrompt = `Sen uzman bir kamp danışmanısın. Görevin, sana verilen kullanıcı yorum metinlerini ve ek bilgileri analiz ederek kampçılar için dengeli ve kullanışlı bir değerlendirme yazmak.

KESİN KURALLAR:
- Yanıtını YALNIZCA geçerli JSON formatında ver
- JSON şeması: { "summary": string, "pros": string[], "cons": string[] }
- summary: 2-3 cümlelik kısa, öz değerlendirme (kampın genel karakterini özetle)
- pros: En fazla 5 kısa, net olumlu özellik (madde başı 10-15 kelime)
- cons: En fazla 5 kısa, net olumsuz özellik (madde başı 10-15 kelime)
- Aynı konuyu hem pros hem cons'a yazma (örn: temizlik, personel, konum)
- Bir konu hem olumlu hem olumsuz ise bunu summary'de dengeli açıkla, listelerde sadece baskın tarafı göster
- "Yorum 1, Yorum 2" gibi referans kullanma
- Yorum sayısı veya "Google Places'e bakın" gibi meta bilgi verme
- Fiyat/para birimi karşılaştırması yapma (hizmet kalitesini doğrudan etkilemiyorsa)
- Ulusal kimlik/etnik grup karşılaştırması yapma
- Eğer veri yetersiz/çelişkiliyse bunu summary'de belirt

ÖRNEK ÇIKTI:
{
  "summary": "Deniz kenarında huzurlu bir kamp alanı. Temizlik ve personel ilgisi öne çıkıyor. Tesis altyapısı temel seviyede.",
  "pros": [
    "Denize sıfır konum ve huzurlu atmosfer",
    "Temiz ve düzenli çevre",
    "İlgili ve yardımsever personel",
    "Uygun fiyat/performans dengesi"
  ],
  "cons": [
    "Tuvalet ve duş tesisleri sınırlı",
    "Elektrik bağlantısı her alanda yok",
    "Yüksek sezonda kalabalık olabiliyor"
  ]
}`;

    // Web research sonuçlarını hazırla (eğer varsa)
    let webResearchContext = '';
    if (options.webResearch) {
      const wr = options.webResearch;
      const additionalInfo = [];
      
      if (wr.googlePlaces?.rating) {
        additionalInfo.push(`Google Puanı: ${wr.googlePlaces.rating}/5 (${wr.googlePlaces.totalRatings || '?'} değerlendirme)`);
      }
      if (wr.googlePlaces?.summary) {
        additionalInfo.push(`Google Özet: ${wr.googlePlaces.summary}`);
      }
      if (wr.osmTags?.description) {
        additionalInfo.push(`OSM Açıklama: ${wr.osmTags.description}`);
      }
      if (wr.osmTags?.openingHours) {
        additionalInfo.push(`Çalışma Saatleri: ${wr.osmTags.openingHours}`);
      }
      
      const facilities = [];
      if (wr.osmTags?.shower === 'yes') facilities.push('duş');
      if (wr.osmTags?.toilets === 'yes') facilities.push('tuvalet');
      if (wr.osmTags?.electricity === 'yes') facilities.push('elektrik');
      if (wr.osmTags?.drinkingWater === 'yes') facilities.push('içme suyu');
      if (facilities.length > 0) {
        additionalInfo.push(`Tesisler: ${facilities.join(', ')}`);
      }
      
      if (additionalInfo.length > 0) {
        webResearchContext = `\n\nEk bilgiler (web araştırmasından):\n${additionalInfo.join('\n')}`;
      }
    }

    const compactReviewSummary = compactReviewsForAI(reviews, reviewSummary);
    const userPrompt = `Kamp alanı: ${campgroundName}
Konum: ${location}${webResearchContext}${aiOverviewContext}

Kullanıcı yorumları (${reviews.length} adet):
${compactReviewSummary}

Geçerli JSON formatında yanıt ver (schema: { summary, pros, cons }).`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    for (const provider of fallbackProviders) {
      try {
        console.log(`[AIReview] LLM kapalı; fallback sağlayıcısı denenecek: ${provider} — ${campgroundName}`);
        const ai = AIAdapterFactory.create(provider);
        
        // JSON mode zorunlu (her provider için)
        const response = await ai.chat(messages, {
          temperature: AI_REVIEW_TEMPERATURE,
          maxTokens: AI_REVIEW_MAX_TOKENS,
          timeoutMs: provider === 'deepseek' ? 90000 : 45000,
          jsonMode: true,  // JSON format zorunlu
          noReasoning: true,  // Reasoning content'i devre dışı bırak
        });

        const aiEvaluation = typeof response === 'string' ? response.trim() : '';

        if (!aiEvaluation) {
          console.warn(`[AIReview] ${provider} boş yanıt döndürdü, diğer sağlayıcı deneniyor.`);
          continue;
        }

        // JSON parse ve validation
        let reviewObj;
        try {
          reviewObj = JSON.parse(aiEvaluation);
        } catch (parseErr) {
          console.warn(`[AIReview] ${provider} geçersiz JSON döndürdü:`, parseErr.message);
          continue;
        }

        // Validate structure
        if (!reviewObj.summary || !Array.isArray(reviewObj.pros) || !Array.isArray(reviewObj.cons)) {
          console.warn(`[AIReview] ${provider} eksik JSON yapısı döndürdü (summary/pros/cons eksik).`);
          continue;
        }

        // Generic kontrolü (JSON içeriği üzerinde)
        if (reviewObj.summary.length < 20 || (reviewObj.pros.length === 0 && reviewObj.cons.length === 0)) {
          console.warn(`[AIReview] ${provider} çıktısı çok kısa/eksik; fallback deneniyor.`);
          continue;
        }

        // Format ve döndür
        const formatted = formatStructuredReview(reviewObj);
        if (!formatted) {
          console.warn(`[AIReview] ${provider} format edilemedi.`);
          continue;
        }

        console.log(`[AIReview] ${provider} başarılı JSON yanıtı verdi.`);
        return formatted;
      } catch (err) {
        console.warn(`[AIReview] ${provider} çağrısı başarısız, sonraki provider deneniyor:`, err.message);
      }
    }

    console.log('[AIReview] Tüm fallback sağlayıcılar başarısız; yorum tabanlı kural değerlendirmesi kullanılacak:', campgroundName);
    return fallbackEvaluation();
  }

  // LLM açık ise varsayılan sağlayıcı ile devam et (peak/offpeak override destekli)
  try {
    let activeProvider = AI_PROVIDER;
    if (peak && AI_REVIEW_PROVIDER_PEAK) activeProvider = AI_REVIEW_PROVIDER_PEAK;
    else if (!peak && AI_REVIEW_PROVIDER_OFFPEAK) activeProvider = AI_REVIEW_PROVIDER_OFFPEAK;

    console.log(`[AIReview] LLM etkin. Seçilen provider: ${activeProvider} ${peak ? '(PEAK)' : '(OFFPEAK)'} — ${campgroundName}`);
    const ai = AIAdapterFactory.create(activeProvider);
    
    const systemPrompt = `Sen uzman bir kamp danışmanısın. Görevin, sana verilen kullanıcı yorum metinlerini ve ek bilgileri analiz ederek kampçılar için dengeli ve kullanışlı bir değerlendirme yazmak.

KESİN KURALLAR:
- Yanıtını YALNIZCA geçerli JSON formatında ver
- JSON şeması: { "summary": string, "pros": string[], "cons": string[] }
- summary: 2-3 cümlelik kısa, öz değerlendirme (kampın genel karakterini özetle)
- pros: En fazla 5 kısa, net olumlu özellik (madde başı 10-15 kelime)
- cons: En fazla 5 kısa, net olumsuz özellik (madde başı 10-15 kelime)
- Aynı konuyu hem pros hem cons'a yazma (örn: temizlik, personel, konum)
- Bir konu hem olumlu hem olumsuz ise bunu summary'de dengeli açıkla, listelerde sadece baskın tarafı göster
- "Yorum 1, Yorum 2" gibi referans kullanma
- Yorum sayısı veya "Google Places'e bakın" gibi meta bilgi verme
- Fiyat/para birimi karşılaştırması yapma (hizmet kalitesini doğrudan etkilemiyorsa)
- Ulusal kimlik/etnik grup karşılaştırması yapma
- Eğer veri yetersiz/çelişkiliyse bunu summary'de belirt

ÖRNEK ÇIKTI:
{
  "summary": "Deniz kenarında huzurlu bir kamp alanı. Temizlik ve personel ilgisi öne çıkıyor. Tesis altyapısı temel seviyede.",
  "pros": [
    "Denize sıfır konum ve huzurlu atmosfer",
    "Temiz ve düzenli çevre",
    "İlgili ve yardımsever personel",
    "Uygun fiyat/performans dengesi"
  ],
  "cons": [
    "Tuvalet ve duş tesisleri sınırlı",
    "Elektrik bağlantısı her alanda yok",
    "Yüksek sezonda kalabalık olabiliyor"
  ]
}`;

    // Web research sonuçlarını hazırla (eğer varsa)
    let webResearchContext = '';
    if (options.webResearch) {
      const wr = options.webResearch;
      const additionalInfo = [];
      
      if (wr.googlePlaces?.rating) {
        additionalInfo.push(`Google Puanı: ${wr.googlePlaces.rating}/5 (${wr.googlePlaces.totalRatings || '?'} değerlendirme)`);
      }
      if (wr.googlePlaces?.summary) {
        additionalInfo.push(`Google Özet: ${wr.googlePlaces.summary}`);
      }
      if (wr.osmTags?.description) {
        additionalInfo.push(`OSM Açıklama: ${wr.osmTags.description}`);
      }
      if (wr.osmTags?.openingHours) {
        additionalInfo.push(`Çalışma Saatleri: ${wr.osmTags.openingHours}`);
      }
      
      const facilities = [];
      if (wr.osmTags?.shower === 'yes') facilities.push('duş');
      if (wr.osmTags?.toilets === 'yes') facilities.push('tuvalet');
      if (wr.osmTags?.electricity === 'yes') facilities.push('elektrik');
      if (wr.osmTags?.drinkingWater === 'yes') facilities.push('içme suyu');
      if (facilities.length > 0) {
        additionalInfo.push(`Tesisler: ${facilities.join(', ')}`);
      }
      
      if (additionalInfo.length > 0) {
        webResearchContext = `\n\nEk bilgiler (web araştırmasından):\n${additionalInfo.join('\n')}`;
      }
    }

    const compactReviewSummary = compactReviewsForAI(reviews, reviewSummary);
    const userPrompt = `Kamp alanı: ${campgroundName}
Konum: ${location}${webResearchContext}${aiOverviewContext}

Kullanıcı yorumları (${reviews.length} adet):
${compactReviewSummary}

Geçerli JSON formatında yanıt ver (schema: { summary, pros, cons }).`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await ai.chat(messages, {
      temperature: AI_REVIEW_TEMPERATURE,
      maxTokens: AI_REVIEW_MAX_TOKENS,
      timeoutMs: 45000,
      jsonMode: true,  // JSON format zorunlu
      noReasoning: true,  // Reasoning content'i devre dışı bırak
    });

    const aiEvaluation = typeof response === 'string' ? response.trim() : '';

    if (!aiEvaluation) {
      console.warn(`[AIReview] ${activeProvider} boş yanıt döndürdü, fallback kullanılacak.`);
      return fallbackEvaluation();
    }

    // JSON parse ve validation
    let reviewObj;
    try {
      reviewObj = JSON.parse(aiEvaluation);
    } catch (parseErr) {
      console.warn(`[AIReview] ${activeProvider} geçersiz JSON döndürdü:`, parseErr.message);
      return fallbackEvaluation();
    }

    // Validate structure
    if (!reviewObj.summary || !Array.isArray(reviewObj.pros) || !Array.isArray(reviewObj.cons)) {
      console.warn(`[AIReview] ${activeProvider} eksik JSON yapısı döndürdü (summary/pros/cons eksik).`);
      return fallbackEvaluation();
    }

    // Generic kontrolü (JSON içeriği üzerinde)
    if (reviewObj.summary.length < 20 || (reviewObj.pros.length === 0 && reviewObj.cons.length === 0)) {
      console.warn(`[AIReview] ${activeProvider} çıktısı çok kısa/eksik; fallback kullanılacak.`);
      return fallbackEvaluation();
    }

    // Format ve döndür
    const formatted = formatStructuredReview(reviewObj);
    if (!formatted) {
      console.warn(`[AIReview] ${activeProvider} format edilemedi.`);
      return { evaluation: fallbackEvaluation(), aiOverviewData };
    }

    console.log(`[AIReview] ${activeProvider} başarılı JSON yanıtı verdi.`);
    return { evaluation: formatted, aiOverviewData };
  } catch (error) {
    console.warn('[AIReview] LLM çağrısı başarısız, fallback kullanılacak:', error.message);
    return { evaluation: fallbackEvaluation(), aiOverviewData };
  }
}

/**
 * GET /node/ai-reviews/stats
 * AI review istatistiklerini getirir (sadece superadmin)
 */
exports.getStats = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const dailyLimit = await checkDailyLimit();

    // İstatistikleri topla
    // Total evaluated (only campgrounds without owner and with AI review)
    const totalEvaluated = await db.Campground.count({
      where: {
        owner_id: null,
        ai_review_generated_at: { [Op.ne]: null }
      }
    });

    // Last 24 hours (only campgrounds without owner)
    const evaluated24h = await db.Campground.count({
      where: {
        owner_id: null,
        ai_review_generated_at: {
          [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      }
    });

    // Last 7 days (only campgrounds without owner)
    const evaluated7d = await db.Campground.count({
      where: {
        owner_id: null,
        ai_review_generated_at: {
          [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      }
    });

    // Pending (owner_id null and not evaluated yet)
    const pendingEvaluation = await db.Campground.count({
      where: {
        owner_id: null,
        ai_review_generated_at: null
      }
    });

    res.json({
      total_evaluated: totalEvaluated,
      evaluated_last_24h: evaluated24h,
      evaluated_last_7d: evaluated7d,
      pending_evaluation: pendingEvaluation,
      dailyLimit: dailyLimit.limit,
      todayCount: dailyLimit.used,
      remainingToday: dailyLimit.remaining
    });
  } catch (error) {
    console.error('AI review stats hatası:', error);
    res.status(500).json({ error: 'İstatistikler getirilemedi' });
  }
};

/**
 * GET /node/ai-reviews/today-count
 * Bugün yapılan AI review sayısı (sadece superadmin)
 */
exports.getTodayCount = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const count = await db.Campground.count({
      where: {
        ai_review_generated_at: {
          [Op.gte]: Sequelize.fn('DATE', Sequelize.literal('CURRENT_DATE'))
        }
      }
    });

    res.json({ count });
  } catch (error) {
    console.error('Today count hatası:', error);
    res.status(500).json({ error: 'Sayım yapılamadı' });
  }
};

/**
 * POST /node/campgrounds/evaluate-reviews
 * Tek bir kamp alanı için AI review değerlendirmesi yapar
 */
exports.evaluateCampgroundReview = async (req, res) => {
  try {
    const { campground_id, force, use_llm } = req.body;

    if (!campground_id) {
      return res.status(400).json({ error: 'campground_id gerekli' });
    }

    // Kamp alanını getir
    const campground = await db.Campground.findByPk(campground_id);

    if (!campground) {
      return res.status(404).json({ error: 'Kamp alanı bulunamadı' });
    }

    // owner_id kontrolü (boş olmalı)
    if (campground.owner_id && !force) {
      return res.status(400).json({ 
        error: 'Bu kamp alanı bir kullanıcıya ait, AI değerlendirmesi yapılamaz' 
      });
    }

    // Cooldown kontrolü (6 ay)
    if (!force && !isCooldownExpired(campground.ai_review_generated_at)) {
      const lastEval = new Date(campground.ai_review_generated_at);
      const nextAllowed = new Date(lastEval);
      nextAllowed.setMonth(nextAllowed.getMonth() + 6);
      const remaining = Math.floor((nextAllowed - new Date()) / 1000);
      
      return res.status(429).json({ 
        error: '6 aylık cooldown süresi dolmadı',
        cooldown_remaining: remaining
      });
    }

    // Günlük limit kontrolü
    const limitCheck = await checkDailyLimit();
    if (!limitCheck.canProceed && !force) {
      return res.status(429).json({ 
        error: 'Günlük limit doldu',
        limit: limitCheck.limit,
        used: limitCheck.used
      });
    }

    // Global enable kontrolü
    const enabledSetting = await db.AppSetting.findOne({
      where: { key: 'ai_review_enabled_global' }
    });
    const globalEnabled = enabledSetting?.value === 'true';
    
    if (!globalEnabled && !force) {
      return res.status(403).json({ error: 'AI değerlendirme sistem genelinde kapalı' });
    }

    // Google Place ID'yi al veya parse et
    let placeId = campground.google_place_id;
    
    if (!placeId && campground.booking_url) {
      placeId = parseGooglePlaceIdFromUrl(campground.booking_url);
    }

    // Place ID yoksa veya geçersizse isim+koordinat araması yap
    let placeDetails = null;
    let searchAttempted = false;

    if (placeId) {
      try {
        // Önce mevcut place_id ile dene
        const placeResponse = await googleMapsClient.placeDetails({
          params: {
            place_id: placeId,
            fields: [
              'reviews', 'rating', 'user_ratings_total', 'website',
              'formatted_phone_number', 'price_level', 'types'
            ],
            language: 'tr',
            reviews_sort: 'most_relevant',
            key: process.env.GOOGLE_PLACES_API_KEY
          }
        });
        placeDetails = placeResponse.data.result;
      } catch (placeError) {
        console.warn(`Place ID (${placeId}) geçersiz, isim+koordinat araması yapılıyor:`, placeError.message);
        placeId = null; // Geçersiz place_id'yi sıfırla
      }
    }

    if (!placeId || !placeDetails) {
      // İsim ve koordinatla ara
      try {
        searchAttempted = true;
        const searchResponse = await googleMapsClient.findPlaceFromText({
          params: {
            input: campground.name,
            inputtype: 'textquery',
            fields: ['place_id'],
            locationbias: `circle:1000@${campground.latitude},${campground.longitude}`,
            key: process.env.GOOGLE_PLACES_API_KEY
          }
        });

        if (searchResponse.data.candidates?.length > 0) {
          placeId = searchResponse.data.candidates[0].place_id;
          
          // Yeni place_id ile detayları al
          const placeResponse = await googleMapsClient.placeDetails({
            params: {
              place_id: placeId,
              fields: [
                'reviews', 'rating', 'user_ratings_total', 'website',
                'formatted_phone_number', 'price_level', 'types'
              ],
              language: 'tr',
              reviews_sort: 'most_relevant',
              key: process.env.GOOGLE_PLACES_API_KEY
            }
          });
          placeDetails = placeResponse.data.result;
        }
      } catch (e) {
        console.warn('Place search hatası:', e.message);
      }
    }

    if (!placeId || !placeDetails) {
      return res.status(404).json({ 
        error: 'Google Place ID bulunamadı veya detaylar alınamadı',
        searched: searchAttempted
      });
    }

    // Yorumları özetle
    const totalReviewCount = placeDetails.user_ratings_total || 0;
    const sampleReviewCount = placeDetails.reviews?.length || 0;
    
    let reviewSummary = 'Analiz edilecek ayrıntılı yorum metni bulunmuyor.';
    
    if (placeDetails.reviews && placeDetails.reviews.length > 0) {
      reviewSummary = placeDetails.reviews
        .map((r, i) => `[Yorum ${i + 1}] ${r.author_name} (${r.rating}/5):\n${r.text}`)
        .join('\n\n');
    }

    // Web research yap (OSM + Google Places ek bilgiler)
    let webResearch = null;
    try {
      if (campground.latitude && campground.longitude) {
        console.log(`[AIReview] Web research başlatılıyor: ${campground.name}`);
        webResearch = await researchLocation({
          name: campground.name,
          lat: campground.latitude,
          lng: campground.longitude
        });
        console.log(`[AIReview] Web research tamamlandı — OSM: ${!!webResearch?.osmTags}, Google: ${!!webResearch?.googlePlaces}`);
      }
    } catch (webErr) {
      console.warn(`[AIReview] Web research hatası (devam ediliyor):`, webErr.message);
    }

    // AI ile değerlendir
    const { evaluation: aiEvaluation, aiOverviewData } = await evaluateWithAI(
      campground.name,
      campground.formatted_address || `${campground.latitude}, ${campground.longitude}`,
      reviewSummary,
      totalReviewCount,
      sampleReviewCount,
      placeDetails.reviews || [],
      { 
        useLLM: use_llm === true || AI_REVIEW_USE_LLM,
        webResearch: webResearch,
        bookingUrl: campground.booking_url
      }
    );

    // Veritabanını güncelle
    const updateData = {
      ai_review_evaluation: aiEvaluation,
      ai_review_generated_at: new Date().toISOString(),
      google_place_id: placeId,
      last_google_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Google'dan alınan diğer bilgileri google_* sütunlarına yaz (KD rating ve review_count'a dokunma)
    if (typeof placeDetails.rating === 'number') updateData.google_rating = placeDetails.rating;
    if (typeof placeDetails.user_ratings_total === 'number') updateData.google_review_count = placeDetails.user_ratings_total;
    if (placeDetails.website) updateData.website = placeDetails.website;
    if (placeDetails.formatted_phone_number) updateData.phone = placeDetails.formatted_phone_number;
    if (placeDetails.price_level) {
      updateData.price_range = '₺'.repeat(placeDetails.price_level);
    }

    await campground.update(updateData);

    res.json({
      success: true,
      evaluation: updateData,
      aiOverview: aiOverviewData // SerpAPI'den gelen zengin veriler
    });

  } catch (error) {
    console.error('AI review evaluation hatası:', error);
    res.status(500).json({ error: 'Değerlendirme yapılamadı', details: error.message });
  }
};

/**
 * POST /node/campgrounds/batch-evaluate-reviews
 * Toplu AI review değerlendirmesi (sadece superadmin)
 */
exports.batchEvaluate = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const { limit, force, use_llm } = req.body;

    // Günlük limit kontrolü
    const limitCheck = await checkDailyLimit();
    const processLimit = limit || limitCheck.remaining;

    if (processLimit <= 0 && !force) {
      return res.status(429).json({ error: 'Günlük limit doldu' });
    }

    // Değerlendirmeye uygun alanları bul
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const eligibleCampgrounds = await db.Campground.findAll({
      where: {
        owner_id: null,
        status: 'active',
        [Op.or]: [
          { ai_review_generated_at: null },
          { ai_review_generated_at: { [Op.lt]: sixMonthsAgo } }
        ],
        [Op.or]: [
          { ai_review_enabled: null },
          { ai_review_enabled: true }
        ]
      },
      order: [['ai_review_generated_at', 'ASC NULLS FIRST']],
      limit: processLimit,
      attributes: ['id', 'name', 'booking_url']
    });

    const results = [];
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const campground of eligibleCampgrounds) {
      try {
        // Her alan için değerlendirme yap
        const evalReq = {
          body: {
            campground_id: campground.id,
            force,
            // Toplu işlemde LLM varsayılan kapalı; kota/TPM hatalarını önler.
            use_llm: use_llm === true || AI_REVIEW_LLM_FOR_BATCH,
          },
          user: req.user,
        };
        const evalRes = {
          status: (code) => ({ json: (data) => ({ code, data }) }),
          json: (data) => ({ code: 200, data })
        };
        
        await exports.evaluateCampgroundReview(evalReq, evalRes);
        
        processed++;
        results.push({ campground_id: campground.id, success: true });
      } catch (error) {
        if (error.message.includes('limit')) {
          skipped++;
        } else {
          failed++;
        }
        results.push({
          campground_id: campground.id,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      processed,
      failed,
      skipped,
      results
    });

  } catch (error) {
    console.error('Batch evaluation hatası:', error);
    res.status(500).json({ error: 'Toplu değerlendirme yapılamadı' });
  }
};

/**
 * GET /node/campgrounds/:id/ai-review
 * Bir kamp alanının AI review değerlendirmesini getirir
 */
exports.getCampgroundAiReview = async (req, res) => {
  try {
    const { id } = req.params;

    const campground = await db.Campground.findOne({
      where: {
        id,
        ai_review_evaluation: { [Op.ne]: null }
      },
      attributes: ['id', 'ai_review_evaluation', 'ai_review_generated_at', 'google_place_id', 'google_rating', 'google_review_count', 'last_google_sync_at']
    });

    if (!campground) {
      return res.status(404).json({ error: 'AI değerlendirmesi bulunamadı' });
    }

    res.json({ 
      review: {
        campground_id: campground.id,
        ai_review_evaluation: campground.ai_review_evaluation,
        ai_review_generated_at: campground.ai_review_generated_at,
        google_place_id: campground.google_place_id,
        google_rating: campground.google_rating,
        google_review_count: campground.google_review_count,
        last_google_sync_at: campground.last_google_sync_at
      }
    });
  } catch (error) {
    console.error('AI review getirme hatası:', error);
    res.status(500).json({ error: 'Değerlendirme getirilemedi' });
  }
};

/**
 * GET /node/campgrounds/eligible-for-review
 * Değerlendirmeye uygun kamp alanlarını listeler (sadece superadmin)
 */
exports.getEligibleCampgrounds = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const areas = await db.Campground.findAll({
      where: {
        owner_id: null,
        status: 'active',
        [Op.or]: [
          { ai_review_generated_at: null },
          { ai_review_generated_at: { [Op.lt]: sixMonthsAgo } }
        ],
        [Op.or]: [
          { ai_review_enabled: null },
          { ai_review_enabled: true }
        ]
      },
      order: [['ai_review_generated_at', 'ASC NULLS FIRST']],
      limit: 100,
      attributes: ['id', 'name', 'booking_url', 'ai_review_generated_at']
    });

    res.json({ 
      areas: areas.map(a => ({
        id: a.id,
        name: a.name,
        booking_url: a.booking_url,
        last_evaluated: a.ai_review_generated_at
      }))
    });
  } catch (error) {
    console.error('Eligible areas getirme hatası:', error);
    res.status(500).json({ error: 'Liste getirilemedi' });
  }
};

/**
 * DELETE /node/campgrounds/:id/ai-review
 * Bir kamp alanının AI review değerlendirmesini siler (sadece superadmin)
 */
exports.deleteAiReview = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const { id } = req.params;

    await db.Campground.update(
      {
        ai_review_evaluation: null,
        ai_review_generated_at: null,
        updated_at: new Date().toISOString()
      },
      { where: { id } }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('AI review silme hatası:', error);
    res.status(500).json({ error: 'Değerlendirme silinemedi' });
  }
};

/**
 * PUT /node/campgrounds/:id/ai-review-toggle
 * Bir kamp alanı için AI review'u aktif/pasif yapar (sadece superadmin)
 */
exports.toggleAiReview = async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const { id } = req.params;
    const { enabled } = req.body;

    await db.Campground.update(
      { 
        ai_review_enabled: enabled,
        updated_at: new Date().toISOString()
      },
      { where: { id } }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('AI review toggle hatası:', error);
    res.status(500).json({ error: 'Ayar güncellenemedi' });
  }
};

/**
 * POST /node/google-places/details
 * Google Place detaylarını getirir
 */
exports.getGooglePlaceDetails = async (req, res) => {
  try {
    const { place_id, fields } = req.body;

    if (!place_id) {
      return res.status(400).json({ error: 'place_id gerekli' });
    }

    const response = await googleMapsClient.placeDetails({
      params: {
        place_id,
        fields: fields || [
          'place_id', 'name', 'formatted_address', 'rating',
          'user_ratings_total', 'reviews', 'photos', 'website',
          'formatted_phone_number', 'opening_hours', 'types'
        ],
        language: 'tr',
        reviews_sort: 'most_relevant',
        key: process.env.GOOGLE_PLACES_API_KEY
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Google Places API hatası:', error);
    res.status(500).json({ error: 'Google Places API hatası' });
  }
};

/**
 * POST /node/google-places/search
 * Koordinat ve isimle Google Place arar
 */
exports.searchGooglePlace = async (req, res) => {
  try {
    const { query, location, radius } = req.body;

    const response = await googleMapsClient.findPlaceFromText({
      params: {
        input: query,
        inputtype: 'textquery',
        fields: ['place_id', 'name', 'geometry'],
        locationbias: location ? `circle:${radius || 1000}@${location.lat},${location.lng}` : undefined,
        key: process.env.GOOGLE_PLACES_API_KEY
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Google Places Search hatası:', error);
    res.status(500).json({ error: 'Arama başarısız' });
  }
};
