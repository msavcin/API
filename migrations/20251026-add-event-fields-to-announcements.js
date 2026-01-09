module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('announcements', 'etkinlik_turu', { type: Sequelize.STRING });
    await queryInterface.addColumn('announcements', 'zorluk_seviyesi', { type: Sequelize.STRING });
    await queryInterface.addColumn('announcements', 'etkinlik_tarihi', { type: Sequelize.DATE });
    await queryInterface.addColumn('announcements', 'etkinlik_suresi', { type: Sequelize.STRING });
    await queryInterface.addColumn('announcements', 'etkinlik_yeri', { type: Sequelize.STRING });
    await queryInterface.addColumn('announcements', 'etkinlik_yeri_id', { type: Sequelize.INTEGER });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('announcements', 'etkinlik_turu');
    await queryInterface.removeColumn('announcements', 'zorluk_seviyesi');
    await queryInterface.removeColumn('announcements', 'etkinlik_tarihi');
    await queryInterface.removeColumn('announcements', 'etkinlik_suresi');
    await queryInterface.removeColumn('announcements', 'etkinlik_yeri');
    await queryInterface.removeColumn('announcements', 'etkinlik_yeri_id');
  }
};
