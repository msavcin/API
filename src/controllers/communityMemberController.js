const db = require('../models');
const CommunityMember = db.CommunityMember || require('../models/communityMember');

exports.getMember = async (req, res) => {
  const community_id = parseInt(req.params.id, 10);
  const user_id = parseInt(req.params.userId, 10);
  if (community_id === undefined || isNaN(community_id)) return res.status(400).json({ error: 'community_id eksik veya geçersiz' });
  if (user_id === undefined || isNaN(user_id)) return res.status(400).json({ error: 'user_id eksik veya geçersiz' });
  const member = await CommunityMember.findOne({ where: { community_id, user_id } });
  if (!member) return res.status(404).json({ error: 'Üyelik bulunamadı' });
  res.json(member);
};
// Topluluk üyelik işlemleri controller
exports.joinCommunity = async (req, res) => {
  const community_id = parseInt(req.params.id, 10);
  if (isNaN(community_id)) return res.status(400).json({ error: 'Geçersiz community_id' });
  const user_id = req.user.id;
  const db = require('../models');
  const CommunityMember = db.CommunityMember || require('../models/communityMember');
  // Kullanıcı zaten başvurduysa tekrar ekleme
  const existing = await CommunityMember.findOne({ where: { community_id, user_id } });
  if (existing) return res.status(400).json({ error: 'Zaten başvuru yapılmış veya üyesiniz.' });
  const member = await CommunityMember.create({
    community_id,
    user_id,
    role: 'member',
    status: 'pending',
    joined_at: null,
    created_at: new Date()
  });
  res.status(201).json(member);
};

exports.listMembers = async (req, res) => {
  const community_id = parseInt(req.params.id, 10);
  if (isNaN(community_id)) return res.status(400).json({ error: 'Geçersiz community_id' });
  const { status } = req.query;
  const allowedStatuses = ['active', 'pending', 'rejected', 'removed'];
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: `Geçersiz status. Sadece şunlar olabilir: ${allowedStatuses.join(', ')}` });
  }
  const where = { community_id };
  if (status) where.status = status;
  const db = require('../models');
  const CommunityMember = db.CommunityMember || require('../models/communityMember');
  const User = db.User || require('../models/user');
  // Association: CommunityMember belongsTo User
  if (!CommunityMember.associations || !CommunityMember.associations.user) {
    CommunityMember.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  }
  const members = await CommunityMember.findAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'username', 'email', 'avatar_url'] }]
  });
  res.json(members);
};

exports.approveMember = async (req, res) => {
  const community_id = parseInt(req.params.id, 10);
  const user_id = parseInt(req.params.userId, 10);
  if (isNaN(community_id) || isNaN(user_id)) return res.status(400).json({ error: 'Geçersiz community_id veya user_id' });
  const member = await CommunityMember.findOne({ where: { community_id, user_id } });
  if (!member) return res.status(404).json({ error: 'Üyelik bulunamadı' });
  try {
    member.status = 'active';
    await member.save();
    res.json({ message: 'Üyelik onaylandı', member });
  } catch (err) {
    console.error('approveMember error:', err);
    res.status(500).json({ error: 'Durum güncellenemedi', detail: err.message });
  }
};

exports.rejectMember = async (req, res) => {
  const community_id = parseInt(req.params.id, 10);
  const user_id = parseInt(req.params.userId, 10);
  if (isNaN(community_id) || isNaN(user_id)) return res.status(400).json({ error: 'Geçersiz community_id veya user_id' });
  
  const member = await CommunityMember.findOne({ where: { community_id, user_id } });
  if (!member) return res.status(404).json({ error: 'Üyelik bulunamadı' });
  
  try {
    member.status = 'rejected';
    member.joined_at = null;
    await member.save();
    res.json({ message: 'Üyelik reddedildi', member });
  } catch (err) {
    console.error('rejectMember error:', err);
    res.status(500).json({ error: 'Üyelik reddedilemedi', detail: err.message });
  }
};

exports.removeMember = async (req, res) => {
  const community_id = parseInt(req.params.id, 10);
  const user_id = parseInt(req.params.userId, 10);
  if (isNaN(community_id) || isNaN(user_id)) return res.status(400).json({ error: 'Geçersiz community_id veya user_id' });
  
  const member = await CommunityMember.findOne({ where: { community_id, user_id } });
  if (!member) return res.status(404).json({ error: 'Üyelik bulunamadı' });
  
  try {
    await member.destroy();
    res.json({ message: 'Üye topluluktan çıkarıldı', success: true });
  } catch (err) {
    console.error('removeMember error:', err);
    res.status(500).json({ error: 'Üye çıkarılamadı', detail: err.message });
  }
};


// Genel status güncelleme endpointi
exports.updateMemberStatus = async (req, res) => {
  const community_id = parseInt(req.params.id, 10);
  const user_id = parseInt(req.params.userId, 10);
  const { status } = req.body;
  const allowedStatuses = ['active', 'pending', 'rejected', 'removed'];
  if (!status || !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: `Geçersiz status. Sadece şunlar olabilir: ${allowedStatuses.join(', ')}` });
  }
  if (isNaN(community_id) || isNaN(user_id)) return res.status(400).json({ error: 'Geçersiz community_id veya user_id' });
  const member = await CommunityMember.findOne({ where: { community_id, user_id } });
  if (!member) return res.status(404).json({ error: 'Üyelik bulunamadı' });
  try {
    member.status = status;
    await member.save();
    res.json({ message: 'Üyelik durumu güncellendi', member });
  } catch (err) {
    console.error('updateMemberStatus error:', err);
    res.status(500).json({ error: 'Durum güncellenemedi', detail: err.message });
  }
};
