/**
 * AI Review Routes
 * Google Places ve AI değerlendirme endpoint'leri
 */

const express = require('express');
const router = express.Router();
const aiReviewController = require('../controllers/aiReviewController');
const { authMiddleware } = require('../middleware/auth');

// Google Places API endpoint'leri
router.post('/google-places/details', authMiddleware, aiReviewController.getGooglePlaceDetails);
router.post('/google-places/search', authMiddleware, aiReviewController.searchGooglePlace);

// AI Review istatistik endpoint'leri (sadece superadmin)
router.get('/ai-reviews/stats', authMiddleware, aiReviewController.getStats);
router.get('/ai-reviews/today-count', authMiddleware, aiReviewController.getTodayCount);

// Campground AI Review endpoint'leri (path'ler basitleştirildi, prefix index.js'de)
router.post('/evaluate-reviews', authMiddleware, aiReviewController.evaluateCampgroundReview);
router.post('/batch-evaluate-reviews', authMiddleware, aiReviewController.batchEvaluate);
router.get('/:id/ai-review', aiReviewController.getCampgroundAiReview);
router.get('/eligible-for-review', authMiddleware, aiReviewController.getEligibleCampgrounds);
router.delete('/:id/ai-review', authMiddleware, aiReviewController.deleteAiReview);
router.put('/:id/ai-review-toggle', authMiddleware, aiReviewController.toggleAiReview);

module.exports = router;
