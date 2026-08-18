/**
 * DeepSeek API Test
 * Test eder: API key geçerliliği, model yanıtı, JSON mode
 */

require('dotenv').config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

if (!DEEPSEEK_API_KEY) {
  console.error('❌ DEEPSEEK_API_KEY tanımlı değil!');
  process.exit(1);
}

console.log('🔑 API Key:', DEEPSEEK_API_KEY.slice(0, 10) + '...');
console.log('🤖 Model:', DEEPSEEK_MODEL);
console.log('');

async function testDeepSeek() {
  try {
    console.log('📡 DeepSeek API\'ye test isteği gönderiliyor...');
    
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Sen bir test asistanısın. SADECE geçerli JSON döndür.'
          },
          {
            role: 'user',
            content: 'Şu JSON formatında yanıt ver: {"status":"ok","message":"Test başarılı"}'
          }
        ],
        temperature: 0.2,
        max_tokens: 200,
        reasoning_effort: 'none',  // Reasoning modunu devre dışı bırak
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(30000),
    });

    console.log('📥 HTTP Status:', response.status, response.statusText);
    console.log('');

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Hatası:', errorText);
      return;
    }

    const data = await response.json();
    
    console.log('✅ API Yanıtı Alındı');
    console.log('');
    console.log('📊 Response Yapısı:');
    console.log('  - choices:', data.choices?.length ?? 0, 'adet');
    console.log('  - model:', data.model);
    console.log('  - usage:', data.usage);
    console.log('');
    
    if (data.choices && data.choices[0]) {
      const choice = data.choices[0];
      console.log('📝 İlk Choice:');
      console.log('  - finish_reason:', choice.finish_reason);
      console.log('  - content uzunluğu:', choice.message?.content?.length ?? 0, 'karakter');
      console.log('');
      console.log('💬 İçerik:');
      console.log(choice.message?.content ?? '(BOŞ)');
    } else {
      console.error('❌ choices dizisi boş veya yok!');
      console.log('Tam yanıt:', JSON.stringify(data, null, 2));
    }

  } catch (error) {
    console.error('❌ Test Hatası:', error.message);
    if (error.cause) {
      console.error('   Neden:', error.cause);
    }
  }
}

testDeepSeek();
