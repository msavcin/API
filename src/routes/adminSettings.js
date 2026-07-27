/**
 * Admin Settings Routes
 * Sistem genelinde admin ayarlarını yöneten endpoint'ler
 */

const express = require('express');
const router = express.Router();
const adminSettingsController = require('../controllers/adminSettingsController');
const { authMiddleware } = require('../middleware/auth');

// Mobil uygulamanın oturumlu runtime ayarları (sadece güvenli/public değerler)
router.get('/app-config', authMiddleware, adminSettingsController.getAppConfig);

// Tüm admin settings endpoint'leri sadece superadmin için
router.get('/settings', authMiddleware, adminSettingsController.getAllSettings);
router.get('/settings/:key', authMiddleware, adminSettingsController.getSetting);
router.post('/settings', authMiddleware, adminSettingsController.createSetting);
router.put('/settings/:key', authMiddleware, adminSettingsController.updateSetting);
router.delete('/settings/:key', authMiddleware, adminSettingsController.deleteSetting);

module.exports = router;
