'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('friendships', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: { type: Sequelize.INTEGER, allowNull: false },
      friend_id: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.ENUM('pending', 'accepted', 'blocked', 'rejected'), allowNull: false, defaultValue: 'pending' },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW }
    });
    await queryInterface.addIndex('friendships', ['user_id']);
    await queryInterface.addIndex('friendships', ['friend_id']);
    await queryInterface.addIndex('friendships', ['status']);
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('friendships');
  }
};
