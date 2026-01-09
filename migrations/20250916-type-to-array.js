'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // type alanını ARRAY(DataTypes.STRING) olarak değiştir
    await queryInterface.changeColumn('campgrounds', 'type', {
      type: Sequelize.ARRAY(Sequelize.STRING),
      allowNull: true
    });

    // Mevcut verileri dönüştür: virgüllü stringleri ARRAY'e çevir
    // PostgreSQL'de doğrudan SQL ile
    await queryInterface.sequelize.query(`
      UPDATE campgrounds
      SET type = string_to_array(type, ',')
      WHERE type IS NOT NULL AND position(',' in type) > 0;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Geri al: ARRAY'den tekrar string'e çevir
    await queryInterface.changeColumn('campgrounds', 'type', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.sequelize.query(`
      UPDATE campgrounds
      SET type = array_to_string(type, ',')
      WHERE type IS NOT NULL;
    `);
  }
};
