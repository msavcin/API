/**
 * AI Review Controller
 * Google Places entegrasyonu ve AI ile kamp alanı değerlendirme
 */

const { Client } = require('@googlemaps/google-maps-services-js');
const db = require('../models');
const { AIAdapterFactory } = require('../services/aiAdapter');
const Sequelize = require('sequelize');
const { Op } = Sequelize;

// Google Places client
const googleMapsClient = new Client({});

// AI provider seçimi (.env dosyasından)
const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';
const AI_REVIEW_TEMPERATURE = parseFloat(process.env.AI_REVIEW_TEMPERATURE || '0.7');
const AI_REVIEW_MAX_TOKENS = parseInt(process.env.AI_REVIEW_MAX_TOKENS || '2000', 10);

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

  const hasProsCons = /(?:^|\n|\b)\s*(Artılar|Avantajlar)\s*:/i.test(text || '') &&
    /(?:^|\n|\b)\s*(Eksiler|Dezavantajlar)\s*:/i.test(text || '');
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
  const prosMatch = raw.match(/(?:Artılar|Avantajlar)\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:Eksiler|Dezavantajlar)\s*:)|$)/i);
  const consMatch = raw.match(/(?:Eksiler|Dezavantajlar)\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:Not|Sonuç)\s*:)|$)/i);
  const parseBullets = (block) => !block ? [] : block
    .split(/\r?\n/)
    .map((line) => normalizeReviewText(line).replace(/^[\-\*•\s\d\.]+/, '').trim())
    .filter(Boolean);

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
  const { pros, cons } = parseAIReviewBullets(text);
  if (pros.length === 0 || cons.length === 0) return false;

  const proTopics = new Set(pros.flatMap(getBulletTopicKeys));
  const conTopics = new Set(cons.flatMap(getBulletTopicKeys));
  return [...proTopics].some((topic) => conTopics.has(topic));
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
 * Helper: AI ile kamp alanı yorumlarını değerlendir
 */
async function evaluateWithAI(campgroundName, location, reviewSummary, totalReviewCount, sampleReviewCount, reviews = []) {
  const fallbackEvaluation = () => buildRuleBasedReviewEvaluation(
    campgroundName,
    totalReviewCount,
    reviews
  );

  try {
    const ai = AIAdapterFactory.create(AI_PROVIDER);
    
    const systemPrompt = `Sen uzman bir kamp danışmanısın. Görevin, sana verilen kullanıcı yorum metinlerini analiz ederek kampçılar için dengeli ve kullanışlı bir değerlendirme yazmak.

Kesin kurallar:
- Önce 2-3 paragraflık yorum/değerlendirme yaz; sadece madde listesi üretme.
- Sadece toplam yorum sayısını söyleyen veya kullanıcıyı Google Places'e yönlendiren metin yazma.
- Şu cümleyi veya benzerini asla kullanma: "Bu kamp alanı hakkında Google Places üzerinde ... kullanıcı yorumu bulunmaktadır. Detaylı bilgi için Google Places'i ziyaret edebilirsiniz."
- Değerlendirme, yorumların içeriğinden çıkarılmış olumlu ve olumsuz yönleri belirtmeli.
- Örnek yorum sayısını açıkça yazma; sadece içerik analizine odaklan.
- Aynı başlığı hem Artılar hem Eksiler altında tekrarlama. Örneğin tesis/tuvalet, personel veya sakinlik aynı anda iki listede yer almasın.
- Bir başlık hem olumlu hem olumsuz yorumlanıyorsa bunu ana değerlendirme paragrafında dengeli anlat; Artılar/Eksiler listesinde sadece baskın tarafı göster veya hiç madde yapma.
- Eğer olumsuz yön azsa bunu "tekrar eden belirgin bir olumsuz başlık öne çıkmıyor" şeklinde belirt.

Çıktıyı sadece şu formatta üret:
2-3 paragraflık değerlendirme metni.

Artılar:
- En fazla 5 kısa ve birbirinden farklı madde

Eksiler:
- En fazla 5 kısa ve Artılar ile çelişmeyen madde

Not: Bu değerlendirme kullanıcı yorum metinlerinden otomatik olarak oluşturulmuştur.`;

    const reviewCountInfo = totalReviewCount > 0
      ? `\nToplam kullanıcı yorumu: ${totalReviewCount}`
      : '';

    const userPrompt = `Kamp alanı: ${campgroundName}
Konum: ${location}${reviewCountInfo}

Analiz edilecek yorum metinleri:
${reviewSummary}

Yorum metinlerinden olumlu ve olumsuz yönleri çıkar. Google Places'e yönlendirme yapma.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await ai.chat(messages, {
      temperature: AI_REVIEW_TEMPERATURE,
      maxTokens: AI_REVIEW_MAX_TOKENS,
      timeoutMs: 45000
    });

    const aiEvaluation = typeof response === 'string' ? response.trim() : '';

    if (isGenericAIReviewText(aiEvaluation) || hasContradictoryProsCons(aiEvaluation)) {
      console.warn('AI değerlendirme generic/çelişkili formatta döndü, yorum tabanlı fallback kullanılacak.');
      return fallbackEvaluation();
    }

    return aiEvaluation;
  } catch (error) {
    console.error('AI değerlendirme hatası:', error.message);
    // AI servisi çalışmasa bile kullanıcıya Google Places sayım metni değil,
    // yorumların içeriğinden çıkarılmış artı/eksi değerlendirme döndür.
    return fallbackEvaluation();
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
    const { campground_id, force } = req.body;

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

    // AI ile değerlendir
    const aiEvaluation = await evaluateWithAI(
      campground.name,
      campground.formatted_address || `${campground.latitude}, ${campground.longitude}`,
      reviewSummary,
      totalReviewCount,
      sampleReviewCount,
      placeDetails.reviews || []
    );

    // Veritabanını güncelle
    const updateData = {
      ai_review_evaluation: aiEvaluation,
      ai_review_generated_at: new Date().toISOString(),
      google_place_id: placeId,
      last_google_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Google'dan alınan diğer bilgileri güncelle
    if (placeDetails.rating) updateData.rating = placeDetails.rating;
    if (placeDetails.user_ratings_total) updateData.review_count = placeDetails.user_ratings_total;
    if (placeDetails.website) updateData.website = placeDetails.website;
    if (placeDetails.formatted_phone_number) updateData.phone = placeDetails.formatted_phone_number;
    if (placeDetails.price_level) {
      updateData.price_range = '₺'.repeat(placeDetails.price_level);
    }

    await campground.update(updateData);

    res.json({
      success: true,
      evaluation: updateData
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

    const { limit, force } = req.body;

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
        const evalReq = { body: { campground_id: campground.id, force }, user: req.user };
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
      attributes: ['id', 'ai_review_evaluation', 'ai_review_generated_at', 'google_place_id']
    });

    if (!campground) {
      return res.status(404).json({ error: 'AI değerlendirmesi bulunamadı' });
    }

    res.json({ 
      review: {
        campground_id: campground.id,
        ai_review_evaluation: campground.ai_review_evaluation,
        ai_review_generated_at: campground.ai_review_generated_at,
        google_place_id: campground.google_place_id
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
