const db = require('../models');
const { Op, QueryTypes } = require('sequelize');

const User = db.User || require('../models/user');
const sequelize = db.sequelize;

const FEATURE_DEFAULTS = {
  announcements: {
    enabled: false,
    description: 'Duyurular sekmesi erişimi',
  },
  checklist: {
    enabled: false,
    description: 'Checklist sekmesi erişimi',
  },
  chat: {
    enabled: false,
    description: 'Sohbet özelliği erişimi',
  },
  offline_mode: {
    enabled: false,
    description: 'Offline mode / çevrimdışı kullanım erişimi',
  },
  camping_area_limit: {
    enabled: true,
    limit_value: 10,
    description: 'Premium olmayan kullanıcı kamp alanı ekleme limiti',
  },
  free_trial: {
    enabled: true,
    limit_value: 30,
    description: 'Yeni aboneler için ücretsiz deneme süresi (gün)',
  },
};

function assertSuperadmin(req, res) {
  if (req.user?.role !== 'superadmin') {
    res.status(403).json({ error: 'Yetkisiz erişim' });
    return false;
  }
  return true;
}

function isActive(row) {
  if (!row) return false;
  const now = Date.now();
  const starts = row.starts_at ? new Date(row.starts_at).getTime() : null;
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : null;
  if (starts && starts > now) return false;
  if (expires && expires <= now) return false;
  return true;
}

function normalizeExpiresAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function upsertEntitlement({ userId = null, featureKey, enabled, limitValue = null, expiresAt = null, updatedBy = null }) {
  const normalizedLimit = normalizeLimit(limitValue);
  const normalizedExpires = normalizeExpiresAt(expiresAt);

  const existingRows = await sequelize.query(
    `SELECT id FROM feature_entitlements
     WHERE feature_key = :featureKey
       AND ((:userId IS NULL AND user_id IS NULL) OR user_id = :userId)
     LIMIT 1`,
    { replacements: { userId, featureKey }, type: QueryTypes.SELECT }
  );

  if (existingRows.length > 0) {
    const [row] = await sequelize.query(
      `UPDATE feature_entitlements
       SET enabled = :enabled,
           limit_value = :limitValue,
           starts_at = NOW(),
           expires_at = :expiresAt,
           updated_by = :updatedBy,
           updated_at = NOW()
       WHERE id = :id
       RETURNING *`,
      {
        replacements: {
          id: existingRows[0].id,
          enabled: !!enabled,
          limitValue: normalizedLimit,
          expiresAt: normalizedExpires,
          updatedBy,
        },
        type: QueryTypes.SELECT,
      }
    );
    return row;
  }

  const [row] = await sequelize.query(
    `INSERT INTO feature_entitlements
      (user_id, feature_key, enabled, limit_value, starts_at, expires_at, updated_by, created_at, updated_at)
     VALUES
      (:userId, :featureKey, :enabled, :limitValue, NOW(), :expiresAt, :updatedBy, NOW(), NOW())
     RETURNING *`,
    {
      replacements: {
        userId,
        featureKey,
        enabled: !!enabled,
        limitValue: normalizedLimit,
        expiresAt: normalizedExpires,
        updatedBy,
      },
      type: QueryTypes.SELECT,
    }
  );
  return row;
}

async function getRowsForUser(userId) {
  const rows = await sequelize.query(
    `SELECT * FROM feature_entitlements
     WHERE user_id IS NULL OR user_id = :userId
     ORDER BY user_id NULLS FIRST, feature_key ASC`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return rows;
}

function buildEffective(rows) {
  const globalRows = new Map();
  const userRows = new Map();

  for (const row of rows) {
    if (!isActive(row)) continue;
    if (row.user_id == null) globalRows.set(row.feature_key, row);
    else userRows.set(row.feature_key, row);
  }

  const result = {};
  for (const [featureKey, defaults] of Object.entries(FEATURE_DEFAULTS)) {
    const global = globalRows.get(featureKey);
    const user = userRows.get(featureKey);
    const source = user ? 'user' : global ? 'global' : 'default';
    const row = user || global || null;
    result[featureKey] = {
      featureKey,
      enabled: row ? !!row.enabled : !!defaults.enabled,
      limitValue: row && row.limit_value != null ? Number(row.limit_value) : (defaults.limit_value ?? null),
      expiresAt: row?.expires_at ?? null,
      source,
      description: defaults.description,
    };
  }
  return result;
}

async function revokeTrialForUser(user, updatedBy) {
  const userId = user.id;
  const now = new Date();
  const hasActivePaidSubscription = !!(
    user.subscription_is_active &&
    user.subscription_expires_at &&
    new Date(user.subscription_expires_at) > now
  );

  // Deneme paketinden gelen kişi bazlı tüm hakları kapat. Kişi bazlı false kayıt,
  // global true olsa bile bu kullanıcı için override olarak kapalı kalmasını sağlar.
  const revokeKeys = ['free_trial', 'offline_mode', 'chat', 'announcements', 'checklist'];
  for (const featureKey of revokeKeys) {
    await upsertEntitlement({
      userId,
      featureKey,
      enabled: false,
      limitValue: featureKey === 'free_trial' ? 30 : null,
      expiresAt: null,
      updatedBy,
    });
  }

  const nextUserFields = {
    trial_user: false,
    trial_started_at: null,
    trial_expires_at: null,
    trial_granted_by: null,
  };

  if (!hasActivePaidSubscription && user.role !== 'superadmin') {
    nextUserFields.role = 'guest';
    nextUserFields.offline_enabled = false;
    nextUserFields.subscription_is_active = false;
  }

  await user.update(nextUserFields);
}

exports.getMyEntitlements = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Token gerekli' });
    const rows = await getRowsForUser(req.user.id);
    return res.json({ entitlements: buildEffective(rows) });
  } catch (error) {
    console.error('[featureEntitlements] getMyEntitlements hata:', error);
    return res.status(500).json({ error: 'Haklar getirilemedi' });
  }
};

exports.listUsers = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const q = String(req.query.q || '').trim();
    const where = q
      ? {
          [Op.or]: [
            { name: { [Op.iLike]: `%${q}%` } },
            { username: { [Op.iLike]: `%${q}%` } },
            { email: { [Op.iLike]: `%${q}%` } },
          ],
        }
      : {};
    const users = await User.findAll({
      where,
      attributes: [
        'id', 'name', 'username', 'email', 'role', 'trial_user', 'offline_enabled',
        'subscription_is_active', 'subscription_expires_at', 'trial_started_at', 'trial_expires_at'
      ],
      order: [['id', 'DESC']],
      limit: 100,
    });
    return res.json({ users });
  } catch (error) {
    console.error('[featureEntitlements] listUsers hata:', error);
    return res.status(500).json({ error: 'Kullanıcılar getirilemedi' });
  }
};

exports.getEffectiveForUser = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Geçersiz userId' });
    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'username', 'email', 'role', 'trial_user', 'offline_enabled', 'trial_started_at', 'trial_expires_at']
    });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const rows = await getRowsForUser(userId);
    return res.json({ user, entitlements: buildEffective(rows), rows });
  } catch (error) {
    console.error('[featureEntitlements] getEffectiveForUser hata:', error);
    return res.status(500).json({ error: 'Haklar getirilemedi' });
  }
};

exports.getGlobal = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const rows = await sequelize.query(
      `SELECT * FROM feature_entitlements WHERE user_id IS NULL ORDER BY feature_key ASC`,
      { type: QueryTypes.SELECT }
    );
    return res.json({ entitlements: buildEffective(rows), rows, defaults: FEATURE_DEFAULTS });
  } catch (error) {
    console.error('[featureEntitlements] getGlobal hata:', error);
    return res.status(500).json({ error: 'Global haklar getirilemedi' });
  }
};

exports.updateGlobal = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const { features = {} } = req.body || {};
    const updated = [];
    for (const [featureKey, value] of Object.entries(features)) {
      if (!FEATURE_DEFAULTS[featureKey]) continue;
      updated.push(await upsertEntitlement({
        userId: null,
        featureKey,
        enabled: value.enabled,
        limitValue: value.limitValue,
        expiresAt: value.expiresAt,
        updatedBy: req.user.id,
      }));
    }
    const rows = await sequelize.query(
      `SELECT * FROM feature_entitlements WHERE user_id IS NULL ORDER BY feature_key ASC`,
      { type: QueryTypes.SELECT }
    );
    return res.json({ success: true, updated, entitlements: buildEffective(rows) });
  } catch (error) {
    console.error('[featureEntitlements] updateGlobal hata:', error);
    return res.status(500).json({ error: 'Global haklar güncellenemedi' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Geçersiz userId' });
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const { features = {} } = req.body || {};
    const updated = [];
    for (const [featureKey, value] of Object.entries(features)) {
      if (!FEATURE_DEFAULTS[featureKey]) continue;
      updated.push(await upsertEntitlement({
        userId,
        featureKey,
        enabled: value.enabled,
        limitValue: value.limitValue,
        expiresAt: value.expiresAt,
        updatedBy: req.user.id,
      }));
    }
    // Ücretsiz deneme kapatılırsa sadece gerçekten aktif denemesi olan kullanıcıda
    // role/premium state'ini ve deneme ile gelen kişi bazlı izinleri geri al.
    // Panel her kayıtta tüm feature'ları gönderdiği için trial_user=false olan kullanıcılarda
    // free_trial=false değerini revoke gibi yorumlamamalıyız; aksi halde kaydedilen
    // Duyurular/Checklist/Sohbet/Offline izinleri hemen tekrar false'a çekilir.
    if (features.free_trial && features.free_trial.enabled === false && user.trial_user === true) {
      await revokeTrialForUser(user, req.user.id);
    }

    const rows = await getRowsForUser(userId);
    const freshUser = await User.findByPk(userId, {
      attributes: ['id', 'name', 'username', 'email', 'role', 'trial_user', 'offline_enabled', 'trial_started_at', 'trial_expires_at']
    });
    return res.json({ success: true, updated, user: freshUser, entitlements: buildEffective(rows) });
  } catch (error) {
    console.error('[featureEntitlements] updateUser hata:', error);
    return res.status(500).json({ error: 'Kullanıcı hakları güncellenemedi' });
  }
};

exports.startTrial = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Geçersiz userId' });
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const rows = await getRowsForUser(userId);
    const effective = buildEffective(rows);
    const requestedDays = normalizeLimit(req.body?.days);
    const days = requestedDays ?? effective.free_trial?.limitValue ?? 30;
    const startsAt = new Date();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await upsertEntitlement({
      userId,
      featureKey: 'free_trial',
      enabled: true,
      limitValue: days,
      expiresAt,
      updatedBy: req.user.id,
    });
    await upsertEntitlement({
      userId,
      featureKey: 'offline_mode',
      enabled: true,
      expiresAt,
      updatedBy: req.user.id,
    });
    await upsertEntitlement({
      userId,
      featureKey: 'chat',
      enabled: true,
      expiresAt,
      updatedBy: req.user.id,
    });

    await user.update({
      trial_user: true,
      role: user.role === 'superadmin' ? user.role : 'user',
      offline_enabled: true,
      trial_started_at: startsAt,
      trial_expires_at: expiresAt,
      trial_granted_by: req.user.id,
    });

    return res.json({ success: true, user_id: userId, days, starts_at: startsAt, expires_at: expiresAt });
  } catch (error) {
    console.error('[featureEntitlements] startTrial hata:', error);
    return res.status(500).json({ error: 'Deneme süresi başlatılamadı' });
  }
};

exports.revokeTrial = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Geçersiz userId' });
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    await revokeTrialForUser(user, req.user.id);
    const rows = await getRowsForUser(userId);
    const freshUser = await User.findByPk(userId, {
      attributes: ['id', 'name', 'username', 'email', 'role', 'trial_user', 'offline_enabled', 'trial_started_at', 'trial_expires_at']
    });
    return res.json({ success: true, user: freshUser, entitlements: buildEffective(rows) });
  } catch (error) {
    console.error('[featureEntitlements] revokeTrial hata:', error);
    return res.status(500).json({ error: 'Deneme süresi kapatılamadı' });
  }
};

exports.clearUserFeature = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const userId = Number(req.params.userId);
    const { featureKey } = req.params;
    if (!Number.isFinite(userId) || !FEATURE_DEFAULTS[featureKey]) {
      return res.status(400).json({ error: 'Geçersiz parametre' });
    }
    await sequelize.query(
      `DELETE FROM feature_entitlements WHERE user_id = :userId AND feature_key = :featureKey`,
      { replacements: { userId, featureKey }, type: QueryTypes.DELETE }
    );
    const rows = await getRowsForUser(userId);
    return res.json({ success: true, entitlements: buildEffective(rows) });
  } catch (error) {
    console.error('[featureEntitlements] clearUserFeature hata:', error);
    return res.status(500).json({ error: 'Hak silinemedi' });
  }
};
