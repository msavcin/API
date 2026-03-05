const express = require('express');
const router = express.Router();
const licenseController = require('../controllers/licenseController');
const { authMiddleware } = require('../middleware/auth');

// GET /node/licenses/public-key
// Döndürülen key base64, tüm boşluklar kaldırılmıştır.
router.get('/public-key', authMiddleware, licenseController.getPublicKey);

module.exports = router;
