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
 * Kullanıcının mevcut abonelik durumu
 */
router.get('/status', authMiddleware, subscriptionController.getSubscriptionStatus);

module.exports = router;
