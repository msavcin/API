const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const SubscriptionPrice = sequelize.define('SubscriptionPrice', {
  platform: { type: DataTypes.STRING(10), primaryKey: true },
  plan:     { type: DataTypes.STRING(10), primaryKey: true },
  price:    { type: DataTypes.STRING(20), allowNull: false },
}, {
  tableName: 'subscription_prices',
  timestamps: false,
  updatedAt: false,
});

module.exports = SubscriptionPrice;
