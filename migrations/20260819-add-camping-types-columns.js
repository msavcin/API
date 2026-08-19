'use strict';

/**
 * Migration: camping_types tablosuna eksik kolonları ekle
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      // Önce mevcut kolonları kontrol et
      const [columns] = await queryInterface.sequelize.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'camping_types'`,
        { transaction }
      );
      const existingColumns = columns.map(c => c.column_name);
      console.log('[Migration] Mevcut kolonlar:', existingColumns);

      // code kolonu ekle (unique)
      if (!existingColumns.includes('code')) {
        // Önce name'den otomatik code üret
        await queryInterface.addColumn('camping_types', 'code', {
          type: Sequelize.STRING(80),
          allowNull: true, // Önce null, sonra doldurup unique yapacağız
        }, { transaction });
        
        // Mevcut kayıtlar için name'den code üret
        await queryInterface.sequelize.query(
          `UPDATE camping_types SET code = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name, 'ğ', 'g'), 'ü', 'u'), 'ş', 's'), 'ı', 'i'), 'ö', 'o'), 'ç', 'c'))`,
          { transaction }
        );
        await queryInterface.sequelize.query(
          `UPDATE camping_types SET code = REGEXP_REPLACE(code, '[^a-z0-9]+', '_', 'g')`,
          { transaction }
        );
        await queryInterface.sequelize.query(
          `UPDATE camping_types SET code = TRIM(BOTH '_' FROM code)`,
          { transaction }
        );
        
        // Şimdi NOT NULL ve UNIQUE yap
        await queryInterface.changeColumn('camping_types', 'code', {
          type: Sequelize.STRING(80),
          allowNull: false,
          unique: true,
        }, { transaction });
        console.log('[Migration] code kolonu eklendi');
      }

      // svg kolonu ekle
      if (!existingColumns.includes('svg')) {
        await queryInterface.addColumn('camping_types', 'svg', {
          type: Sequelize.TEXT,
          allowNull: true,
        }, { transaction });
        console.log('[Migration] svg kolonu eklendi');
      }

      // color kolonu ekle
      if (!existingColumns.includes('color')) {
        await queryInterface.addColumn('camping_types', 'color', {
          type: Sequelize.STRING(20),
          allowNull: true,
          defaultValue: '#73768fff',
        }, { transaction });
        await queryInterface.sequelize.query(
          `UPDATE camping_types SET color = '#73768fff' WHERE color IS NULL`,
          { transaction }
        );
        console.log('[Migration] color kolonu eklendi');
      }

      // active kolonu ekle
      if (!existingColumns.includes('active')) {
        await queryInterface.addColumn('camping_types', 'active', {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        }, { transaction });
        console.log('[Migration] active kolonu eklendi');
      }

      // created_at kolonu ekle
      if (!existingColumns.includes('created_at')) {
        await queryInterface.addColumn('camping_types', 'created_at', {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        }, { transaction });
        console.log('[Migration] created_at kolonu eklendi');
      }

      // updated_at kolonu ekle
      if (!existingColumns.includes('updated_at')) {
        await queryInterface.addColumn('camping_types', 'updated_at', {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        }, { transaction });
        console.log('[Migration] updated_at kolonu eklendi');
      }

      // deleted_at kolonu ekle
      if (!existingColumns.includes('deleted_at')) {
        await queryInterface.addColumn('camping_types', 'deleted_at', {
          type: Sequelize.DATE,
          allowNull: true,
        }, { transaction });
        console.log('[Migration] deleted_at kolonu eklendi');
      }

      await transaction.commit();
      console.log('[Migration] Başarıyla tamamlandı');
    } catch (error) {
      await transaction.rollback();
      console.error('[Migration] Hata:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      await queryInterface.removeColumn('camping_types', 'code', { transaction });
      await queryInterface.removeColumn('camping_types', 'svg', { transaction });
      await queryInterface.removeColumn('camping_types', 'color', { transaction });
      await queryInterface.removeColumn('camping_types', 'active', { transaction });
      await queryInterface.removeColumn('camping_types', 'created_at', { transaction });
      await queryInterface.removeColumn('camping_types', 'updated_at', { transaction });
      await queryInterface.removeColumn('camping_types', 'deleted_at', { transaction });
      
      await transaction.commit();
      console.log('[Migration Rollback] Başarıyla tamamlandı');
    } catch (error) {
      await transaction.rollback();
      console.error('[Migration Rollback] Hata:', error);
      throw error;
    }
  }
};
