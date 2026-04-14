const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const ChatConversation = sequelize.define('ChatConversation', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'direct' },
  community_id: { type: DataTypes.INTEGER, allowNull: true },
  title: { type: DataTypes.STRING },
  created_by: { type: DataTypes.INTEGER },
  last_message_at: { type: DataTypes.DATE },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'chat_conversations',
  timestamps: false
});

module.exports = ChatConversation;
