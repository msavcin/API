const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const AppSetting = sequelize.define('AppSetting', {
  key: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.TEXT },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'app_settings',
  timestamps: false,
});

module.exports = AppSetting;
