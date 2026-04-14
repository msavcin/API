const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const ChatConversationParticipant = sequelize.define('ChatConversationParticipant', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  conversation_id: { type: DataTypes.BIGINT, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  role: { type: DataTypes.STRING, defaultValue: 'member' },
  last_read_message_id: { type: DataTypes.BIGINT },
  unread_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  joined_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  is_muted: { type: DataTypes.BOOLEAN, defaultValue: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'chat_conversation_participants',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['conversation_id', 'user_id'] }
  ]
});

module.exports = ChatConversationParticipant;
