const express = require('express');
const router = express.Router();
const friendshipController = require('../controllers/friendshipController');
console.log('Controller fonksiyonları:', friendshipController);
const { authMiddleware, guestRestrictionMiddleware } = require('../middleware/auth');

// Arkadaş arama
router.get('/users/search', authMiddleware, guestRestrictionMiddleware, friendshipController.searchUsers);
// Arkadaşlık isteği gönder
router.post('/request', authMiddleware, guestRestrictionMiddleware, friendshipController.sendRequest);
// Gelen istekleri listele
router.get('/requests', authMiddleware, guestRestrictionMiddleware, friendshipController.listRequests);
// İsteğe yanıt ver
router.post('/respond', authMiddleware, guestRestrictionMiddleware, friendshipController.respondRequest);
// Arkadaş listesini getir
router.get('/list', authMiddleware, guestRestrictionMiddleware, friendshipController.listFriends);
// Arkadaşlıktan çıkar
router.post('/remove', authMiddleware, guestRestrictionMiddleware, friendshipController.removeFriend);

module.exports = router;
