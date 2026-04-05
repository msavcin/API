const express = require('express');
const axios = require('axios');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const db = require('../models');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'demo_secret_key';

// Redis bağlantısı
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

// Redis bağlantı durumunu logla
redis.on('connect', () => {
  console.log('[REDIS] Connected successfully');
});

redis.on('error', (err) => {
  console.error('[REDIS] Connection error:', err.message);
});

const CACHE_TTL = 7 * 24 * 60 * 60; // 7 gün (saniye cinsinden)

// CartoDB tile providers (load balancing için)
const TILE_PROVIDERS = [
  'https://a.basemaps.cartocdn.com/rastertiles/voyager',
  'https://b.basemaps.cartocdn.com/rastertiles/voyager',
  'https://c.basemaps.cartocdn.com/rastertiles/voyager',
  'https://d.basemaps.cartocdn.com/rastertiles/voyager',
];

// CARTO dark tile providers
const DARK_TILE_PROVIDERS = [
  'https://a.basemaps.cartocdn.com/dark_all',
  'https://b.basemaps.cartocdn.com/dark_all',
  'https://c.basemaps.cartocdn.com/dark_all',
  'https://d.basemaps.cartocdn.com/dark_all',
];

// Helper: Token'dan kullanıcı bilgisi al
async function getUserFromToken(token) {
  if (!token) return null;
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const User = db.User || require('../models/user');
    const user = await User.findByPk(decoded.id);
    return user;
  } catch (err) {
    console.error('[TILE] Token verification error:', err.message);
    return null;
  }
}

// Tile endpoint: /tiles/{z}/{x}/{y}.png
router.get('/:z/:x/:y.png', async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const style = req.query.style === 'dark' ? 'dark' : 'voyager';
    const cacheKey = `tile:${style}:${z}:${x}:${y}`;

    // CORS headers (mobil app için gerekli)
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800', // 7 gün browser cache
    });

    // Token kontrolü (opsiyonel - header'dan al)
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
      const user = await getUserFromToken(token);
      
      if (user) {
        // Offline özelliği kontrolü
        if (!user.offline_enabled) {
          console.warn(`[TILE] User ${user.id} offline özelliği aktif değil`);
          return res.status(403).json({ error: 'Offline özelliği aktif değil' });
        }
        
        // Radius kontrolü (opsiyonel rate limiting)
        if (user.offline_radius_km < 20) {
          console.warn(`[TILE] User ${user.id} düşük offline radius: ${user.offline_radius_km}km`);
          // İsterseniz burada daha fazla kısıtlama ekleyebilirsiniz
          // Örn: Belirli zoom seviyelerini sınırla, günlük tile limiti vb.
        }
        
        console.log(`[TILE] Authenticated user ${user.id} (offline: ${user.offline_enabled}, radius: ${user.offline_radius_km}km)`);
      }
    }

    // Redis cache kontrolü
    try {
      const cached = await redis.getBuffer(cacheKey);
      if (cached) {
        console.log(`[TILE] REDIS HIT: ${z}/${x}/${y}`);
        return res.send(cached);
      }
    } catch (cacheError) {
      console.error('[TILE] Redis cache error:', cacheError.message);
      // Cache hatası olsa bile devam et
    }

    // Subdomain seçimi (basit load balancing)
    const providers = style === 'dark' ? DARK_TILE_PROVIDERS : TILE_PROVIDERS;
    const providerIndex = (parseInt(x) + parseInt(y)) % providers.length;
    const tileUrl = `${providers[providerIndex]}/${z}/${x}/${y}.png`;

    console.log(`[TILE] REDIS MISS: ${z}/${x}/${y} (style: ${style}) -> Fetching from CartoDB`);

    // CartoDB'den tile çek
    const response = await axios.get(tileUrl, {
      headers: {
        'User-Agent': 'KampDefterim/1.3',
      },
      timeout: 10000, // 10 saniye timeout
      responseType: 'arraybuffer', // Binary data için
    });

    if (response.status !== 200) {
      console.error(`[TILE] ERROR ${response.status}: ${z}/${x}/${y}`);
      return res.status(response.status).send('Tile not found');
    }

    const buffer = Buffer.from(response.data);

    // Redis'e kaydet (7 gün TTL)
    try {
      await redis.setex(cacheKey, CACHE_TTL, buffer);
      console.log(`[TILE] REDIS CACHED: ${z}/${x}/${y}`);
    } catch (cacheError) {
      console.error('[TILE] Redis cache save error:', cacheError.message);
      // Cache kaydetme hatası olsa bile tile'ı döndür
    }

    res.send(buffer);
  } catch (error) {
    console.error('[TILE] Error:', error.message);
    res.status(500).send('Internal server error');
  }
});

module.exports = router;

