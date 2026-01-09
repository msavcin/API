const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const controller = require('../controllers/campgroundImageController');

// Fotoğraf ekle (JSON body)
router.post('/', authMiddleware, controller.createCampgroundImage);
// Fotoğraf dosyası yükle (multipart/form-data)
router.post('/upload', authMiddleware, upload.single('file'), controller.uploadCampgroundImage);
// Fotoğrafları listele
router.get('/', authMiddleware, controller.listCampgroundImages);
// Fotoğraf sil (id veya image_id ile)
router.delete('/:id', authMiddleware, controller.deleteCampgroundImage);
router.delete('/', authMiddleware, controller.deleteCampgroundImage);

module.exports = router;
