'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Geçici alan oluştur
    await queryInterface.addColumn('campgrounds', 'type_array', {
      type: Sequelize.ARRAY(Sequelize.STRING),
      allowNull: true
    });
    // 2. Mevcut verileri dönüştür
    await queryInterface.sequelize.query(`
      UPDATE campgrounds
      SET type_array = string_to_array(type, ',')
      WHERE type IS NOT NULL AND position(',' in type) > 0;
      UPDATE campgrounds
      SET type_array = ARRAY[type]
      WHERE type IS NOT NULL AND position(',' in type) = 0;
    `);
    // 3. Eski type alanını kaldır
    await queryInterface.removeColumn('campgrounds', 'type');
    // 4. Yeni alanı type olarak yeniden adlandır
    await queryInterface.renameColumn('campgrounds', 'type_array', 'type');
  },

  down: async (queryInterface, Sequelize) => {
    // Geri al: type alanını tekrar string'e çevir
    await queryInterface.addColumn('campgrounds', 'type_string', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.sequelize.query(`
      UPDATE campgrounds
      SET type_string = array_to_string(type, ',')
      WHERE type IS NOT NULL;
    `);
    await queryInterface.removeColumn('campgrounds', 'type');
    await queryInterface.renameColumn('campgrounds', 'type_string', 'type');
  }
};
