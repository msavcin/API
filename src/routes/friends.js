const express = require('express');
const router = express.Router();
const db = require('../models');
const { Op } = require('sequelize');

const { authMiddleware, guestRestrictionMiddleware } = require('../middleware/auth');
// GET /friends?user_id=8
router.get('/', authMiddleware, guestRestrictionMiddleware, async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id gerekli' });
  try {
    // Arkadaşlık tablosu: friendships
    // status: 'accepted' olanlar arkadaş
    const friendships = await db.Friendship.findAll({
      where: {
        status: 'accepted',
        [Op.or]: [
          { user_id },
          { friend_id: user_id }
        ]
      }
    });
    // Karşı tarafın user bilgisini çek
    const friendIds = friendships.map(f => f.user_id == user_id ? f.friend_id : f.user_id);
    const friends = await db.User.findAll({ where: { id: friendIds } });
    res.json(friends);
  } catch (err) {
    console.error('Arkadaş listesi hatası:', err);
    res.status(500).json({ error: 'Arkadaşlar alınamadı', detail: err.message });
  }
});

module.exports = router;
