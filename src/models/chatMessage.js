const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const ChatMessage = sequelize.define('ChatMessage', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  conversation_id: { type: DataTypes.BIGINT, allowNull: false },
  sender_id: { type: DataTypes.INTEGER, allowNull: false },
  recipient_id: { type: DataTypes.INTEGER, allowNull: true },
  community_id: { type: DataTypes.INTEGER, allowNull: true },
  reply_to_message_id: { type: DataTypes.BIGINT, allowNull: true },
  text: { type: DataTypes.TEXT },
  attachments: { type: DataTypes.JSONB },
  meta: { type: DataTypes.JSONB },
  edited: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'chat_messages',
  timestamps: false
});

module.exports = ChatMessage;
