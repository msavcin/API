'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      return queryInterface.addColumn('users', 'preferences', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
      });
    }
    if (dialect === 'sqlite') {
      // SQLite doesn't have JSONB; store as TEXT containing JSON
      return queryInterface.addColumn('users', 'preferences', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: '{}',
      });
    }
    // Fallback to JSON
    return queryInterface.addColumn('users', 'preferences', {
      type: Sequelize.JSON,
      allowNull: true,
      defaultValue: {},
    });
  },

  down: async (queryInterface /* , Sequelize */) => {
    return queryInterface.removeColumn('users', 'preferences');
  },
};
