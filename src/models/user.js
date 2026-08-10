const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  name: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, defaultValue: 'user' },
  avatar_url: { type: DataTypes.STRING },
  trial_user: { type: DataTypes.BOOLEAN, defaultValue: false },
  trial_started_at: { type: DataTypes.DATE, allowNull: true },
  trial_expires_at: { type: DataTypes.DATE, allowNull: true },
  trial_granted_by: { type: DataTypes.INTEGER, allowNull: true },
  agreement_accepted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  offline_enabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  offline_radius_km: { type: DataTypes.INTEGER, defaultValue: 20 },
  subscription_platform: { type: DataTypes.STRING },
  subscription_product_id: { type: DataTypes.STRING },
  subscription_transaction_id: { type: DataTypes.STRING },
  subscription_expires_at: { type: DataTypes.DATE },
  subscription_is_active: { type: DataTypes.BOOLEAN, defaultValue: false },
  // Webhook event'lerinde kullanıcı araması için:
  // iOS = Apple originalTransactionId, Android = son geçerli purchaseToken
  subscription_lookup_key: { type: DataTypes.STRING(512) },
  // Kullanıcı iptal etmediyse true, iptal ettiyse false (süre bitinceye kadar isActive kalabilir)
  subscription_auto_renewing: { type: DataTypes.BOOLEAN, defaultValue: null },
  // AI değerlendirme günlük kullanım sayacı
  ai_eval_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  ai_eval_count_date: { type: DataTypes.DATEONLY, allowNull: true },
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = User;
