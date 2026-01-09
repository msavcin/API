// JWT doğrulama ve rol kontrolü için middleware
const jwt = require('jsonwebtoken');
const db = require('../models');
const User = db.User || require('../models/user');

const JWT_SECRET = process.env.JWT_SECRET || 'demo_secret_key';

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token gerekli' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.warn('[AUTH][JWT] Geçersiz token:', token, 'Hata:', err);
      return res.status(403).json({ error: 'Geçersiz token' });
    }
    req.user = user;
    next();
  });
}

async function leaderMiddleware(req, res, next) {
  console.log('[LEADER_MIDDLEWARE] Başlangıç', { user: req.user, body: req.body, params: req.params });
  const db = require('../models');
  const User = db.User || require('../models/user');
  const user = await User.findByPk(req.user.id);
  if (user && user.role === 'superadmin') {
    console.log('[LEADER_MIDDLEWARE] Superadmin, next()');
    return next();
  }
  let communityId = req.user.community_id;
  // Multer ile gelen body bazen string olabilir, parse etmeye çalış
  let bodyCommunityId = req.body && req.body.community_id;
  if (typeof req.body === 'string') {
    try {
      const parsedBody = JSON.parse(req.body);
      bodyCommunityId = parsedBody.community_id || bodyCommunityId;
      console.log('[LEADER_MIDDLEWARE][PARSED_BODY]', parsedBody);
    } catch (e) {
      console.log('[LEADER_MIDDLEWARE][BODY_PARSE_ERROR]', e);
    }
  }
  communityId = communityId || bodyCommunityId || req.params.community_id || req.params.id;
  console.log('[LEADER_MIDDLEWARE] communityId:', communityId);
  if (!communityId) {
    console.log('[LEADER_MIDDLEWARE] community_id eksik');
    return res.status(400).json({ error: 'community_id zorunlu ve eksik (JWT veya body/param)' });
  }
  const userId = req.user.id;
  const CommunityMember = db.CommunityMember || require('../models/communityMember');
  const member = await CommunityMember.findOne({ where: { community_id: communityId, user_id: userId, status: 'active' } });
  if (!member) {
    console.log('[LEADER_MIDDLEWARE] Topluluk üyesi değil');
    return res.status(403).json({ error: 'Topluluk üyesi değilsiniz' });
  }
  if (member.role !== 'leader') {
    console.log('[LEADER_MIDDLEWARE] Lider değil, rol:', member.role);
    return res.status(403).json({ error: 'Sadece lider işlem yapabilir' });
  }
  console.log('[LEADER_MIDDLEWARE] Lider, next()');
  next();
}

// guest rolünü kısıtlayan middleware
function guestRestrictionMiddleware(req, res, next) {
  if (req.user && req.user.role === 'guest') {
    // Burada isterseniz endpoint bazlı daha detaylı kontrol ekleyebilirsiniz
    return res.status(403).json({ error: 'Guest kullanıcıların bu işlemi yapma yetkisi yok.' });
  }
  next();
}

module.exports = { authMiddleware, leaderMiddleware, guestRestrictionMiddleware };
