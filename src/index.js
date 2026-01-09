

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const db = require('./models');


const app = express();

// CORS middleware - tüm route'lardan önce ekle
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://www.kampdefterim.com'); // Test için *, production'da 'https://www.kampdefterim.com'
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Preflight istekleri için
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Sadece JSON bekleyen route'larda bodyParser.json() kullan
app.use('/node/users', bodyParser.json(), require('./routes/users'));
app.use('/node/friendships', bodyParser.json(), require('./routes/friendships'));
app.use('/node/auth', bodyParser.json(), require('./routes/auth'));
app.use('/node/communities', bodyParser.json(), require('./routes/communities'));
app.use('/node/communities', bodyParser.json(), require('./routes/communityMembers'));
app.use('/node/campgrounds', bodyParser.json(), require('./routes/campgrounds'));
app.use('/node/campground_images', bodyParser.json(), require('./routes/campground_images'));
app.use('/node/seasons', bodyParser.json(), require('./routes/seasons'));
app.use('/node/camping_types', bodyParser.json(), require('./routes/campingTypes'));
app.use('/node/standard_checklists', bodyParser.json(), require('./routes/standardChecklists'));
app.use('/node/custom_checklists', bodyParser.json(), require('./routes/customChecklists'));
app.use('/node/friends', bodyParser.json(), require('./routes/friends'));
app.use('/node/checklst_shares', bodyParser.json(), require('./routes/checklst_shares'));
app.use('/node/campground_friend_access', bodyParser.json(), require('./routes/campground_friend_access'));
// Fotoğraf yükleme ve tile proxy route'larında body-parser yok
app.use('/node/announcements', bodyParser.json(), require('./routes/announcements'));
app.use('/node/tiles', require('./routes/tileProxy'));

// Yeni modüler router'lar
app.use('/node/server-time', require('./routes/serverTime'));
app.use('/node/users', require('./routes/users'));
app.use('/node/friendships', require('./routes/friendships'));
app.use('/node/auth', require('./routes/auth'));
app.use('/node/communities', require('./routes/communities'));
app.use('/node/communities', require('./routes/communityMembers'));
app.use('/node/announcements', require('./routes/announcements'));
app.use('/node/campgrounds', require('./routes/campgrounds'));
app.use('/node/campground_images', require('./routes/campground_images'));
app.use('/node/tiles', require('./routes/tileProxy')); // Tile cache proxy eklendi
app.use('/node/seasons', require('./routes/seasons'));
app.use('/node/camping_types', require('./routes/campingTypes'));
app.use('/node/standard_checklists', require('./routes/standardChecklists'));
app.use('/node/custom_checklists', require('./routes/customChecklists'));
app.use('/node/friends', require('./routes/friends'));
app.use('/node/checklst_shares', require('./routes/checklst_shares'));
app.use('/node/campground_friend_access', require('./routes/campground_friend_access'));

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
db.sequelize.sync().then(() => {
  app.listen(PORT, '0.0.0.0',() => {
    console.log(`API sunucusu ${PORT} portunda çalışıyor.`);
  });
});
