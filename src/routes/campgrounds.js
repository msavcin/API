const express = require('express');
const router = express.Router();
const campgroundController = require('../controllers/campgroundController');
const { authMiddleware, optionalAuthMiddleware, guestRestrictionMiddleware } = require('../middleware/auth');

// 1. Kamp Alanı Ekle (authenticated required)
router.post('/', authMiddleware, campgroundController.createCampground);
// 2. Kamp Alanı Listele (opsiyonel auth — sync için token zorunlu değil)
router.get('/', optionalAuthMiddleware, campgroundController.listCampgrounds);
// 3. Kamp Alanı Detay (opsiyonel auth)
router.get('/:id', optionalAuthMiddleware, campgroundController.getCampground);
// 4. Kamp Alanı Zenginleştir
router.post('/:id/enrich', authMiddleware, campgroundController.enrichCampground);
// 5. Kamp Alanı Sil (guest erişimi engellenir)
router.delete('/:id', authMiddleware, campgroundController.deleteCampground);
// 6. Kamp Alanı Güncelle (guest erişimi engellenir)
router.put('/:id', authMiddleware, campgroundController.updateCampground);

// Nested ratings routes: /node/campgrounds/:id/ratings
router.use('/:id/ratings', require('./campground_ratings'));

module.exports = router;
