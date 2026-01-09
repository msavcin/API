const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const CampgroundFriendAccess = sequelize.define('CampgroundFriendAccess', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  campground_id: { type: DataTypes.INTEGER, allowNull: false },
  friend_user_id: { type: DataTypes.INTEGER, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'campground_friend_access',
  timestamps: false,
});

module.exports = CampgroundFriendAccess;
