const express = require('express');
const { 
  listAnnouncements, getAnnouncement, createAnnouncement, 
  updateAnnouncement, deleteAnnouncement,
  listByValilikId,
  uploadEventPhoto,
  removeEventPhoto
} = require('../controllers/announcementController');
const upload = require('../middleware/upload');
const { authMiddleware, leaderMiddleware, guestRestrictionMiddleware } = require('../middleware/auth');

const router = express.Router();
// Duyurudan etkinlik fotoğrafı silme endpointi
router.post('/remove-event-photo', authMiddleware, leaderMiddleware, removeEventPhoto);
// Duyuruya etkinlik fotoğrafı yükle
router.post(
  '/upload-event-photo',
  upload.any(),
  (req, res, next) => { console.log('[ROUTE][ANNOUNCEMENTS] req.body:', req.body); next(); },
  authMiddleware,
  leaderMiddleware,
  uploadEventPhoto
);

// Tüm duyuruları listele (guest erişimi engellenir)
router.get('/', authMiddleware, guestRestrictionMiddleware, listAnnouncements);
// Tek bir duyuru detay (guest erişimi engellenir)
router.get('/:id', authMiddleware, guestRestrictionMiddleware, getAnnouncement);
// Duyuru oluştur (sadece topluluk lideri, guest erişimi engellenir)
router.post('/', authMiddleware, guestRestrictionMiddleware, leaderMiddleware, createAnnouncement);
// Duyuru güncelle (sadece topluluk lideri, guest erişimi engellenir)
router.put('/:id', authMiddleware, guestRestrictionMiddleware, leaderMiddleware, updateAnnouncement);
// Duyuru sil (superadmin veya kendi oluşturduğu için lider, guest erişimi engellenir)
router.delete('/:id', authMiddleware, guestRestrictionMiddleware, (req, res, next) => {
  if (req.user && req.user.role === 'superadmin') {
    return deleteAnnouncement(req, res, next);
  }
  leaderMiddleware(req, res, () => deleteAnnouncement(req, res, next));
});
// Valilik ID ile duyuruları listele (guest erişimi engellenir)
router.get('/valilik/:valilik_id', authMiddleware, guestRestrictionMiddleware, listByValilikId);

module.exports = router;
