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
      {
        key: 'non_premium_camping_area_limit',
        value: '10',
        description: 'Premium olmayan kullanıcıların ekleyebileceği maksimum kamp alanı sayısı',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'app_latest_version',
        value: '',
        description: 'Mobil uygulama için yayınlanan son sürüm',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'app_min_supported_version',
        value: '',
        description: 'Zorunlu güncelleme için minimum desteklenen sürüm',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'app_update_required',
        value: 'false',
        description: 'Yeni sürüm güncellemesi zorunlu mu',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'app_update_message',
        value: 'Kamp Defterim\'in yeni bir sürümü hazır. Daha iyi performans ve yeni özellikler için güncelleyin.',
        description: 'Yeni sürüm bildirimi mesajı',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'app_update_android_url',
        value: 'https://play.google.com/store/apps/details?id=com.spondylus.boltexponativewind',
        description: 'Android güncelleme mağaza bağlantısı',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'app_update_ios_url',
        value: 'https://apps.apple.com/tr/app/kamp-defterim/id6759046939?l=tr',
        description: 'iOS güncelleme mağaza bağlantısı',
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
          'non_premium_camping_area_limit',
          'app_latest_version',
          'app_min_supported_version',
          'app_update_required',
          'app_update_message',
          'app_update_android_url',
          'app_update_ios_url',
        ],
      },
    }, {});
  }
};
