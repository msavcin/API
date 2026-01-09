'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('ChecklstShares', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'active',
    });
    await queryInterface.addColumn('ChecklstShares', 'is_active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('ChecklstShares', 'revokedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('ChecklstShares', 'shared_by_user_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ChecklstShares', 'note', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('ChecklstShares', 'status');
    await queryInterface.removeColumn('ChecklstShares', 'is_active');
    await queryInterface.removeColumn('ChecklstShares', 'revokedAt');
    await queryInterface.removeColumn('ChecklstShares', 'shared_by_user_id');
    await queryInterface.removeColumn('ChecklstShares', 'note');
  }
};
