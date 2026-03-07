'use strict';

/**
 * Webhook event'lerinde kullanıcı araması için lookup key sütunu.
 * - iOS: Apple originalTransactionId (tüm yenilemeler boyunca sabit kalır)
 * - Android: Google purchaseToken (son aktif token saklanır)
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'subscription_lookup_key', {
      type: Sequelize.STRING(512),
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('users', 'subscription_lookup_key');
  },
};
