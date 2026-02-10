'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'subscription_platform', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'ios or android'
    });

    await queryInterface.addColumn('users', 'subscription_product_id', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Product ID from App Store or Google Play'
    });

    await queryInterface.addColumn('users', 'subscription_transaction_id', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Transaction/Order ID'
    });

    await queryInterface.addColumn('users', 'subscription_expires_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Subscription expiration date'
    });

    await queryInterface.addColumn('users', 'subscription_is_active', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Whether subscription is currently active'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('users', 'subscription_platform');
    await queryInterface.removeColumn('users', 'subscription_product_id');
    await queryInterface.removeColumn('users', 'subscription_transaction_id');
    await queryInterface.removeColumn('users', 'subscription_expires_at');
    await queryInterface.removeColumn('users', 'subscription_is_active');
  }
};
