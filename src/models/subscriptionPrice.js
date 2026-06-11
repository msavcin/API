const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const SubscriptionPrice = sequelize.define('SubscriptionPrice', {
  platform:                { type: DataTypes.STRING(10),  primaryKey: true },
  plan:                    { type: DataTypes.STRING(10),  primaryKey: true },
  price:                   { type: DataTypes.STRING(20),  allowNull: false },
  campaign_price:          { type: DataTypes.STRING(30),  allowNull: true, defaultValue: null },
  campaign_duration_months:{ type: DataTypes.INTEGER,     allowNull: true, defaultValue: null },
  campaign_label:          { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
  campaign_promo_offer_id: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
}, {
  tableName: 'subscription_prices',
  timestamps: false,
  updatedAt: false,
});

module.exports = SubscriptionPrice;
