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
const StandardChecklist = db.StandardChecklist || require('../models/standardChecklist');
const StandardChecklistItem = db.StandardChecklistItem || require('../models/standardChecklistItem');

// GET /standard_checklists?season_id=summer&camping_type_id=caravan
exports.listStandardChecklists = async (req, res) => {
  const { season_id, camping_type_id } = req.query;
  console.log('GET /standard_checklists params:', { season_id, camping_type_id });
  const where = {};
  if (season_id) where.season_id = season_id;
  if (camping_type_id) where.camping_type_id = camping_type_id;
  console.log('Checklist sorgu where:', where);
  const checklists = await StandardChecklist.findAll({ where });
  console.log('Checklist sorgu sonucu:', checklists);
  res.json(checklists);
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
