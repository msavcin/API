"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('campgrounds', 'google_rating', {
      type: Sequelize.FLOAT,
      allowNull: true,
    });

    await queryInterface.addColumn('campgrounds', 'google_review_count', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  down: async (queryInterface /* Sequelize */) => {
    await queryInterface.removeColumn('campgrounds', 'google_rating');
    await queryInterface.removeColumn('campgrounds', 'google_review_count');
  }
};
