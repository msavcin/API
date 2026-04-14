// Kullanıcı ekle (admin veya sistem için, register'dan farklı)
exports.createUser = async (req, res) => {
  try {
    const { name, username, email, password, role = 'user' } = req.body;
    if (!name || !username || !email || !password) {
      return res.status(400).json({ error: 'name, username, email, password zorunlu' });
    }
    const exists = await User.findOne({ where: { [Op.or]: [{ name }, { username }, { email }] } });
    if (exists) return res.status(400).json({ error: 'Kullanıcı zaten var' });
    const hash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, username, email, password_hash: hash, role, trial_user: req.body.trial_user === true });
  const token = jwt.sign({ id: user.id, name: user.name, username: user.username, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '10d' });
  res.status(201).json({ id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, token });
  } catch (err) {
    res.status(500).json({ error: 'Kullanıcı eklenemedi', detail: err.message });
  }
};

// Kullanıcı listele
exports.listUsers = async (req, res) => {
  try {
    const users = await User.findAll({ attributes: ['id', 'name', 'username', 'email', 'role'] });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Kullanıcılar listelenemedi', detail: err.message });
  }
};
// Kullanıcıya güncel rol ile yeni JWT token üretir (refresh token endpointi)
exports.refreshToken = async (req, res) => {
  const db = require('../models');
  const User = db.User || require('../models/user');
  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  const token = jwt.sign({ id: user.id, name: user.name, username: user.username, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '10d' });
  res.json({ token });
};
// Kullanıcı işlemleri controller


const { Op } = require('sequelize');
exports.register = async (req, res) => {
  console.log('REGISTER endpoint called', req.body);
  // Kayıt işlemi (topluluk seçimi opsiyonel)
  const { name, username, email, password, communityId, community_id, agreement_accepted } = req.body;
  const realCommunityId = communityId !== undefined ? communityId : community_id;
  if (!name || !username || !email || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı, kullanıcı adı (username), eposta ve şifre zorunlu' });
  }
  // E-posta doğrulama kontrolü
  const EmailVerificationCode = db.EmailVerificationCode || require('../models/emailVerificationCode');
  const codeRecord = await EmailVerificationCode.findOne({ where: { email } });
  if (!codeRecord || codeRecord.expires_at < new Date()) {
    return res.status(400).json({ error: 'E-posta doğrulaması yapılmamış veya kodun süresi dolmuş.' });
  }
  const exists = await User.findOne({ where: { [Op.or]: [{ name }, { username }, { email }] } });
  if (exists) return res.status(400).json({ error: 'Kullanıcı adı, kullanıcı adı (username) veya eposta zaten kullanılıyor' });
  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    username,
    email,
    password_hash: hash,
    role: 'user',
    trial_user: req.body.trial_user === true,
    agreement_accepted: agreement_accepted === true, // frontendden bool gelirse true, yoksa false
    offline_enabled: req.body.offline_enabled === true
  });
  // Eğer realCommunityId varsa, topluluğa katılım isteği oluştur
  if (realCommunityId !== undefined) {
    if (!realCommunityId) {
      return res.status(400).json({ error: 'communityId eksik veya geçersiz' });
    }
    const CommunityMember = db.CommunityMember || require('../models/communityMember');
    try {
      const cmInput = { community_id: realCommunityId, user_id: user.id, role: 'member', status: 'pending' };
      console.log('CommunityMember.create input:', cmInput);
      await CommunityMember.create(cmInput);
    } catch (err) {
      console.error('CommunityMember.create error:', err && err.message, err && err.stack, err);
    }
  }
  // Kayıt başarılıysa doğrulama kodunu sil
  await EmailVerificationCode.destroy({ where: { email } });
  const token = jwt.sign({ id: user.id, name: user.name, username: user.username, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '10d' });
  res.status(201).json({ id: user.id, name: user.name, username: user.username, email: user.email, offline_enabled: user.offline_enabled, token });
};

const db = require('../models');
const User = db.User || require('../models/user');
const JWT_SECRET = process.env.JWT_SECRET || 'demo_secret_key';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');


exports.login = async (req, res) => {
  // Hem username hem email ile giriş
  const { username, email, password } = req.body;
  if (!password || (!username && !email)) {
    return res.status(400).json({ error: 'Kullanıcı adı (username)/eposta ve şifre zorunlu' });
  }
  let user;
  if (username) {
    // Büyük/küçük harf duyarsız arama (Sequelize where fonksiyonu ile)
    user = await User.findOne({
      where: require('sequelize').where(
        require('sequelize').fn('lower', require('sequelize').col('username')),
        username.toLowerCase()
      )
    });
  } else {
    user = await User.findOne({ where: { email } });
  }
  if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı' });
  // trial_user ise ve 30 günü geçtiyse otomatik guest yap ve forceLogout flag'i hazırla
  let forceLogout = false;
  const createdDate = user.createdAt || user.created_at;
  if (user.role === 'user' && user.trial_user && createdDate) {
    const now = new Date();
    const created = new Date(createdDate);
    const diffDays = (now - created) / (1000 * 60 * 60 * 24);
    if (diffDays > 30) {
      await user.update({ role: 'guest', offline_enabled: false });
      user.role = 'guest';
      user.offline_enabled = false;
      forceLogout = true;
    }
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Şifre hatalı' });
  // Her login'de rolü veritabanından tekrar çekerek güncel rol ile token üret
  const db = require('../models');
  const UserModel = db.User || require('../models/user');
  const CommunityMember = db.CommunityMember || require('../models/communityMember');
  // pending üyelik varsa girişe izin verme
  const pendingMember = await CommunityMember.findOne({ where: { user_id: user.id, status: 'pending' } });
  if (pendingMember) {
    return res.status(403).json({ error: 'Topluluk üyeliğiniz henüz onaylanmadı (pending).' });
  }
  const freshUser = await UserModel.findByPk(user.id);
  const token = jwt.sign({ id: freshUser.id, name: freshUser.name, username: freshUser.username, email: freshUser.email, role: freshUser.role }, JWT_SECRET, { expiresIn: '10d' });
  res.json(forceLogout ? { forceLogout: true } : { token });
};

const CommunityMember = db.CommunityMember || require('../models/communityMember');
const UserModel = db.User || require('../models/user');
// Association: CommunityMember belongsTo User
if (!CommunityMember.associations || !CommunityMember.associations.user) {
  CommunityMember.belongsTo(UserModel, { foreignKey: 'user_id', as: 'user' });
}
exports.getMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    console.log('Kullanıcı avatar_url:', user.avatar_url);

    // Kullanıcının topluluk üyeliğini bul
    const pendingMember = await CommunityMember.findOne({
      where: { user_id: userId, status: 'pending' },
      include: [{ model: UserModel, as: 'user', attributes: ['id', 'name', 'username', 'email'] }]
    });
    if (pendingMember) {
      console.log('getMe: member status:', pendingMember.status || pendingMember.member_status);
      return res.status(403).json({ error: 'Topluluk üyeliğiniz henüz onaylanmadı (pending).' });
    }

    const member = await CommunityMember.findOne({
      where: { user_id: userId, status: 'active' },
      include: [{ model: UserModel, as: 'user', attributes: ['id', 'name', 'username', 'email'] }]
    });
    if (member) {
      console.log('getMe: member status:', member.status || member.member_status);
    } else {
      console.log('getMe: member yok');
    }
    console.log('getMe yanıtı avatar_url:', user.avatar_url);

    // Gerçek zamanlı abonelik süre kontrolü — DB'yi de güncelle
    const now = new Date();
    const isExpired = user.subscription_is_active &&
      user.subscription_expires_at &&
      user.subscription_expires_at < now;
    if (isExpired) {
      await user.update({ subscription_is_active: false, offline_enabled: false, role: 'guest' });
      user.subscription_is_active = false;
      user.offline_enabled = false;
      user.role = 'guest';
      console.log('[getMe] Süresi geçmiş abonelik anında düşürüldü:', userId);
    }

    const isPremium = !!(user.offline_enabled || (user.subscription_is_active &&
      user.subscription_expires_at &&
      user.subscription_expires_at > now));

    return res.json({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      community_id: member ? member.community_id : null,
      role: user.role === 'superadmin' ? 'superadmin' : (member ? member.role : user.role),
      avatar_url: user.avatar_url || null,
      trial_user: user.trial_user,
      offline_enabled: isPremium,
      offline_radius_km: user.offline_radius_km || 20,
      isPremium,
      subscription: {
        isActive: isPremium,
        expiresAt: user.subscription_expires_at || null,
        autoRenewing: isPremium ? (user.subscription_auto_renewing ?? null) : false,
        platform: user.subscription_platform || null,
        productId: user.subscription_product_id || null,
      },
      createdAt: user.createdAt,
      created_at: user.created_at,
      member: member ? {
        ...member.toJSON(),
        user: member.user ? {
          id: member.user.id,
          name: member.user.name,
          username: member.user.username,
          email: member.user.email,
          role: req.user.role
        } : undefined
      } : null
    });
  } catch (err) {
    console.error('[getMe] Hata:', err);
    if (err && err.name === 'SequelizeDatabaseError' && err.parent && err.parent.code === '42703') {
      return res.status(500).json({ error: 'Veritabanı sütunu eksik. Lütfen migrationları çalıştırın: npx sequelize-cli db:migrate' });
    }
    return res.status(500).json({ error: 'Kullanıcı bilgisi alınamadı', detail: err.message });
  }
};

// Kullanıcının o gün için kalan AI değerlendirme hakkını döner (tüketmez)
exports.aiEvalStatus = async (req, res) => {
  try {
    const evalLimitDefault = parseInt(process.env.AI_DAILY_EVAL_LIMIT ?? '10', 10);
    let evalLimit = evalLimitDefault;
    const AppSetting = db.AppSetting || require('../models/appSetting');
    try {
      const s = await AppSetting.findByPk('ai_daily_eval_limit');
      if (s && s.value) {
        const p = parseInt(s.value, 10);
        if (!Number.isNaN(p)) evalLimit = p;
      }
    } catch (e) {
      // app_settings tablosu yoksa veya sorgu hata verirse varsayılanı kullan
    }

    const userId = req.user.id;
    const user = await User.findByPk(userId, { attributes: ['ai_eval_count', 'ai_eval_count_date'] });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const today = new Date().toISOString().slice(0, 10);
    const used = (user.ai_eval_count_date && String(user.ai_eval_count_date).slice(0, 10) === today) ? (user.ai_eval_count || 0) : 0;
    const remaining = Math.max(0, evalLimit - used);

    return res.json({ remaining, limit: evalLimit, used });
  } catch (err) {
    console.error('[USER] aiEvalStatus error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Durum alınamadı' });
  }
};




exports.updateMe = async (req, res) => {
  // Profil güncelleme
  res.json({ message: 'updateMe endpoint' });
};

exports.updateEmail = async (req, res) => {
  // Eposta güncelleme
  const userId = req.user.id;
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Eposta zorunlu' });
  // Eposta benzersiz olmalı
  const exists = await User.findOne({ where: { email } });
  if (exists) return res.status(400).json({ error: 'Bu eposta zaten kullanılıyor' });
  await User.update({ email }, { where: { id: userId } });
  res.json({ message: 'Eposta güncellendi', email });
};
// Avatar upload için presigned URL dönen endpoint
exports.getAvatarUploadUrl = async (req, res) => {
  try {
    const { getPutObjectSignedUrl } = require('../utils/s3');
    const userId = req.user.id;
    // İstekten dosya adı ve contentType al
    let { fileName, contentType } = req.body;
    if (!fileName) fileName = `avatars/${userId}_${Date.now()}.jpg`;
    if (!contentType) contentType = 'image/jpeg';
    const uploadUrl = await getPutObjectSignedUrl({ Bucket: process.env.AWS_S3_BUCKET, Key: fileName, ContentType: contentType, expiresIn: 60 });
    res.json({ uploadUrl, fileName });
  } catch (err) {
    console.error('S3 presigned URL hatası:', err);
    res.status(500).json({ error: 'Presigned URL alınamadı', detail: err.message });
  }
};

// Kendi profilini PATCH ile güncelle
exports.patchMe = async (req, res) => {
  const db = require('../models');
  const User = db.User || require('../models/user');
  const userId = req.user.id;
  const allowedFields = ['name', 'username', 'email', 'avatar_url'];
  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  if (req.body.avatar_url !== undefined) {
    console.log('PATCH /users/me avatar_url:', req.body.avatar_url);
  }
  try {
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  await user.update(updates);
  console.log('Güncellenen user.avatar_url:', user.avatar_url);
  res.json({ id: user.id, name: user.name, username: user.username, email: user.email, avatar_url: user.avatar_url });
  } catch (err) {
    res.status(500).json({ error: 'Profil güncellenemedi', detail: err.message });
  }
};

// Hesabı ve tüm ilgili verileri sil
exports.deleteMe = async (req, res) => {
  const db = require('../models');
  const sequelize = db.sequelize;
  const userId = req.user.id;

  try {
    await sequelize.transaction(async (t) => {
      // 1. Arkadaşlık kayıtları (pending isteği dahil tüm statüler, her iki yön)
      await sequelize.query(
        'DELETE FROM friendships WHERE user_id = :userId OR friend_id = :userId',
        { replacements: { userId }, transaction: t }
      );

      // 2. Topluluk üyelikleri
      await sequelize.query(
        'DELETE FROM community_members WHERE user_id = :userId',
        { replacements: { userId }, transaction: t }
      );

      // 3. Kamp alanı fotoğrafları
      await sequelize.query(
        'DELETE FROM campground_images WHERE uploaded_by = :userId',
        { replacements: { userId }, transaction: t }
      );

      // 4. Kullanıcıyı başkalarının kamp alanı arkadaş erişim listesinden çıkar
      await sequelize.query(
        'DELETE FROM campground_friend_access WHERE friend_user_id = :userId',
        { replacements: { userId }, transaction: t }
      );

      // 5. Kullanıcının oluşturduğu etkinlik/duyurular (sistem duyuruları korunur)
      await sequelize.query(
        'DELETE FROM announcements WHERE created_by = :userId AND valilik_id IS NULL',
        { replacements: { userId }, transaction: t }
      );

      // 6. Checklist paylaşımları (paylaşan veya paylaşılan olarak)
      await sequelize.query(
        'DELETE FROM checklist_shares WHERE shared_by_user_id = :userId OR shared_with_user_id = :userId',
        { replacements: { userId }, transaction: t }
      );

      // 7. Kullanıcının özel kontrol listesi öğeleri
      await sequelize.query(
        'DELETE FROM custom_checklist_items WHERE checklist_id IN (SELECT id FROM custom_checklists WHERE user_id = :userId)',
        { replacements: { userId }, transaction: t }
      );

      // 8. Kullanıcının özel kontrol listeleri
      await sequelize.query(
        'DELETE FROM custom_checklists WHERE user_id = :userId',
        { replacements: { userId }, transaction: t }
      );

      // 9. Kullanıcının oluşturduğu kamp alanları (source_id='0' → kullanıcı girişi)
      await sequelize.query(
        "DELETE FROM campgrounds WHERE owner_id = :userId AND source_id = '0'",
        { replacements: { userId }, transaction: t }
      );

      // 10. Diğer kamp alanlarının friend_user_ids JSON dizisinden kullanıcıyı çıkar
      //     (INT veya STRING olarak saklanan her iki biçimi de kapsar)
      await sequelize.query(
        `UPDATE campgrounds
         SET friend_user_ids = (
           SELECT COALESCE(json_agg(e)::text, '[]')
           FROM jsonb_array_elements(COALESCE(NULLIF(friend_user_ids, ''), '[]')::jsonb) e
           WHERE e::text NOT IN (:userIdNum, :userIdQuoted)
         )
         WHERE friend_user_ids IS NOT NULL
           AND friend_user_ids NOT IN ('', '[]')
           AND friend_user_ids LIKE :likePattern`,
        {
          replacements: {
            userIdNum: String(userId),
            userIdQuoted: `"${userId}"`,
            likePattern: `%${userId}%`,
          },
          transaction: t,
        }
      );

      // 11. Kullanıcıyı sil (en son)
      await sequelize.query(
        'DELETE FROM users WHERE id = :userId',
        { replacements: { userId }, transaction: t }
      );
    });

    res.json({ message: 'Hesabınız başarıyla silindi.' });
  } catch (err) {
    console.error('[deleteMe] Hata:', err);
    res.status(500).json({ error: 'Hesap silinemedi', detail: err.message });
  }
};
