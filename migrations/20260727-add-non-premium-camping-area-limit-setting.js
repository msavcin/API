'use strict';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      INSERT INTO app_settings (key, value, description, created_at, updated_at)
      VALUES (
        'non_premium_camping_area_limit',
        '10',
        'Premium olmayan kullanıcıların ekleyebileceği maksimum kamp alanı sayısı',
        NOW(),
        NOW()
      )
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        description = EXCLUDED.description,
        updated_at = NOW();
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      DELETE FROM app_settings
      WHERE key = 'non_premium_camping_area_limit';
    `);
  }
};
