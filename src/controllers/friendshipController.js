// Arkadaş arama (users tablosunda, mevcut arkadaşlar ve kendisi hariç)
exports.searchUsers = async (req, res) => {
  const user_id = req.user.id;
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Arama terimi gerekli' });
  // Mevcut arkadaşları bul
  const friendships = await Friendship.findAll({
    where: {
      [Op.or]: [
        { user_id, status: 'accepted' },
        { friend_id: user_id, status: 'accepted' }
      ]
    }
  });
  const friendIds = friendships.map(f => f.user_id === user_id ? f.friend_id : f.user_id);
  // Arama: kendisi ve arkadaşları hariç
  const users = await User.findAll({
    where: {
      username: { [Op.iLike]: `%${username}%` },
      id: { [Op.notIn]: [user_id, ...friendIds] }
    },
    attributes: ['id', 'username']
  });
  const result = users.map(u => ({ id: u.id, username: u.username, tag: `#${u.id}` }));
  res.json(result);
};
const db = require('../models');
const Friendship = db.Friendship;
const User = db.User;
const { Op } = require('sequelize');

// Arkadaş arama
exports.searchUsers = async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Arama terimi gerekli' });
  const users = await User.findAll({
    where: {
      [Op.or]: [
        { username: { [Op.iLike]: `%${username}%` } },
        { name: { [Op.iLike]: `%${username}%` } }
      ]
    },
    attributes: ['id', 'username', 'name', 'email', 'avatar_url']
  });
  const result = users.map(u => ({
    userId: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatar_url
  }));
  res.json(result);
};

// Arkadaşlık isteği gönder
exports.sendRequest = async (req, res) => {
  const user_id = req.user.id;
  const { friend_id } = req.body;
  if (!friend_id) return res.status(400).json({ error: 'friend_id gerekli' });
  // Sadece aktif/pending arkadaşlık varsa tekrar oluşturma
  const existing = await Friendship.findOne({
    where: {
      user_id,
      friend_id,
      status: ['pending', 'accepted']
    }
  });
  if (existing) return res.status(409).json({ error: 'Zaten istek gönderilmiş' });
  const friendship = await Friendship.create({ user_id, friend_id, status: 'pending' });
  res.status(201).json(friendship);
};

// Gelen istekleri listele
exports.listRequests = async (req, res) => {
  const db = require('../models');
  const user_id = req.user.id;
  const requests = await db.Friendship.findAll({
    where: { friend_id: user_id, status: 'pending' },
    include: [{
      model: db.User,
      as: 'requester',
      attributes: ['id', 'name', 'username', 'avatar_url', 'email']
    }]
  });
  // Sequelize include ile dönen user bilgisi genellikle requester olarak gelir
  const result = requests.map(r => ({
    id: r.id,
    user_id: r.user_id,
    friend_id: r.friend_id,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    requester: r.requester ? {
      id: r.requester.id,
      name: r.requester.name,
      username: r.requester.username,
      avatar_url: r.requester.avatar_url,
      email: r.requester.email
    } : null
  }));
  res.json(result);
};

// İsteğe yanıt ver (kabul/ret)
exports.respondRequest = async (req, res) => {
  const user_id = req.user.id;
  const { request_id, status } = req.body;
  if (!request_id || !['accepted','rejected'].includes(status)) return res.status(400).json({ error: 'Geçersiz parametre' });
  const friendship = await Friendship.findOne({ where: { id: request_id, friend_id: user_id, status: 'pending' } });
  if (!friendship) return res.status(404).json({ error: 'İstek bulunamadı' });
  friendship.status = status;
  await friendship.save();
  res.json(friendship);
};

// Arkadaş listesini getir
exports.listFriends = async (req, res) => {
  const user_id = req.user.id;
  const friends = await Friendship.findAll({
    where: {
      [Op.or]: [
        { user_id, status: 'accepted' },
        { friend_id: user_id, status: 'accepted' }
      ]
    }
  });
  // Kullanıcı adı ve tag formatı ile dön
  const friendIds = friends.map(f => f.user_id === user_id ? f.friend_id : f.user_id);
  const users = await User.findAll({ where: { id: friendIds }, attributes: ['id', 'username', 'name', 'email', 'avatar_url'] });
  const result = users.map(u => ({
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    avatar_url: u.avatar_url,
    tag: `#${u.id}`
  }));
  res.json(result);
};

// Arkadaşlıktan çıkar
exports.removeFriend = async (req, res) => {
  const user_id = req.user.id;
  const { friend_id } = req.body;
  if (!friend_id) return res.status(400).json({ error: 'friend_id gerekli' });
  const friendship = await Friendship.findOne({
    where: {
      [Op.or]: [
        { user_id, friend_id, status: 'accepted' },
        { user_id: friend_id, friend_id: user_id, status: 'accepted' }
      ]
    }
  });
  if (!friendship) return res.status(404).json({ error: 'Arkadaşlık bulunamadı' });
  await friendship.destroy();
  res.json({ message: 'Arkadaşlıktan çıkarıldı' });
};
