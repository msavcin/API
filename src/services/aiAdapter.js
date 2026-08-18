/**
 * AI Adapter Katmanı
 * Farklı LLM sağlayıcılarını tek bir arayüz altında toplar.
 * Yeni sağlayıcı eklemek için ilgili Provider sınıfını yazıp
 * AIAdapterFactory.create() switch bloğuna kaydet.
 */

class OllamaProvider {
  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
  }

  async chat(messages, options = {}) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens ?? 1024,
        },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama API hatası (${response.status}): ${text}`);
    }

    const data = await response.json();
    return data.message?.content ?? '';
  }
}

class VLLMProvider {
  constructor() {
    this.baseUrl = process.env.VLLM_BASE_URL || 'http://localhost:8000';
    this.model = process.env.VLLM_MODEL || 'mistral';
  }

  async chat(messages, options = {}) {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`vLLM API hatası (${response.status}): ${text}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}

class LlamaCppProvider {
  constructor() {
    this.baseUrl = process.env.LLAMACPP_BASE_URL || 'http://localhost:8080';
  }

  async chat(messages, options = {}) {
    // llama.cpp server OpenAI uyumlu /v1/chat/completions endpoint'ini destekler
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        messages,
        n_predict: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`llama.cpp API hatası (${response.status}): ${text}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
  }
}

class GroqProvider {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    // qwen/qwen3-32b bazı hesaplarda/model havuzlarında erişilemez olabiliyor.
    // Bu yüzden varsayılanı daha yaygın bir modele çekiyor ve model_not_found durumunda
    // GROQ_FALLBACK_MODELS listesindeki modellere otomatik geçiyoruz.
    this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    // Llama 3.1 8B Instant (groq: 'llama-3.1-8b-instant') Groq tarafında sonlandırıldığı
    // için varsayılan fallback listesinden çıkarıldı. Tavsiye edilen ikame: `openai/gpt-oss-20b`.
    this.fallbackModels = (process.env.GROQ_FALLBACK_MODELS || 'llama-3.3-70b-versatile,openai/gpt-oss-20b')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
    this.webSearch = process.env.GROQ_WEB_SEARCH === 'true';
    this.reasoning = process.env.GROQ_REASONING !== 'false'; // Varsayılan: aktif
    // Free tier: 6000 TPM — ~800 input + 2500 output = 3300/istek
    this.maxTokens = parseInt(process.env.GROQ_MAX_TOKENS ?? '2500', 10);
    // 429 alininca beklenecek max sure (ms) — controller timeout'tan kucuk olmali
    this.maxRetryWaitMs = parseInt(process.env.GROQ_RETRY_WAIT_MS ?? '55000', 10);
    this.maxRetries = parseInt(process.env.GROQ_MAX_RETRIES ?? '3', 10);
  }

  _parseRetryAfter(errorText) {
    const text = String(errorText || '');
    // Groq hata mesajları "try again in 2.62s" veya "try again in 255ms" olabilir.
    const match = text.match(/try again in ([\d.]+)\s*(ms|s)/i);
    if (!match) return null;
    const value = parseFloat(match[1]);
    if (!Number.isFinite(value)) return null;
    return match[2].toLowerCase() === 'ms'
      ? Math.ceil(value)
      : Math.ceil(value * 1000);
  }

  _isModelUnavailable(status, errorText) {
    const text = errorText || '';

    // 404: model yok / erişim yok.
    if (status === 404 && /model_not_found|does not exist|do not have access/i.test(text)) {
      return true;
    }

    // 403: model proje seviyesinde kapalı. Bu durumda sıradaki fallback modele geç.
    if (status === 403 && /model_permission_blocked_project|permissions_error|blocked at the project level/i.test(text)) {
      return true;
    }

    return false;
  }

  _isReasoningModel(model) {
    return model.includes('qwen3') || model.includes('gpt-oss');
  }

  _buildBody(model, messages, options = {}) {
    const isReasoningModel = this._isReasoningModel(model);
    const body = {
      model,
      messages,
      temperature: options.temperature ?? 0.6,
      top_p: 0.95,
      max_completion_tokens: options.maxTokens ?? this.maxTokens,
    };

    // JSON modu — Groq response_format ile model seviyesinde JSON zorunlu kılar
    // qwen3/gpt-oss reasoning çıktıları JSON akışını bozmasın diye reasoning kapatılır.
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    // Reasoning modeli ise düşünme modunu etkinleştir.
    // jsonMode veya noReasoning aktifse reasoning kapatılır.
    if (isReasoningModel && this.reasoning && !options.noReasoning && !options.jsonMode) {
      body.reasoning_format = 'parsed';
      body.reasoning_effort = 'default';
    }

    return body;
  }

  async chat(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY tanımlı değil');
    }

    // Web arama etkinse compound-beta modeline geç; burada fallback yapma.
    const requestedModel = this.webSearch ? 'compound-beta' : this.model;
    const candidateModels = this.webSearch
      ? [requestedModel]
      : Array.from(new Set([requestedModel, ...this.fallbackModels]));

    let lastErrorText = '';
    let lastStatus = 0;

    for (let index = 0; index < candidateModels.length; index++) {
      const model = candidateModels[index];
      const body = this._buildBody(model, messages, options);

      const doRequest = () => fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
      });

      let response = null;
      let rateLimitText = '';
      for (let retry = 0; retry <= this.maxRetries; retry += 1) {
        response = await doRequest();
        if (response.status !== 429) break;

        rateLimitText = await response.text();
        const waitMsRaw = this._parseRetryAfter(rateLimitText);
        // Küçük jitter + minimum bekleme, aynı milisaniyede tekrar çarpışmayı azaltır.
        const waitMs = waitMsRaw != null
          ? Math.min(this.maxRetryWaitMs, Math.max(350, waitMsRaw + 250 + Math.round(Math.random() * 250)))
          : Math.min(this.maxRetryWaitMs, 1000 * Math.pow(2, retry));

        if (retry >= this.maxRetries || waitMs > this.maxRetryWaitMs) {
          throw new Error(`Groq API hatası (429, model=${model}): ${rateLimitText}`);
        }

        console.warn(`[GROQ] Rate limit — ${waitMs}ms beklenip tekrar deneniyor... (${retry + 1}/${this.maxRetries})`);
        await new Promise(r => setTimeout(r, waitMs));
      }

      if (!response.ok) {
        const text = response.status === 429 ? rateLimitText : await response.text();
        lastErrorText = text;
        lastStatus = response.status;

        if (this._isModelUnavailable(response.status, text) && index < candidateModels.length - 1) {
          const nextModel = candidateModels[index + 1];
          console.warn(`[GROQ] Model kullanılamıyor (${model}, HTTP ${response.status}), fallback deneniyor: ${nextModel}`);
          continue;
        }

        throw new Error(`Groq API hatası (${response.status}, model=${model}): ${text}`);
      }

      const data = await response.json();
      const msg = data.choices?.[0]?.message;

      // Reasoning varsa loglayalım (debug amaçlı)
      if (msg?.reasoning) {
        console.log(`[GROQ] Düşünme süreci: ${msg.reasoning.slice(0, 200)}...`);
      }

      if (model !== requestedModel) {
        console.warn(`[GROQ] Yanıt fallback model ile alındı: ${model}`);
      }

      return msg?.content ?? '';
    }

    throw new Error(`Groq API hatası (${lastStatus}): ${lastErrorText || 'Uygun Groq modeli bulunamadı'}`);
  }
}

class DeepSeekProvider {
  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.baseUrl = 'https://api.deepseek.com';
  }

  async chat(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY tanımlı değil');
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.6,
        top_p: 0.95,
        max_tokens: options.maxTokens ?? 4096,
        // Reasoning modunu devre dışı bırak (structured JSON için gerekli)
        ...(options.noReasoning ? { reasoning_effort: 'none' } : {}),
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 90000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek API hatası (${response.status}): ${text}`);
    }

    const data = await response.json();
    
    // Debug: API yanıt yapısını logla
    console.log('[DEEPSEEK] API Response yapısı:', {
      hasChoices: !!data.choices,
      choicesLength: data.choices?.length,
      firstChoice: data.choices?.[0] ? {
        hasMessage: !!data.choices[0].message,
        messageKeys: data.choices[0].message ? Object.keys(data.choices[0].message) : [],
        finishReason: data.choices[0].finish_reason,
        contentLength: data.choices[0].message?.content?.length ?? 0
      } : null,
      error: data.error,
      usage: data.usage
    });
    
    const msg = data.choices?.[0]?.message;
    const finishReason = data.choices?.[0]?.finish_reason;

    // Prefer `content`, but if empty try `reasoning_content` as fallback (some DeepSeek setups
    // may place the substantive output in reasoning_content when reasoning is enabled).
    let content = msg?.content ?? '';
    if ((!content || content.length === 0) && msg?.reasoning_content) {
      content = msg.reasoning_content;
      console.warn('[DEEPSEEK] content boş; reasoning_content fallback olarak kullanılıyor');
    }

    // Boş yanıt kontrolü
    if (!content || content.length === 0) {
      console.error('[DEEPSEEK] BOŞ YANIT! API tam response:', JSON.stringify(data, null, 2).slice(0, 1000));
    }

    // Token limiti kontrolü
    if (finishReason === 'length') {
      console.warn('[DEEPSEEK] Yanıt token limiti nedeniyle kesildi (finish_reason: length)');
      console.warn('[DEEPSEEK] Yanıt uzunluğu:', content.length, 'karakter');
    }

    return content;
  }
}

class AIAdapterFactory {
  /**
   * @param {string} provider - 'ollama' | 'vllm' | 'llamacpp' | 'groq' | 'deepseek'
   * @returns {OllamaProvider|VLLMProvider|LlamaCppProvider|GroqProvider|DeepSeekProvider}
   */
  static create(provider) {
    switch (provider) {
      case 'groq':
        return new GroqProvider();
      case 'deepseek':
        return new DeepSeekProvider();
      case 'vllm':
        return new VLLMProvider();
      case 'llamacpp':
        return new LlamaCppProvider();
      case 'ollama':
      default:
        return new OllamaProvider();
    }
  }
}

module.exports = { AIAdapterFactory, OllamaProvider, VLLMProvider, LlamaCppProvider, GroqProvider, DeepSeekProvider };
