/**
 * Google AI Overview Service
 * 
 * Google'ın AI Overview (Gemini) yanıtlarını SerpAPI kullanarak çeker.
 * SerpAPI ücretsiz tier: 100 search/ay
 * Pricing: https://serpapi.com/pricing
 * 
 * Setup:
 * 1. https://serpapi.com/users/sign_up - hesap oluştur
 * 2. API key al
 * 3. .env dosyasına ekle: SERPAPI_KEY=your_key_here
 */

const { GoogleSearch } = require('google-search-results-nodejs');
const { getCache } = require('./cache');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const AI_OVERVIEW_CACHE_TTL = 180 * 24 * 3600; // 6 ay (15552000 saniye) — AI overview'lar nadiren değişir

/**
 * Kamp alanı için Google AI Overview yanıtını çeker
 * @param {string} campgroundName - Kamp alanı adı
 * @param {string} location - Konum (şehir, ülke)
 * @returns {Promise<{aiOverview: string|null, relatedQuestions: string[]}>}
 */
async function fetchGoogleAIOverview(campgroundName, location = '') {
  const result = { aiOverview: null, relatedQuestions: [] };

  // API key yoksa atla
  if (!SERPAPI_KEY) {
    console.log('[AI_OVERVIEW] SERPAPI_KEY tanımlı değil, atlanıyor.');
    return result;
  }

  // Cache kontrolü
  const cacheKey = `ai_overview:${campgroundName.toLowerCase().trim()}:${location.toLowerCase().trim()}`;
  const cache = getCache();
  const cached = await cache.get(cacheKey);
  if (cached) {
    console.log('[AI_OVERVIEW] Cache hit:', cacheKey);
    return JSON.parse(cached);
  }

  try {
    // SerpAPI query oluştur
    const query = location 
      ? `${campgroundName} ${location} camping reviews`
      : `${campgroundName} camping reviews`;

    console.log('[AI_OVERVIEW] SerpAPI query:', query);

    // SerpAPI çağrısı
    const search = new GoogleSearch(SERPAPI_KEY);
    const searchParams = {
      engine: 'google',
      q: query,
      hl: 'tr',        // Türkçe sonuçlar
      gl: 'tr',        // Türkiye coğrafyası
      num: 10,         // Sonuç sayısı (daha fazla AI overview şansı)
    };

    const response = await new Promise((resolve, reject) => {
      search.json(searchParams, (data) => {
        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve(data);
        }
      });
    });

    // 1. AI Overview - Google'ın doğrudan AI yanıtı (en zengin içerik)
    if (response.ai_overview?.text_blocks) {
      const blocks = response.ai_overview.text_blocks;
      const textParts = [];
      
      blocks.forEach(block => {
        if (block.type === 'paragraph' || block.type === 'heading') {
          textParts.push(block.snippet);
        } else if (block.type === 'list' && Array.isArray(block.list)) {
          block.list.forEach(item => {
            textParts.push(`- ${item.snippet}`);
          });
        }
      });
      
      if (textParts.length > 0) {
        result.aiOverview = textParts.join('\n\n');
      }
    }

    // 2. Answer Box (Featured Snippet)
    if (!result.aiOverview && response.answer_box) {
      result.aiOverview = response.answer_box.snippet || response.answer_box.answer || null;
      
      if (response.answer_box.list && Array.isArray(response.answer_box.list)) {
        const listItems = response.answer_box.list.map(item => `- ${item}`).join('\n');
        if (result.aiOverview) {
          result.aiOverview += `\n\n${listItems}`;
        } else {
          result.aiOverview = listItems;
        }
      }
    }

    // 3. Knowledge Graph - Yapısal veriler (rating, review, adres, telefon vb.)
    if (response.knowledge_graph) {
      const kg = response.knowledge_graph;
      const kgParts = [];
      
      // Temel bilgiler
      if (kg.title && kg.type) {
        kgParts.push(`${kg.title} (${kg.type})`);
      }
      
      // Rating ve yorum sayısı
      if (kg.rating) {
        const ratingText = kg.review_count 
          ? `Puan: ${kg.rating}/5 (${kg.review_count} değerlendirme)`
          : `Puan: ${kg.rating}/5`;
        kgParts.push(ratingText);
      }
      
      // İletişim bilgileri
      if (kg.adres) kgParts.push(`Adres: ${kg.adres}`);
      if (kg.telefon) kgParts.push(`Telefon: ${kg.telefon}`);
      
      // Açıklama
      if (kg.description) {
        kgParts.push(`\n${kg.description}`);
      }
      
      // Alternatif öneriler (ilk 3 tanesi)
      if (kg['başkaları_ayrıca_şunları_da_aradı'] && Array.isArray(kg['başkaları_ayrıca_şunları_da_aradı'])) {
        const alternatives = kg['başkaları_ayrıca_şunları_da_aradı']
          .slice(0, 3)
          .map(alt => alt.name)
          .filter(Boolean);
        
        if (alternatives.length > 0) {
          kgParts.push(`\nBenzer Yerler: ${alternatives.join(', ')}`);
        }
      }
      
      // Knowledge Graph verilerini mevcut overview'a ekle veya yeni oluştur
      if (kgParts.length > 0) {
        const kgText = kgParts.join('\n');
        if (result.aiOverview) {
          result.aiOverview = `${kgText}\n\n${result.aiOverview}`;
        } else {
          result.aiOverview = kgText;
        }
      }
    }

    // 4. Related Questions (People Also Ask) - Sadece AI Overview tipindekiler
    if (response.related_questions && Array.isArray(response.related_questions)) {
      result.relatedQuestions = response.related_questions
        .filter(q => q.type === 'ai_overview') // AI Overview tipindeki sorular daha değerli
        .slice(0, 3)
        .map(q => q.question)
        .filter(Boolean);
    }

    // 5. Fallback: İlk organik sonuç
    if (!result.aiOverview && response.organic_results?.[0]?.snippet) {
      result.aiOverview = `[İlk organik sonuçtan]: ${response.organic_results[0].snippet}`;
    }

    // Cache'le
    if (result.aiOverview || result.relatedQuestions.length > 0) {
      await cache.set(cacheKey, JSON.stringify(result), AI_OVERVIEW_CACHE_TTL);
      console.log('[AI_OVERVIEW] Sonuç cache\'lendi:', cacheKey);
    } else {
      console.log('[AI_OVERVIEW] AI Overview bulunamadı:', query);
    }

    return result;
  } catch (error) {
    console.warn('[AI_OVERVIEW] Hata (devam ediliyor):', error.message);
    return result;
  }
}

/**
 * Google AI Overview'ı prompt için formatla
 * @param {object} aiOverviewData - fetchGoogleAIOverview sonucu
 * @returns {string}
 */
function formatAIOverviewForPrompt(aiOverviewData) {
  if (!aiOverviewData || !aiOverviewData.aiOverview) {
    return '';
  }

  const parts = [];
  parts.push('[GOOGLE_AI_OZETI]');
  
  // AI Overview metni (artık daha zengin içerik ile)
  parts.push(aiOverviewData.aiOverview);

  // İlgili sorular (varsa)
  if (aiOverviewData.relatedQuestions && aiOverviewData.relatedQuestions.length > 0) {
    parts.push('');
    parts.push('Sıkça Sorulan Sorular (AI Overview):');
    aiOverviewData.relatedQuestions.forEach(q => parts.push(`- ${q}`));
  }

  return parts.length > 1 ? `\n\n${parts.join('\n')}` : '';
}

module.exports = {
  fetchGoogleAIOverview,
  formatAIOverviewForPrompt,
};
