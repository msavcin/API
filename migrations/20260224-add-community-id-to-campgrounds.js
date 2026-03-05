'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // add community_id column to campgrounds table
    await queryInterface.addColumn('campgrounds', 'community_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
      comment: 'id of community when visibility is set to community'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('campgrounds', 'community_id');
  }
};
