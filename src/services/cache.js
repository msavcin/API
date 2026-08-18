/**
 * Cache Katmanı
 *
 * Redis varsa (REDIS_URL env ayarlıysa) ioredis kullanır.
 * Yoksa in-memory Map + TTL ile devam eder.
 * Her iki durumda da dışarıya aynı get/set/del arayüzü sunulur.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// In-Memory Cache (Redis yokken fallback)
// ---------------------------------------------------------------------------
class InMemoryCache {
  constructor() {
    this._store = new Map();
    // TTL temizliği için periyodik sweep (her 5 dakikada bir)
    this._sweepInterval = setInterval(() => this._sweep(), 5 * 60 * 1000);
    this._sweepInterval.unref(); // process'in ayakta kalmasını engelleme
  }

  async get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, ttlSeconds = 3600) {
    this._store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key) {
    this._store.delete(key);
  }

  async keys(pattern) {
    // Simple pattern matching: ai_overview:* gibi
    if (!pattern || pattern === '*') {
      return Array.from(this._store.keys());
    }
    
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return Array.from(this._store.keys()).filter(k => regex.test(k));
  }

  _sweep() {
    const now = Date.now();
    for (const [key, entry] of this._store.entries()) {
      if (now > entry.expiresAt) this._store.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Redis Cache (ioredis)
// ---------------------------------------------------------------------------
class RedisCache {
  constructor(client) {
    this._client = client;
    this._readyPromise = new Promise((resolve) => {
      if (client.status === 'ready') {
        resolve();
      } else {
        client.once('ready', resolve);
        setTimeout(resolve, 5000); // 5 sn timeout
      }
    });
  }

  async _ensureReady() {
    await this._readyPromise;
  }

  async get(key) {
    try {
      await this._ensureReady();
      const raw = await this._client.get(key);
      return raw ?? null;
    } catch (err) {
      console.warn('[CACHE] Redis get hatası:', err.message);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 3600) {
    try {
      await this._ensureReady();
      await this._client.setex(key, ttlSeconds, value);
    } catch (err) {
      console.warn('[CACHE] Redis set hatası:', err.message);
    }
  }

  async del(key) {
    try {
      await this._ensureReady();
      await this._client.del(key);
    } catch (err) {
      console.warn('[CACHE] Redis del hatası:', err.message);
    }
  }

  async keys(pattern) {
    try {
      await this._ensureReady();
      return await this._client.keys(pattern || '*');
    } catch (err) {
      console.warn('[CACHE] Redis keys hatası:', err.message);
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — hangisinin kullanılacağına otomatik karar verir
// ---------------------------------------------------------------------------
let _cacheInstance = null;

function getCache() {
  if (_cacheInstance) return _cacheInstance;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const Redis = require('ioredis');
      const client = new Redis(redisUrl, {
        retryStrategy: (times) => {
          if (times > 3) {
            console.warn('[CACHE] Redis retry limit aşıldı, in-memory\'e geçiliyor');
            _cacheInstance = new InMemoryCache();
            return null;
          }
          return Math.min(times * 500, 2000);
        },
        enableOfflineQueue: true,  // Bağlanana kadar işlemleri queue'ye koy
        maxRetriesPerRequest: null,  // Sonsuz retry
      });

      let isConnected = false;
      client.on('connect', () => {
        isConnected = true;
        console.log('[CACHE] Redis bağlantısı kuruldu');
      });

      client.on('error', (err) => {
        if (!isConnected) {
          console.warn('[CACHE] Redis bağlanamıyor, in-memory\'e geçiliyor:', err.message);
          _cacheInstance = new InMemoryCache();
        } else {
          console.warn('[CACHE] Redis bağlantısında hata:', err.message);
        }
      });

      client.on('close', () => {
        if (isConnected) {
          console.warn('[CACHE] Redis bağlantısı kapatıldı');
          isConnected = false;
        }
      });

      _cacheInstance = new RedisCache(client);
      console.log('[CACHE] Redis cache aktif:', redisUrl);
    } catch (err) {
      console.warn('[CACHE] ioredis yüklenemedi, in-memory cache kullanılıyor:', err.message);
      _cacheInstance = new InMemoryCache();
    }
  } else {
    _cacheInstance = new InMemoryCache();
    console.log('[CACHE] In-memory cache aktif (REDIS_URL tanımlı değil)');
  }

  return _cacheInstance;
}

// ---------------------------------------------------------------------------
// Yardımcı: nesneyi deterministik hash'e çevir (cache key üretimi için)
// ---------------------------------------------------------------------------
function _sortKeys(value) {
  if (Array.isArray(value)) return value.map(_sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, k) => {
      acc[k] = _sortKeys(value[k]);
      return acc;
    }, {});
  }
  return value;
}

function computeHash(obj) {
  const str = JSON.stringify(_sortKeys(obj));
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

module.exports = { getCache, computeHash };
