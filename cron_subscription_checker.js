/**
 * CRON Job: Subscription Expiration Checker
 * 
 * Süresi dolan abonelikleri kontrol eder ve kullanıcıların
 * offline_enabled ve subscription_is_active alanlarını günceller.
 * 
 * Kullanım:
 * npm install node-cron
 * node cron_subscription_checker.js
 * 
 * Veya mevcut bir cron scheduler'a ekleyin
 */

require('dotenv').config();
const cron = require('node-cron');
const subscriptionController = require('./src/controllers/subscriptionController');

console.log('[Subscription Cron] Starting subscription expiration checker...');

// Her gün saat 02:00'de çalış
cron.schedule('0 2 * * *', async () => {
  console.log('[Subscription Cron] Running scheduled check at', new Date().toISOString());
  
  try {
    const result = await subscriptionController.checkExpiredSubscriptions();
    console.log('[Subscription Cron] Check completed:', result);
  } catch (error) {
    console.error('[Subscription Cron] Error:', error);
  }
});

console.log('[Subscription Cron] Scheduler initialized - will run daily at 02:00');

// Uygulama çalışmaya devam etsin
process.on('SIGINT', () => {
  console.log('[Subscription Cron] Shutting down gracefully...');
  process.exit(0);
});
