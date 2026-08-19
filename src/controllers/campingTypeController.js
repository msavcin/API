const db = require('../models');
const { Op, QueryTypes } = require('sequelize');
const CampingType = db.CampingType || require('../models/campingType');
const sequelize = db.sequelize;

const SVG_MAX_LENGTH = 120_000;

function assertSuperadmin(req, res) {
  if (req.user?.role !== 'superadmin') {
    res.status(403).json({ error: 'Yetkisiz erişim' });
    return false;
  }
  return true;
}

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function sanitizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) return null;
  return name;
}

function sanitizeColor(value) {
  const color = String(value || '').trim();
  if (!color) return '#73768fff';
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color) ? color : '#73768fff';
}

function sanitizeSvg(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('SVG içeriği zorunlu.');
    return null;
  }
  const svg = String(value).trim();
  if (!svg) {
    if (required) throw new Error('SVG içeriği zorunlu.');
    return null;
  }
  if (svg.length > SVG_MAX_LENGTH) {
    throw new Error(`SVG çok büyük. En fazla ${SVG_MAX_LENGTH} karakter olmalı.`);
  }
  if (!/^<svg[\s>]/i.test(svg)) {
    throw new Error('SVG içeriği <svg> etiketi ile başlamalı.');
  }
  const forbidden = [
    /<\s*script\b/i,
    /<\s*foreignObject\b/i,
    /<\s*iframe\b/i,
    /<\s*object\b/i,
    /<\s*embed\b/i,
    /<\s*link\b/i,
    /\son[a-z]+\s*=/i,
    /javascript\s*:/i,
    /xlink:href\s*=\s*["']\s*https?:/i,
    /href\s*=\s*["']\s*https?:/i,
    /data:text\/html/i,
  ];
  if (forbidden.some((rule) => rule.test(svg))) {
    throw new Error('Güvenlik nedeniyle bu SVG içeriği kabul edilmedi. Script/event/external resource kullanmayın.');
  }
  return svg;
}

function getBaseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

function normalizeType(row, req) {
  if (!row) return null;
  const plain = typeof row.get === 'function' ? row.get({ plain: true }) : row;
  const code = plain.code || normalizeCode(plain.name || plain.id);
  const baseUrl = req ? getBaseUrl(req) : '';
  return {
    id: plain.id,
    code,
    name: plain.name,
    label: plain.name,
    svg: plain.svg || null,
    iconSvg: plain.svg || null,
    icon_url: baseUrl && code ? `${baseUrl}/node/camping_types/${encodeURIComponent(code)}/icon.svg` : null,
    color: plain.color || '#73768fff',
    sort_order: Number(plain.sort_order || 0),
    active: plain.active !== false,
    created_at: plain.created_at || null,
    updated_at: plain.updated_at || null,
    deleted_at: plain.deleted_at || null,
  };
}

async function findByIdOrCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const id = Number(raw);
  if (Number.isInteger(id) && id > 0) {
    return CampingType.findByPk(id);
  }
  return CampingType.findOne({ where: { code: normalizeCode(raw) } });
}

async function countUsage(type) {
  const code = String(type.code);
  const idText = String(type.id);
  const [campgroundRow] = await sequelize.query(
    `SELECT COUNT(*)::int AS count
     FROM campgrounds
     WHERE COALESCE(deleted, 0) = 0
       AND (
         type = :code
         OR (tags IS NOT NULL AND tags <> '' AND (tags LIKE :tagCompact OR tags LIKE :tagSpaced))
       )`,
    {
      replacements: {
        code,
        tagCompact: `%"type":"${code}"%`,
        tagSpaced: `%"type": "${code}"%`,
      },
      type: QueryTypes.SELECT,
    }
  );

  let checklistCount = 0;
  try {
    const [checklistRow] = await sequelize.query(
      `SELECT COUNT(*)::int AS count
       FROM standard_checklists
       WHERE camping_type_id::text IN (:idText, :code)`,
      { replacements: { idText, code }, type: QueryTypes.SELECT }
    );
    checklistCount = Number(checklistRow?.count || 0);
  } catch (error) {
    // standard_checklists tablosu bazı kurulumlarda olmayabilir; kamp türü silmeyi engellemesin.
    checklistCount = 0;
  }

  return {
    campgrounds: Number(campgroundRow?.count || 0),
    standard_checklists: checklistCount,
  };
}

// GET /node/camping_types
exports.listCampingTypes = async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const where = includeInactive ? {} : { active: true, deleted_at: null };

    if (includeInactive && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }

    const types = await CampingType.findAll({
      where,
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });
    res.json(types.map((row) => normalizeType(row, req)));
  } catch (error) {
    console.error('[campingTypes] list hata:', error);
    res.status(500).json({ error: 'Kamp türleri getirilemedi' });
  }
};

// GET /node/camping_types/admin
exports.listAdminCampingTypes = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const types = await CampingType.findAll({
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });
    res.json(types.map((row) => normalizeType(row, req)));
  } catch (error) {
    console.error('[campingTypes] admin list hata:', error);
    res.status(500).json({ error: 'Kamp türleri getirilemedi' });
  }
};

// GET /node/camping_types/sync?updated_after=ISO
exports.syncCampingTypes = async (req, res) => {
  try {
    const updatedAfter = req.query.updated_after ? new Date(String(req.query.updated_after)) : null;
    const where = updatedAfter && !Number.isNaN(updatedAfter.getTime())
      ? { updated_at: { [Op.gt]: updatedAfter } }
      : { active: true, deleted_at: null };

    const types = await CampingType.findAll({
      where,
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });

    res.json({
      serverTime: new Date().toISOString(),
      campingTypes: types.map((row) => normalizeType(row, req)),
    });
  } catch (error) {
    console.error('[campingTypes] sync hata:', error);
    res.status(500).json({ error: 'Kamp türleri eşitlenemedi' });
  }
};

// GET /node/camping_types/:code/icon.svg
exports.getCampingTypeIcon = async (req, res) => {
  try {
    const type = await findByIdOrCode(req.params.code);
    if (!type || !type.svg || type.active === false || type.deleted_at) {
      return res.status(404).send('SVG bulunamadı');
    }
    res.set({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    });
    return res.send(type.svg);
  } catch (error) {
    console.error('[campingTypes] icon hata:', error);
    return res.status(500).send('SVG getirilemedi');
  }
};

// POST /node/camping_types/admin
exports.createCampingType = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;

    const name = sanitizeName(req.body?.name);
    const code = normalizeCode(req.body?.code || name);
    if (!name) return res.status(400).json({ error: 'Kamp türü adı zorunlu ve 120 karakterden kısa olmalı.' });
    if (!code || code.length < 2) return res.status(400).json({ error: 'Geçerli bir kod zorunlu. Örn: glamping' });

    let svg;
    try {
      svg = sanitizeSvg(req.body?.svg, { required: true });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const existing = await CampingType.findOne({ where: { code } });
    if (existing) return res.status(409).json({ error: 'Bu kodla kamp türü zaten var.', existing: normalizeType(existing, req) });

    const maxSort = await CampingType.max('sort_order').catch(() => 0);
    const sortOrder = Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : Number(maxSort || 0) + 10;

    const type = await CampingType.create({
      code,
      name,
      svg,
      color: sanitizeColor(req.body?.color),
      sort_order: sortOrder,
      active: req.body?.active === undefined ? true : !!req.body.active,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    return res.status(201).json({ success: true, campingType: normalizeType(type, req) });
  } catch (error) {
    console.error('[campingTypes] create hata:', error);
    return res.status(500).json({ error: 'Kamp türü oluşturulamadı' });
  }
};

// PUT /node/camping_types/admin/:idOrCode
exports.updateCampingType = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const type = await findByIdOrCode(req.params.idOrCode);
    if (!type) return res.status(404).json({ error: 'Kamp türü bulunamadı' });

    const patch = { updated_at: new Date() };
    if (req.body?.name !== undefined) {
      const name = sanitizeName(req.body.name);
      if (!name) return res.status(400).json({ error: 'Kamp türü adı zorunlu ve 120 karakterden kısa olmalı.' });
      patch.name = name;
    }
    if (req.body?.svg !== undefined) {
      try {
        patch.svg = sanitizeSvg(req.body.svg, { required: true });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }
    if (req.body?.color !== undefined) patch.color = sanitizeColor(req.body.color);
    if (req.body?.sort_order !== undefined) {
      const sortOrder = Number(req.body.sort_order);
      if (!Number.isFinite(sortOrder)) return res.status(400).json({ error: 'Sıra değeri sayı olmalı.' });
      patch.sort_order = sortOrder;
    }
    if (req.body?.active !== undefined) {
      patch.active = !!req.body.active;
      patch.deleted_at = patch.active ? null : (type.deleted_at || new Date());
    }

    await type.update(patch);
    return res.json({ success: true, campingType: normalizeType(type, req) });
  } catch (error) {
    console.error('[campingTypes] update hata:', error);
    return res.status(500).json({ error: 'Kamp türü güncellenemedi' });
  }
};

// DELETE /node/camping_types/admin/:idOrCode?force=true
exports.deleteCampingType = async (req, res) => {
  try {
    if (!assertSuperadmin(req, res)) return;
    const type = await findByIdOrCode(req.params.idOrCode);
    if (!type) return res.status(404).json({ error: 'Kamp türü bulunamadı' });

    const usage = await countUsage(type);
    const inUse = usage.campgrounds > 0 || usage.standard_checklists > 0;
    const force = req.query.force === 'true' || req.body?.force === true;
    if (inUse && !force) {
      return res.status(409).json({
        error: 'Bu kamp türü kullanılıyor. Önce bağlı kayıtları taşıyın veya force=true ile pasifleştirin.',
        usage,
        campingType: normalizeType(type, req),
      });
    }

    await type.update({ active: false, deleted_at: new Date(), updated_at: new Date() });
    return res.json({ success: true, usage, campingType: normalizeType(type, req) });
  } catch (error) {
    console.error('[campingTypes] delete hata:', error);
    return res.status(500).json({ error: 'Kamp türü kaldırılamadı' });
  }
};
