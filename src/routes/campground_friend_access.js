const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const controller = require('../controllers/campgroundFriendAccessController');

// Belirli bir kamp alanına erişimi olan arkadaşları getir
router.get('/', authMiddleware, controller.listFriendsWithAccess); // /campground_friend_access?campground_id=...
// Alternatif: /campgrounds/:id/friends
router.get('/campgrounds/:id/friends', authMiddleware, controller.listFriendsWithAccess);
// Erişim verilen arkadaşları güncelle (tümünü değiştir)
router.put('/campgrounds/:id/friends', authMiddleware, controller.updateFriendsWithAccess);

module.exports = router;
