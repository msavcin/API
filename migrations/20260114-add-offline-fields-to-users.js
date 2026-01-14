"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'offline_enabled', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    });
    
    await queryInterface.addColumn('users', 'offline_radius_km', {
      type: Sequelize.INTEGER,
      defaultValue: 20,
      allowNull: false,
    });

    // Varsayılan değerleri set et
    await queryInterface.sequelize.query(`
      UPDATE users SET offline_enabled = true WHERE role IN ('superadmin');
    `);
    
    await queryInterface.sequelize.query(`
      UPDATE users SET offline_radius_km = 50 WHERE role = 'superadmin';
    `);
    
    await queryInterface.sequelize.query(`
      UPDATE users SET offline_radius_km = 20 WHERE role = 'user';
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('users', 'offline_enabled');
    await queryInterface.removeColumn('users', 'offline_radius_km');
  }
};
