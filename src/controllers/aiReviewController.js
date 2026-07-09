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

/**
 * Helper: AI ile kamp alanı yorumlarını değerlendir
 */
async function evaluateWithAI(campgroundName, location, reviewSummary) {
  try {
    const ai = AIAdapterFactory.create(AI_PROVIDER);
    
    const systemPrompt = `Sen uzman bir kamp danışmanısın. Görevin, Google Places yorumlarını analiz ederek kampçılar için samimi ve bilgilendirici değerlendirmeler yazmak.

Değerlendirmen şunları içermeli:
- Genel izlenim ve atmosfer
- Temizlik ve bakım durumu
- Personel ve hizmet kalitesi
- Olanaklar ve imkanlar
- Avantajlar ve dezavantajlar
- Hangi tip kampçılar için uygun olduğu

2-3 paragrafta, Türkçe, samimi ve bilgilendirici bir dille yaz.`;

    const userPrompt = `Aşağıdaki kamp alanı hakkında Google Places yorumlarını analiz et:

**Kamp Alanı:** ${campgroundName}
**Konum:** ${location}

**Google Places Yorumları:**
${reviewSummary}

Lütfen değerlendirmeni yaz.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await ai.chat(messages, {
      temperature: AI_REVIEW_TEMPERATURE,
      maxTokens: AI_REVIEW_MAX_TOKENS,
      timeoutMs: 45000 // 45 saniye timeout
    });

    return response.trim();
  } catch (error) {
    console.error('AI değerlendirme hatası:', error.message);
    // Fallback: basit özet
    return `Bu kamp alanı hakkında ${reviewSummary.split('\n\n').length} kullanıcı yorumu bulunmaktadır. Detaylı bilgi için Google Places'i ziyaret edebilirsiniz.`;
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
    let reviewSummary = 'Bu kamp alanı için Google Places üzerinde henüz yorum bulunmuyor.';
    
    if (placeDetails.reviews && placeDetails.reviews.length > 0) {
      reviewSummary = placeDetails.reviews
        .map((r, i) => `[Yorum ${i + 1}] ${r.author_name} (${r.rating}/5):\n${r.text}`)
        .join('\n\n');
    }

    // AI ile değerlendir
    const aiEvaluation = await evaluateWithAI(
      campground.name,
      campground.formatted_address || `${campground.latitude}, ${campground.longitude}`,
      reviewSummary
    );

    // Veritabanını güncelle
    const updateData = {
      ai_review_evaluation: aiEvaluation,
      ai_review_generated_at: new Date(),
      google_place_id: placeId,
      last_google_sync_at: new Date()
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
        ai_review_generated_at: null
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
      { ai_review_enabled: enabled },
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
