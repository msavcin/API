

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const db = require('./models');
const http = require('http');
const chatSocket = require('./utils/chatSocket');


const app = express();

// CORS middleware - tüm route'lardan önce ekle
app.use((req, res, next) => {
  // Development: tüm originlere izin ver | Production: izin verilen domainler
  const allowedOrigins = process.env.NODE_ENV === 'production' 
    ? ['https://www.kampdefterim.com', 'https://kampdefterim.com', 'https://www.veronicapeyzaj.com', 'https://veronicapeyzaj.com']
    : '*';
  
  const origin = req.headers.origin;
  if (allowedOrigins === '*' || (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', allowedOrigins === '*' ? '*' : origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Preflight istekleri için
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Public routes (auth gerekmez)
app.use('/node/tiles', require('./routes/tileProxy')); // Tile cache proxy - public
app.use('/node/server-time', require('./routes/serverTime'));

// Protected routes (JSON body parser ile)
app.use('/node/users', bodyParser.json(), require('./routes/users'));
app.use('/node/friendships', bodyParser.json(), require('./routes/friendships'));
app.use('/node/auth', bodyParser.json(), require('./routes/auth'));
app.use('/node/communities', bodyParser.json(), require('./routes/communities'));
app.use('/node/communities', bodyParser.json(), require('./routes/communityMembers'));
app.use('/node/announcements', bodyParser.json(), require('./routes/announcements'));
app.use('/node/campgrounds', bodyParser.json(), require('./routes/campgrounds'));
app.use('/node/campground_images', bodyParser.json(), require('./routes/campground_images'));
app.use('/node/seasons', bodyParser.json(), require('./routes/seasons'));
app.use('/node/camping_types', bodyParser.json(), require('./routes/campingTypes'));
app.use('/node/standard_checklists', bodyParser.json(), require('./routes/standardChecklists'));
app.use('/node/custom_checklists', bodyParser.json(), require('./routes/customChecklists'));
app.use('/node/friends', bodyParser.json(), require('./routes/friends'));
app.use('/node/checklst_shares', bodyParser.json(), require('./routes/checklst_shares'));
app.use('/node/campground_friend_access', bodyParser.json(), require('./routes/campground_friend_access'));
app.use('/node/subscriptions', bodyParser.json(), require('./routes/subscriptions'));
// License/public key endpoint
app.use('/node/licenses', bodyParser.json(), require('./routes/licenses'));
// Kamp planlayıcı AI değerlendirmesi
app.use('/node/planner', bodyParser.json(), require('./routes/planner'));
// Chat routes
app.use('/node/chat', bodyParser.json(), require('./routes/chat'));
// AI Review routes (Google Places entegrasyonu ve AI değerlendirme)
// Üç farklı prefix ile desteklenir: /admin/, /camping-areas/, /campgrounds/
const aiReviewRoutes = require('./routes/aiReview');
app.use('/node/admin', bodyParser.json(), aiReviewRoutes); // AI review admin endpoint'leri
app.use('/node/camping-areas', bodyParser.json(), aiReviewRoutes);
app.use('/node/campgrounds', bodyParser.json(), aiReviewRoutes); // geriye uyumluluk
// Admin Settings routes
app.use('/node/admin', bodyParser.json(), require('./routes/adminSettings'));
// Feature entitlement routes
app.use('/node/feature-entitlements', bodyParser.json(), require('./routes/featureEntitlements'));


// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
db.sequelize.sync().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`API sunucusu ${PORT} portunda çalışıyor.`);
  });
  // WebSocket init
  try {
    chatSocket.init(server);
    console.log('[WS] Chat WebSocket başlatıldı.');
  } catch (e) {
    console.warn('[WS] Başlatılamadı:', e && e.message);
  }
});
