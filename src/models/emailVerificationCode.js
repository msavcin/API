const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const EmailVerificationCode = sequelize.define('EmailVerificationCode', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  code: { type: DataTypes.STRING(6), allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'email_verification_codes',
  timestamps: false,
});

module.exports = EmailVerificationCode;
