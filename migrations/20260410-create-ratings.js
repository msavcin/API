'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ratings', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      campground_id: { type: Sequelize.INTEGER, allowNull: false },
      user_id: { type: Sequelize.INTEGER, allowNull: true },
      anon_name: { type: Sequelize.STRING, allowNull: true },
      rating: { type: Sequelize.INTEGER, allowNull: false },
      comment: { type: Sequelize.TEXT, allowNull: true },
      hidden: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      moderator_note: { type: Sequelize.TEXT, allowNull: true },
      flagged: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      flag_reason: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ratings', ['campground_id']);
    await queryInterface.addIndex('ratings', ['user_id']);
  },

  down: async (queryInterface /* Sequelize */) => {
    await queryInterface.dropTable('ratings');
  }
};
