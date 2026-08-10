const { DataTypes } = require('sequelize');
const db = require('./index');


const Campground = db.sequelize.define('Campground', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.STRING },
  name: { type: DataTypes.STRING, allowNull: false },
  latitude: { type: DataTypes.FLOAT, allowNull: false },
  longitude: { type: DataTypes.FLOAT, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  website: { type: DataTypes.STRING },
  phone: { type: DataTypes.STRING },
  opening_hours: { type: DataTypes.STRING },
  capacity: { type: DataTypes.INTEGER },
  fee: { type: DataTypes.INTEGER, defaultValue: 0 },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  rating: { type: DataTypes.FLOAT, defaultValue: 0.0 },
  review_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  google_rating: { type: DataTypes.FLOAT, allowNull: true },
  google_review_count: { type: DataTypes.INTEGER, allowNull: true },
  price_range: { type: DataTypes.STRING },
  facilities: { type: DataTypes.TEXT, defaultValue: '[]' },
  accessibility: { type: DataTypes.TEXT, defaultValue: '[]' },
  social_media: { type: DataTypes.TEXT, defaultValue: '{}' },
  booking_url: { type: DataTypes.STRING },
  contact_email: { type: DataTypes.STRING },
  last_verified: { type: DataTypes.STRING },
  visibility: { type: DataTypes.STRING },
  community_id: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  owner_id: { type: DataTypes.INTEGER },
  friend_user_ids: { type: DataTypes.TEXT, defaultValue: '[]' },
  created_at: { type: DataTypes.STRING, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.STRING, defaultValue: DataTypes.NOW },
  external_id: { type: DataTypes.STRING },
  source_id: { type: DataTypes.STRING },
  photo_links: { type: DataTypes.TEXT, defaultValue: '[]' },
  amenities: { type: DataTypes.TEXT, defaultValue: '[]' },
  tags: { type: DataTypes.TEXT, defaultValue: '{}' },
  images: { type: DataTypes.TEXT, defaultValue: '[]' },
  province: { type: DataTypes.JSONB, allowNull: true },
  deleted: { type: DataTypes.INTEGER, defaultValue: 0 },
  // AI Review fields
  ai_review_evaluation: { type: DataTypes.TEXT, allowNull: true },
  ai_review_generated_at: { type: DataTypes.DATE, allowNull: true },
  ai_review_enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
  google_place_id: { type: DataTypes.STRING, allowNull: true },
  last_google_sync_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'campgrounds',
  timestamps: false
});

module.exports = Campground;
