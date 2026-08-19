'use strict';

/**
 * Migration: Legacy camping type codes'larını canonical değerlere güncelle
 * tent -> campground
 * caravan -> caravan_site  
 * nature -> hiking_road
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      // Önce mevcut kayıtları kontrol et
      const [existingTypes] = await queryInterface.sequelize.query(
        `SELECT id, code FROM camping_types WHERE code IN ('tent', 'caravan', 'nature')`,
        { transaction }
      );

      console.log('[Migration] Mevcut legacy kayıtlar:', existingTypes);

      // Eğer yeni kayıtlar zaten varsa充突olmasın diye önce kontrol et
      const [newTypes] = await queryInterface.sequelize.query(
        `SELECT id, code FROM camping_types WHERE code IN ('campground', 'caravan_site', 'hiking_road')`,
        { transaction }
      );

      console.log('[Migration] Mevcut canonical kayıtlar:', newTypes);

      // Eğer hem eski hem yeni kayıtlar varsa, eski kayıtların ID'lerini yenilere migrate et
      if (existingTypes.length > 0 && newTypes.length > 0) {
        console.log('[Migration] Hem legacy hem canonical kayıtlar mevcut, standard_checklists güncelleniyor...');
        
        // tent -> campground ID mapping
        const tentRecord = existingTypes.find((t) => t.code === 'tent');
        const campgroundRecord = newTypes.find((t) => t.code === 'campground');
        if (tentRecord && campgroundRecord) {
          await queryInterface.sequelize.query(
            `UPDATE standard_checklists SET camping_type_id = :newId WHERE camping_type_id = :oldId`,
            { replacements: { oldId: tentRecord.id, newId: campgroundRecord.id }, transaction }
          );
          console.log(`[Migration] tent (${tentRecord.id}) -> campground (${campgroundRecord.id})`);
        }

        // caravan -> caravan_site ID mapping
        const caravanRecord = existingTypes.find((t) => t.code === 'caravan');
        const caravanSiteRecord = newTypes.find((t) => t.code === 'caravan_site');
        if (caravanRecord && caravanSiteRecord) {
          await queryInterface.sequelize.query(
            `UPDATE standard_checklists SET camping_type_id = :newId WHERE camping_type_id = :oldId`,
            { replacements: { oldId: caravanRecord.id, newId: caravanSiteRecord.id }, transaction }
          );
          console.log(`[Migration] caravan (${caravanRecord.id}) -> caravan_site (${caravanSiteRecord.id})`);
        }

        // nature -> hiking_road ID mapping
        const natureRecord = existingTypes.find((t) => t.code === 'nature');
        const hikingRoadRecord = newTypes.find((t) => t.code === 'hiking_road');
        if (natureRecord && hikingRoadRecord) {
          await queryInterface.sequelize.query(
            `UPDATE standard_checklists SET camping_type_id = :newId WHERE camping_type_id = :oldId`,
            { replacements: { oldId: natureRecord.id, newId: hikingRoadRecord.id }, transaction }
          );
          console.log(`[Migration] nature (${natureRecord.id}) -> hiking_road (${hikingRoadRecord.id})`);
        }

        // Legacy kayıtları soft-delete (active=false)
        await queryInterface.sequelize.query(
          `UPDATE camping_types SET active = false, deleted_at = NOW() WHERE code IN ('tent', 'caravan', 'nature')`,
          { transaction }
        );
        console.log('[Migration] Legacy kayıtlar pasifleştirildi');

      } else if (existingTypes.length > 0 && newTypes.length === 0) {
        // Sadece eski kayıtlar varsa, code'larını güncelle
        console.log('[Migration] Sadece legacy kayıtlar mevcut, code\'lar güncelleniyor...');
        
        await queryInterface.sequelize.query(
          `UPDATE camping_types SET code = 'campground', updated_at = NOW() WHERE code = 'tent'`,
          { transaction }
        );
        await queryInterface.sequelize.query(
          `UPDATE camping_types SET code = 'caravan_site', updated_at = NOW() WHERE code = 'caravan'`,
          { transaction }
        );
        await queryInterface.sequelize.query(
          `UPDATE camping_types SET code = 'hiking_road', updated_at = NOW() WHERE code = 'nature'`,
          { transaction }
        );
        console.log('[Migration] Legacy code\'lar canonical değerlere güncellendi');
      } else {
        console.log('[Migration] Güncelleme gerekmiyor');
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
    // Rollback için: canonical code'ları tekrar legacy'ye çevir
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      await queryInterface.sequelize.query(
        `UPDATE camping_types SET code = 'tent', updated_at = NOW() WHERE code = 'campground'`,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `UPDATE camping_types SET code = 'caravan', updated_at = NOW() WHERE code = 'caravan_site'`,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `UPDATE camping_types SET code = 'hiking_road', updated_at = NOW() WHERE code = 'nature'`,
        { transaction }
      );
      
      await transaction.commit();
      console.log('[Migration Rollback] Başarıyla tamamlandı');
    } catch (error) {
      await transaction.rollback();
      console.error('[Migration Rollback] Hata:', error);
      throw error;
    }
  }
};
