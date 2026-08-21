// POST /standard_checklists (sadece superadmin)
exports.createStandardChecklist = async (req, res) => {
  const user = req.user;
  if (!user || user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sadece superadmin ekleyebilir.' });
  }
  const { season_id, camping_type_id, name } = req.body;
  if (!season_id || !camping_type_id || !name) {
    return res.status(400).json({ error: 'season_id, camping_type_id ve name gerekli.' });
  }
  try {
    const checklist = await StandardChecklist.create({ season_id, camping_type_id, name });
    res.json(checklist);
  } catch (err) {
    console.error('StandardChecklist ekleme hatası:', err);
    res.status(500).json({ error: 'Checklist eklenemedi', detail: err.message });
  }
};
// PUT /standard_checklists/items/:id (sadece superadmin)
exports.updateStandardChecklistItem = async (req, res) => {
  const user = req.user;
  if (!user || user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sadece superadmin güncelleyebilir.' });
  }
  const { id } = req.params;
  const { category, item_name, checklist_id } = req.body;
  try {
    const item = await StandardChecklistItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Item bulunamadı.' });
    if (category !== undefined) item.category = category;
    if (item_name !== undefined) item.item_name = item_name;
    if (checklist_id !== undefined) item.checklist_id = checklist_id;
    await item.save();
    res.json(item);
  } catch (err) {
    console.error('StandardChecklistItem güncelleme hatası:', err);
    res.status(500).json({ error: 'Checklist item güncellenemedi', detail: err.message });
  }
};
// POST /standard_checklist_items (sadece superadmin)
exports.createStandardChecklistItem = async (req, res) => {
  const user = req.user;
  console.log('createStandardChecklistItem user:', user);
  if (!user || user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sadece superadmin ekleyebilir.' });
  }
  const { checklist_id, item_name, category } = req.body;
  if (!checklist_id || !item_name) {
    return res.status(400).json({ error: 'checklist_id ve item_name gerekli.' });
  }
  try {
    const item = await StandardChecklistItem.create({ checklist_id, item_name, category });
    res.json(item);
  } catch (err) {
    console.error('StandardChecklistItem ekleme hatası:', err);
    res.status(500).json({ error: 'Checklist item eklenemedi', detail: err.message });
  }
};

// DELETE /standard_checklist_items/:id (sadece superadmin)
exports.deleteStandardChecklistItem = async (req, res) => {
  const user = req.user;
  if (!user || user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Sadece superadmin silebilir.' });
  }
  const { id } = req.params;
  const deleted = await StandardChecklistItem.destroy({ where: { id } });
  if (deleted) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Item bulunamadı.' });
  }
};
const db = require('../models');
const { Op } = require('sequelize');
const StandardChecklist = db.StandardChecklist || require('../models/standardChecklist');
const StandardChecklistItem = db.StandardChecklistItem || require('../models/standardChecklistItem');
const CampingType = db.CampingType || require('../models/campingType');

const CAMPING_TYPE_ALIAS_GROUPS = [
  ['campground', 'tent', 'legacy_1', '1'],
  ['caravan_site', 'caravan', 'legacy_2', '2'],
  ['hiking_road', 'nature', 'legacy_3', '3'],
];

function aliasGroupFor(value) {
  const key = String(value == null ? '' : value).trim().toLowerCase();
  if (!key) return [];
  const group = CAMPING_TYPE_ALIAS_GROUPS.find((g) => g.includes(key));
  return group ? [...group] : [key];
}

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** PG integer kolonu: yalnızca sayısal id döner (campground/tent string'i IN'e girmez). */
async function resolveCampingTypeIds(rawValue) {
  const seed = String(rawValue == null ? '' : rawValue).trim();
  if (!seed) return [];

  const codes = new Set(aliasGroupFor(seed));
  codes.add(seed);
  const ids = new Set();
  const seedId = toPositiveInt(seed);
  if (seedId) ids.add(seedId);
  for (const token of codes) {
    const n = toPositiveInt(token);
    if (n) ids.add(n);
  }

  try {
    const or = [];
    const codeList = [...codes].filter((c) => !toPositiveInt(c));
    if (codeList.length) or.push({ code: { [Op.in]: codeList } });
    if (ids.size) or.push({ id: { [Op.in]: [...ids] } });
    if (!or.length) return [...ids];

    const rows = await CampingType.findAll({ where: { [Op.or]: or } });
    const extraCodes = new Set();
    for (const row of rows) {
      ids.add(Number(row.id));
      if (row.code) aliasGroupFor(row.code).forEach((t) => extraCodes.add(t));
    }
    const moreCodes = [...extraCodes].filter((c) => !toPositiveInt(c));
    if (moreCodes.length) {
      const more = await CampingType.findAll({ where: { code: { [Op.in]: moreCodes } } });
      for (const row of more) ids.add(Number(row.id));
    }
  } catch (err) {
    console.warn('[standard_checklists] camping type alias çözümleme atlandı:', err.message);
  }

  return [...ids];
}

// GET /standard_checklists?season_id=2&camping_type_id=100
exports.listStandardChecklists = async (req, res) => {
  try {
    const { season_id, camping_type_id } = req.query;
    console.log('GET /standard_checklists params:', { season_id, camping_type_id });
    const where = {};
    if (season_id) {
      const seasonInt = toPositiveInt(season_id);
      where.season_id = seasonInt != null ? seasonInt : season_id;
    }
    if (camping_type_id) {
      const ids = await resolveCampingTypeIds(camping_type_id);
      if (!ids.length) {
        const fallback = toPositiveInt(camping_type_id);
        if (fallback == null) return res.json([]);
        where.camping_type_id = fallback;
      } else {
        where.camping_type_id = ids.length === 1 ? ids[0] : { [Op.in]: ids };
      }
    }
    console.log('Checklist sorgu where:', JSON.stringify(where));
    const checklists = await StandardChecklist.findAll({ where });
    console.log('Checklist sorgu sonucu:', checklists.length);
    res.json(checklists);
  } catch (err) {
    console.error('listStandardChecklists hata:', err);
    res.status(500).json({ error: 'Checklist listelenemedi', detail: err.message });
  }
};

// GET /standard_checklist_items?checklist_id=...
exports.listStandardChecklistItems = async (req, res) => {
  const { checklist_id } = req.query;
  console.log('GET /standard_checklists/items checklist_id:', checklist_id);
  if (!checklist_id) return res.status(400).json({ error: 'checklist_id gerekli' });
  const items = await StandardChecklistItem.findAll({ where: { checklist_id } });
  console.log('Checklist items sorgu sonucu:', items);
  res.json(items);
};