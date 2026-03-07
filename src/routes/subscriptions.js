const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { authMiddleware } = require('../middleware/auth');

/**
 * GET /node/subscriptions/prices
 * Platform ve plan bazlı abonelik fiyatlarını döner (public)
 */
router.get('/prices', subscriptionController.getPrices);

/**
 * POST /node/subscriptions/verify
 * Abonelik receipt/token doğrulama
 */
router.post('/verify', authMiddleware, subscriptionController.verifySubscription);

/**
 * GET /node/subscriptions/status
 * Kullanıcının mevcut abonelik durumu (DB + gerçek zamanlı süre kontrolü)
 */
router.get('/status', authMiddleware, subscriptionController.getSubscriptionStatus);

/**
 * POST /node/subscriptions/refresh
 * Abonelik durumunu doğrudan mağaza API'sinden (Google/Apple) sorgular ve DB'yi günceller.
 * Frontend uygulama ön plana geldiğinde veya abonelik ekranı açıldığında çağırmalıdır.
 */
router.post('/refresh', authMiddleware, subscriptionController.refreshSubscription);

/**
 * POST /node/subscriptions/webhook/apple
 * Apple App Store Server Notifications v2
 * App Store Connect'te "Production Server URL" olarak kaydedin.
 * Auth middleware YOK — Apple sunucudan doğrudan çağırır.
 */
router.post('/webhook/apple', subscriptionController.appleWebhook);

/**
 * POST /node/subscriptions/webhook/google
 * Google Play Real-Time Developer Notifications (Pub/Sub push)
 * ?token=<GOOGLE_PUBSUB_WEBHOOK_TOKEN> query parametresi ile güvenlik sağlanır.
 * Auth middleware YOK — Google Pub/Sub sunucudan doğrudan çağırır.
 */
router.post('/webhook/google', subscriptionController.googleWebhook);

module.exports = router;
