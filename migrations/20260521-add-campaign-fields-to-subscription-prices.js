'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('subscription_prices', 'campaign_price', {
      type: Sequelize.STRING(30),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('subscription_prices', 'campaign_duration_months', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('subscription_prices', 'campaign_label', {
      type: Sequelize.STRING(100),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('subscription_prices', 'campaign_promo_offer_id', {
      type: Sequelize.STRING(100),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('subscription_prices', 'campaign_promo_offer_id');
    await queryInterface.removeColumn('subscription_prices', 'campaign_price');
    await queryInterface.removeColumn('subscription_prices', 'campaign_duration_months');
    await queryInterface.removeColumn('subscription_prices', 'campaign_label');
  },
};
