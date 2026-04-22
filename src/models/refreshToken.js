const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const RefreshToken = sequelize.define('RefreshToken', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  token_hash: { type: DataTypes.STRING, allowNull: false, unique: true },
  revoked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'refresh_tokens',
  timestamps: false
});

module.exports = RefreshToken;
