const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const CommunityMember = sequelize.define('CommunityMember', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  community_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false },
  joined_at: { type: DataTypes.DATE },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'community_members',
  timestamps: false,
});

module.exports = CommunityMember;
