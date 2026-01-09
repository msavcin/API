const { DataTypes } = require('sequelize');
const sequelize = require('./index').sequelize;

const Announcement = sequelize.define('Announcement', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  community_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  created_by: { type: DataTypes.INTEGER, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  valilik_id: { type: DataTypes.STRING },
  keywords: { type: DataTypes.STRING },
  source_url: { type: DataTypes.STRING },
  islenme_tarihi: { type: DataTypes.DATE },
  link: { type: DataTypes.STRING },
  date: { type: DataTypes.DATE },
  aktif: { type: DataTypes.BOOLEAN, defaultValue: true },
  etkinlik_turu: { type: DataTypes.STRING },
  zorluk_seviyesi: { type: DataTypes.STRING },
  etkinlik_tarihi: { type: DataTypes.DATE },
  etkinlik_suresi: { type: DataTypes.STRING },
  etkinlik_yeri: { type: DataTypes.STRING },
  etkinlik_yeri_id: { type: DataTypes.INTEGER },
  event_photos: { type: DataTypes.ARRAY(DataTypes.TEXT) },
  baslama_zamani: { type: DataTypes.STRING },
  bitis_zamani: { type: DataTypes.STRING },
}, {
  tableName: 'announcements',
  timestamps: false,
});

module.exports = Announcement;
