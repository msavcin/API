// DELETE /custom_checklists/:id
exports.deleteCustomChecklist = async (req, res) => {
  const { id } = req.params;
  try {
    const checklist = await CustomChecklist.findByPk(id);
    if (!checklist) return res.status(404).json({ error: 'Checklist bulunamadı.' });
    // Önce checklist_shares tablosunda ilgili kayıtları sil
    const { ChecklstShare } = require('../models');
    await ChecklstShare.destroy({ where: { checklist_id: id } });
    // Sonra checklist'i sil
    await checklist.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('CustomChecklist silme hatası:', err);
    res.status(500).json({ error: 'Checklist silinemedi', detail: err.message });
  }
};
// PATCH /custom_checklists/items/:id
exports.updateCustomChecklistItem = async (req, res) => {
  const { id } = req.params;
  const { item_name, category } = req.body;
  try {
    const item = await CustomChecklistItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Item bulunamadı.' });
    if (item_name !== undefined) item.item_name = item_name;
    if (category !== undefined) item.category = category;
    await item.save();
    res.json(item);
  } catch (err) {
    console.error('CustomChecklistItem güncelleme hatası:', err);
    res.status(500).json({ error: 'Checklist item güncellenemedi', detail: err.message });
  }
};
const db = require('../models');
const CustomChecklist = db.CustomChecklist || require('../models/customChecklist');
const CustomChecklistItem = db.CustomChecklistItem || require('../models/customChecklistItem');

// POST /custom_checklists
exports.createCustomChecklist = async (req, res) => {
  const { name, is_shared, user_id } = req.body;
  if (!name || !user_id) {
    return res.status(400).json({ error: 'name ve user_id gerekli.' });
  }
  try {
    const checklist = await CustomChecklist.create({ name, is_shared, user_id });
    res.json(checklist);
  } catch (err) {
    console.error('CustomChecklist oluşturma hatası:', err);
    res.status(500).json({ error: 'Checklist oluşturulamadı', detail: err.message });
  }
};
// GET /custom_checklists?user_id=...
exports.listCustomChecklists = async (req, res) => {
  let { user_id } = req.query;
  
  // user_id doğrulama ve temizleme
  if (user_id === 'undefined' || user_id === undefined || user_id === null || user_id === '') {
    // Eğer user_id geçersizse, JWT'den gelen kullanıcı ID'sini kullan
    user_id = req.user?.id;
  } else {
    // Geçerli bir user_id varsa integer'a çevir
    user_id = parseInt(user_id, 10);
    if (isNaN(user_id)) {
      return res.status(400).json({ error: 'Geçersiz user_id parametresi' });
    }
  }
  
  const where = {};
  if (user_id) where.user_id = user_id;
  
  console.log('GET /custom_checklists params:', { user_id });
  console.log('Checklist sorgu where:', where);
  const checklists = await CustomChecklist.findAll({ where });
  console.log('Checklist sorgu sonucu:', checklists);
  console.log('Frontend response:', JSON.stringify(checklists, null, 2));
  res.json(checklists);
};

// GET /custom_checklists/items?checklist_id=...
exports.listCustomChecklistItems = async (req, res) => {
  const { checklist_id } = req.query;
  console.log('Custom checklist items GET url:', req.originalUrl);
  if (!checklist_id) return res.status(400).json({ error: 'checklist_id gerekli' });
  const items = await CustomChecklistItem.findAll({ where: { checklist_id } });
  console.log('Custom checklist items yanıtı:', JSON.stringify(items, null, 2));
  res.json(items);
};

// POST /custom_checklists
exports.createCustomChecklist = async (req, res) => {
  const { name, is_shared, user_id } = req.body;
  if (!name || !user_id) return res.status(400).json({ error: 'name ve user_id zorunlu' });
  try {
    const user = await db.User.findByPk(user_id);
    console.log('Checklist oluşturulurken user_id:', user_id, 'Kullanıcı:', user);
    if (!user) {
      return res.status(400).json({ error: 'Kullanıcı bulunamadı', user_id });
    }
    const checklist = await CustomChecklist.create({ name, is_shared, user_id });
    res.status(201).json(checklist);
  } catch (err) {
    console.error('Checklist oluşturma hatası:', err);
    res.status(500).json({ error: 'Checklist oluşturulamadı', detail: err.message });
  }
};

// POST /custom_checklist_items
exports.createCustomChecklistItem = async (req, res) => {
  const { checklist_id, item_name } = req.body;
  if (!checklist_id || !item_name) return res.status(400).json({ error: 'checklist_id ve item_name zorunlu' });
  const item = await CustomChecklistItem.create({ checklist_id, item_name });
  res.status(201).json(item);
};

// PATCH /custom_checklists/:id
exports.updateCustomChecklist = async (req, res) => {
  const { id } = req.params;
  const { name, is_shared } = req.body;
  const checklist = await CustomChecklist.findByPk(id);
  if (!checklist) return res.status(404).json({ error: 'Checklist bulunamadı' });
  await checklist.update({ name, is_shared });
  res.json(checklist);
};

// DELETE /custom_checklist_items/:id
exports.deleteCustomChecklistItem = async (req, res) => {
  const { id } = req.params;
  const item = await CustomChecklistItem.findByPk(id);
  if (!item) return res.status(404).json({ error: 'Item bulunamadı' });
  await item.destroy();
  res.json({ message: 'Item silindi' });
};
