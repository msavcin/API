const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const PasswordReset = sequelize.define('PasswordReset', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  token: { type: DataTypes.STRING, allowNull: false, unique: true },
  expires_at: { type: DataTypes.DATE, allowNull: false }
}, {
  tableName: 'password_resets',
  timestamps: false
});

module.exports = PasswordReset;
