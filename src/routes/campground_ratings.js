const express = require('express');
const router = express.Router({ mergeParams: true });
const controller = require('../controllers/ratingController');
const { authMiddleware } = require('../middleware/auth');

// GET /node/campgrounds/:id/ratings
router.get('/', controller.listRatings);

// POST (create or update) - auth optional (token varsa owner olarak kullan)
router.post('/', controller.createOrUpdateRating);

// DELETE /node/campgrounds/:id/ratings/mine - auth required
router.delete('/mine', authMiddleware, controller.deleteMyRating);

// Summary
router.get('/summary', controller.getSummary);

// Moderation - admin only (authMiddleware + role check in controller)
router.patch('/:ratingId', authMiddleware, controller.moderateRating);

// Flag a rating (user report)
router.post('/:ratingId/flag', controller.flagRating);

module.exports = router;
