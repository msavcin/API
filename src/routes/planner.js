const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { aiEvaluate } = require('../controllers/plannerController');

const router = express.Router();

/**
 * POST /node/planner/ai-evaluate
 * Kamp planını AI ile değerlendir.
 * Body: { planData: { startDate, endDate, campType, campingArea, weather, valilikId, ... } }
 */
router.post('/ai-evaluate', authMiddleware, aiEvaluate);

module.exports = router;
