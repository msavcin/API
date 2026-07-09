'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Admin settings için varsayılan değerleri ekle
    await queryInterface.bulkInsert('app_settings', [
      {
        key: 'ai_review_daily_limit',
        value: '100',
        description: 'Günlük maksimum AI değerlendirme sayısı',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'ai_review_enabled_global',
        value: 'true',
        description: 'Sistem genelinde AI değerlendirmesi aktif mi',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'ai_review_show_in_ui',
        value: 'true',
        description: 'UI\'da AI değerlendirmesi gösterilsin mi',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ], {
      ignoreDuplicates: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('app_settings', {
      key: {
        [Sequelize.Op.in]: [
          'ai_review_daily_limit',
          'ai_review_enabled_global',
          'ai_review_show_in_ui',
        ],
      },
    }, {});
  }
};
