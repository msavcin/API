'use strict';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS trial_granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS feature_entitlements (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        feature_key TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        limit_value INTEGER,
        starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        reason TEXT,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (feature_key IN (
          'announcements',
          'checklist',
          'chat',
          'offline_mode',
          'camping_area_limit',
          'free_trial'
        )),
        CHECK (limit_value IS NULL OR limit_value >= 0)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uniq_feature_entitlements_global
      ON feature_entitlements (feature_key)
      WHERE user_id IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS uniq_feature_entitlements_user
      ON feature_entitlements (user_id, feature_key)
      WHERE user_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_feature_entitlements_user
      ON feature_entitlements (user_id, feature_key, expires_at);

      INSERT INTO feature_entitlements (user_id, feature_key, enabled, limit_value, reason, created_at, updated_at)
      VALUES
        (NULL, 'announcements', false, NULL, 'Global default: Duyurular erişimi', NOW(), NOW()),
        (NULL, 'checklist',     false, NULL, 'Global default: Checklist erişimi', NOW(), NOW()),
        (NULL, 'chat',          false, NULL, 'Global default: Sohbet premium özelliği', NOW(), NOW()),
        (NULL, 'offline_mode',  false, NULL, 'Global default: Offline mode premium özelliği', NOW(), NOW()),
        (NULL, 'camping_area_limit', true, 10, 'Global default: Premium olmayan kamp alanı ekleme limiti', NOW(), NOW()),
        (NULL, 'free_trial', true, 30, 'Global default: Yeni aboneler için ücretsiz deneme süresi gün', NOW(), NOW())
      ON CONFLICT DO NOTHING;
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS feature_entitlements;
      ALTER TABLE users
        DROP COLUMN IF EXISTS trial_started_at,
        DROP COLUMN IF EXISTS trial_expires_at,
        DROP COLUMN IF EXISTS trial_granted_by;
    `);
  }
};
