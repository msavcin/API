'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('campgrounds', 'ai_review_evaluation', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('campgrounds', 'ai_review_generated_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('campgrounds', 'ai_review_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: true,
    });

    await queryInterface.addColumn('campgrounds', 'google_place_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('campgrounds', 'last_google_sync_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface /* Sequelize */) => {
    await queryInterface.removeColumn('campgrounds', 'ai_review_evaluation');
    await queryInterface.removeColumn('campgrounds', 'ai_review_generated_at');
    await queryInterface.removeColumn('campgrounds', 'ai_review_enabled');
    await queryInterface.removeColumn('campgrounds', 'google_place_id');
    await queryInterface.removeColumn('campgrounds', 'last_google_sync_at');
  }
};
