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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
    this.model = process.env.GROQ_MODEL || 'qwen/qwen3-32b';
    this.webSearch = process.env.GROQ_WEB_SEARCH === 'true';
    this.reasoning = process.env.GROQ_REASONING !== 'false'; // Varsayılan: aktif
    // Free tier: 6000 TPM — ~800 input + 2500 output = 3300/istek
    this.maxTokens = parseInt(process.env.GROQ_MAX_TOKENS ?? '2500', 10);
    // 429 alininca beklenecek max sure (ms) — controller timeout'tan kucuk olmali
    this.maxRetryWaitMs = parseInt(process.env.GROQ_RETRY_WAIT_MS ?? '55000', 10);
  }

  _parseRetryAfter(errorText) {
    const match = errorText.match(/try again in ([\d.]+)s/);
    return match ? Math.ceil(parseFloat(match[1]) * 1000) : null;
  }

  async chat(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY tanımlı değil');
    }

    // Web arama etkinse compound-beta modeline geç
    const model = this.webSearch ? 'compound-beta' : this.model;
    const isReasoningModel = model.includes('qwen3') || model.includes('gpt-oss');

    const body = {
      model,
      messages,
      temperature: options.temperature ?? 0.6,
      top_p: 0.95,
      max_completion_tokens: options.maxTokens ?? this.maxTokens,
    };

    // JSON modu — Groq response_format ile model seviyesinde JSON zorunlu kılar
    // qwen3 <think> blokları baskılanır, tüm tokenler JSON'a ayrılır
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    // Reasoning modeli ise düşünme modunu etkinleştir
    // jsonMode veya noReasoning aktifse reasoning kapatılır
    if (isReasoningModel && this.reasoning && !options.noReasoning && !options.jsonMode) {
      body.reasoning_format = 'parsed';
      body.reasoning_effort = 'default';
    }

    const doRequest = () => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
    });

    let response = await doRequest();

    // 429: rate limit — bir kez bekle ve tekrar dene
    if (response.status === 429) {
      const errText = await response.text();
      const waitMs = this._parseRetryAfter(errText);
      if (waitMs && waitMs <= this.maxRetryWaitMs) {
        console.warn(`[GROQ] Rate limit — ${waitMs}ms beklenip tekrar deneniyor...`);
        await new Promise(r => setTimeout(r, waitMs));
        response = await doRequest();
      } else {
        throw new Error(`Groq API hatasi (429): ${errText}`);
      }
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Groq API hatası (${response.status}): ${text}`);
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message;

    // Reasoning varsa loglayalım (debug amaçlı)
    if (msg?.reasoning) {
      console.log(`[GROQ] Düşünme süreci: ${msg.reasoning.slice(0, 200)}...`);
    }

    return msg?.content ?? '';
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
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.6,
        top_p: 0.95,
        max_tokens: options.maxTokens ?? 4096,
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 90000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek API hatası (${response.status}): ${text}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
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
