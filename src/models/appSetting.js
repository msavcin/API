const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const AppSetting = sequelize.define('AppSetting', {
  key: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.TEXT },
  description: { type: DataTypes.TEXT, allowNull: true },
  updated_by: { type: DataTypes.INTEGER, allowNull: true },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'app_settings',
  timestamps: false,
});

module.exports = AppSetting;
