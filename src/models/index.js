const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');



const Campground = sequelize.define('Campground', {
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
}, {
  tableName: 'campgrounds',
  timestamps: false
});






const CommunityMember = require('./communityMember');
const PasswordReset = require('./passwordReset');
const RefreshToken = require('./refreshToken');
const User = require('./user');
const Friendship = require('./friendship');
const ChecklstShare = require('./checklstShare');
const CustomChecklist = require('./customChecklist');

// Friendship ile User arasında ilişki: user_id -> requester
Friendship.belongsTo(User, { foreignKey: 'user_id', as: 'requester' });

// Association: Paylaşılan checklist ile checklist başlığı
ChecklstShare.belongsTo(CustomChecklist, { foreignKey: 'checklist_id', as: 'custom_checklist' });
// CustomChecklist ile User arasında ilişki (oluşturan kullanıcı)
CustomChecklist.belongsTo(User, { foreignKey: 'user_id', as: 'owner' });

const CampgroundFriendAccess = require('./campgroundFriendAccess');
const Rating = require('./rating');
const ChatConversation = require('./chatConversation');
const ChatMessage = require('./chatMessage');
const ChatConversationParticipant = require('./chatConversationParticipant');

module.exports = {
  sequelize,
  Campground,
  CommunityMember,
  User,
  RefreshToken,
  Friendship,
  ChecklstShare,
  CustomChecklist,
  PasswordReset,
  CampgroundFriendAccess,
  Rating,
  ChatConversation,
  ChatMessage,
  ChatConversationParticipant,
};

// Associations for ratings
try {
  Rating.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  Rating.belongsTo(Campground, { foreignKey: 'campground_id', as: 'campground' });
  Campground.hasMany(Rating, { foreignKey: 'campground_id', as: 'ratings' });
  User.hasMany(Rating, { foreignKey: 'user_id', as: 'ratings' });
} catch (e) {
  // Safe-guard for migration / boot ordering
  console.warn('[MODELS] rating association setup failed', e.message);
}

// Chat associations
try {
  ChatMessage.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });
  ChatMessage.belongsTo(ChatConversation, { foreignKey: 'conversation_id', as: 'conversation' });
  ChatConversation.hasMany(ChatMessage, { foreignKey: 'conversation_id', as: 'messages' });
  ChatConversationParticipant.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
  ChatConversation.hasMany(ChatConversationParticipant, { foreignKey: 'conversation_id', as: 'participants' });
  ChatConversationParticipant.belongsTo(ChatConversation, { foreignKey: 'conversation_id', as: 'conversation' });
} catch (e) {
  console.warn('[MODELS] chat association setup failed', e.message);
}
