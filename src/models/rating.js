const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const Rating = sequelize.define('Rating', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  campground_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: true },
  anon_name: { type: DataTypes.STRING, allowNull: true },
  rating: { type: DataTypes.INTEGER, allowNull: false },
  comment: { type: DataTypes.TEXT, allowNull: true },
  hidden: { type: DataTypes.BOOLEAN, defaultValue: false },
  moderator_note: { type: DataTypes.TEXT, allowNull: true },
  flagged: { type: DataTypes.BOOLEAN, defaultValue: false },
  flag_reason: { type: DataTypes.STRING, allowNull: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'ratings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Rating;
