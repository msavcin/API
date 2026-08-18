#!/usr/bin/env node
require('dotenv').config();
const { getCache } = require('../src/services/cache');

(async function(){
  console.log('[CacheClear] AI Overview cache temizleniyor...');
  
  try {
    const cache = getCache();
    
    // Pattern ile tüm ai_overview: keylerini sil
    const keys = await cache.keys('ai_overview:*');
    
    if (keys && keys.length > 0) {
      console.log(`[CacheClear] ${keys.length} adet cache bulundu:`);
      keys.forEach(k => console.log(`  - ${k}`));
      
      for (const key of keys) {
        await cache.del(key);
        console.log(`✓ Silindi: ${key}`);
      }
      
      console.log(`\n[CacheClear] Toplam ${keys.length} cache silindi.`);
    } else {
      console.log('[CacheClear] Temizlenecek cache bulunamadı.');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('[CacheClear] Hata:', err.message);
    console.log('[CacheClear] Server restart gerekebilir.');
    process.exit(1);
  }
})();
