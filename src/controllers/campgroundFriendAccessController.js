const db = require('../models');
const CampgroundFriendAccess = db.CampgroundFriendAccess;
const User = db.User;
const Campground = db.Campground;

// 1. Belirli bir kamp alanına erişimi olan arkadaşları döndür
exports.listFriendsWithAccess = async (req, res) => {
  const campground_id = parseInt(req.params.id || req.query.campground_id, 10);
  if (!campground_id) return res.status(400).json({ error: 'campground_id gerekli' });

  // Erişim kontrolü: sadece owner veya superadmin
  const campground = await Campground.findByPk(campground_id);
  if (!campground) return res.status(404).json({ error: 'Kamp alanı bulunamadı' });
  if (!(req.user.role === 'superadmin' || req.user.id === campground.owner_id)) {
    return res.status(403).json({ error: 'Bu kamp alanı için yetkiniz yok' });
  }

  // Erişim verilen arkadaşlar
  const accesses = await CampgroundFriendAccess.findAll({ where: { campground_id } });
  const userIds = accesses.map(a => a.friend_user_id);
  if (userIds.length === 0) return res.json([]);
  const users = await User.findAll({
    where: { id: userIds },
    attributes: ['id', 'name', 'username', 'avatar_url', 'email']
  });
  res.json(users);
};

// 2. Erişim verilen arkadaşları güncelle (tümünü değiştir)
exports.updateFriendsWithAccess = async (req, res) => {
  const campground_id = parseInt(req.params.id, 10);
  const { friend_user_ids } = req.body;
  if (!campground_id || !Array.isArray(friend_user_ids)) {
    return res.status(400).json({ error: 'campground_id ve friend_user_ids (dizi) gerekli' });
  }
  // Erişim kontrolü
  const campground = await Campground.findByPk(campground_id);
  if (!campground) return res.status(404).json({ error: 'Kamp alanı bulunamadı' });
  if (!(req.user.role === 'superadmin' || req.user.id === campground.owner_id)) {
    return res.status(403).json({ error: 'Bu kamp alanı için yetkiniz yok' });
  }
  // Önce eski erişimleri sil
  await CampgroundFriendAccess.destroy({ where: { campground_id } });
  // Sonra yenilerini ekle
  const records = friend_user_ids.map(friend_user_id => ({ campground_id, friend_user_id }));
  await CampgroundFriendAccess.bulkCreate(records);
  res.json({ success: true });
};
