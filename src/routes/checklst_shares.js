const express = require('express');
const router = express.Router();
const db = require('../models');


// GET /checklst_shares?shared_by_user_id=...
router.get('/', async (req, res) => {
  const { shared_by_user_id, checklist_id, status } = req.query;
  if (!shared_by_user_id) return res.status(400).json({ error: 'shared_by_user_id gerekli.' });
  try {
    const CustomChecklist = require('../models/customChecklist');
    const User = require('../models/user');
    const where = { shared_by_user_id };
    if (checklist_id) where.checklist_id = checklist_id;
    if (status) where.status = status;
    const shares = await db.ChecklstShare.findAll({
      where,
      include: [{
        model: CustomChecklist,
        as: 'custom_checklist',
        attributes: ['name', 'user_id'],
        required: false,
        foreignKey: 'checklist_id',
        include: [{
          model: User,
          as: 'owner',
          attributes: ['id', 'name', 'email', 'username'],
          required: false,
          foreignKey: 'user_id',
        }]
      }]
    });
    const result = shares.map(share => ({
      id: share.id,
      checklist_id: share.checklist_id,
      shared_with_user_id: share.shared_with_user_id,
      shared_by_user_id: share.shared_by_user_id,
      status: share.status,
      is_active: share.is_active,
      revokedAt: share.revokedAt,
      note: share.note,
      name: share.custom_checklist ? share.custom_checklist.name : '',
      owner: share.custom_checklist && share.custom_checklist.owner ? {
        id: share.custom_checklist.owner.id,
        name: share.custom_checklist.owner.name,
        email: share.custom_checklist.owner.email,
        username: share.custom_checklist.owner.username
      } : null
    }));
    res.json(result);
  } catch (err) {
    console.error('Kullanıcının paylaştığı checklistler hatası:', err);
    res.status(500).json({ error: 'Kullanıcının paylaştığı checklistler alınamadı', detail: err.message });
  }
});


// PATCH /checklst_shares/:id
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { status, is_active, revokedAt, note, shared_by_user_id } = req.body;
  try {
    const share = await db.ChecklstShare.findByPk(id);
    if (!share) return res.status(404).json({ error: 'Paylaşım bulunamadı.' });
    if (status !== undefined) share.status = status;
    if (is_active !== undefined) share.is_active = is_active;
    if (revokedAt !== undefined) share.revokedAt = revokedAt;
    if (note !== undefined) share.note = note;
    if (shared_by_user_id !== undefined) share.shared_by_user_id = shared_by_user_id;
    if (status === 'revoked') {
      share.is_active = false;
      share.revokedAt = new Date();
    }
    await share.save();
    res.json(share);
  } catch (err) {
    console.error('Checklist paylaşım güncelleme hatası:', err);
    res.status(500).json({ error: 'Paylaşım güncellenemedi', detail: err.message });
  }
});

// POST /checklst_shares
router.post('/', async (req, res) => {
  const { checklist_id, shared_with_user_id, shared_by_user_id, status, note } = req.body;
  console.log('POST /checklst_shares payload:', req.body);
  if (!checklist_id || !shared_with_user_id) {
    return res.status(400).json({ error: 'checklist_id ve shared_with_user_id gerekli.' });
  }
  try {
    let userIds = shared_with_user_id;
    if (typeof userIds === 'string') {
      userIds = userIds.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
    }
    const shareFields = (uid) => ({
      checklist_id,
      shared_with_user_id: uid,
      shared_by_user_id: shared_by_user_id || null,
      status: status || 'active',
      is_active: status ? status === 'active' : true,
      note: note || null
    });
    if (Array.isArray(userIds)) {
      const shares = [];
      for (const uid of userIds) {
        const share = await db.ChecklstShare.create(shareFields(uid));
        shares.push(share);
      }
      console.log('Veritabanına yazılan paylaşımlar:', shares);
      res.status(201).json(shares.map(share => ({
        id: share.id,
        checklist_id: share.checklist_id,
        shared_with_user_id: share.shared_with_user_id,
        shared_by_user_id: share.shared_by_user_id,
        status: share.status,
        is_active: share.is_active,
        revokedAt: share.revokedAt,
        note: share.note,
        createdAt: share.createdAt,
        updatedAt: share.updatedAt
      })));
    } else {
      const share = await db.ChecklstShare.create(shareFields(userIds));
      console.log('Veritabanına yazılan paylaşım:', share);
      res.status(201).json({
        id: share.id,
        checklist_id: share.checklist_id,
        shared_with_user_id: share.shared_with_user_id,
        shared_by_user_id: share.shared_by_user_id,
        status: share.status,
        is_active: share.is_active,
        revokedAt: share.revokedAt,
        note: share.note,
        createdAt: share.createdAt,
        updatedAt: share.updatedAt
      });
    }
  } catch (err) {
    console.error('Checklist paylaşma hatası:', err);
    res.status(500).json({ error: 'Checklist paylaşılamadı', detail: err.message });
  }
});

// GET /checklst_shares/shared?shared_with_user_id=8&checklist_id=...&status=active
router.get('/shared', async (req, res) => {
  const { shared_with_user_id, checklist_id, status } = req.query;
  console.log('GET /checklst_shares/shared params:', req.query);
  if (!shared_with_user_id) return res.status(400).json({ error: 'shared_with_user_id gerekli.' });
  try {
    const CustomChecklist = require('../models/customChecklist');
    const User = require('../models/user');
    // Dinamik filtre oluştur
    const where = { shared_with_user_id };
    if (checklist_id) where.checklist_id = checklist_id;
    if (status) where.status = status;
    // Paylaşılan checklistleri, checklist başlığı ve kullanıcı bilgisi ile birlikte getir
    const shares = await db.ChecklstShare.findAll({
      where,
      include: [{
        model: CustomChecklist,
        as: 'custom_checklist',
        attributes: ['name', 'user_id'],
        required: false,
        foreignKey: 'checklist_id',
        include: [{
          model: User,
          as: 'owner',
          attributes: ['id', 'name', 'email', 'username'],
          required: false,
          foreignKey: 'user_id',
        }]
      }]
    });
    // Checklist başlığı ve kullanıcı bilgisini response'a ekle
    const result = shares.map(share => ({
      id: share.id,
      checklist_id: share.checklist_id,
      shared_with_user_id: share.shared_with_user_id,
      status: share.status,
      is_active: share.is_active,
      revokedAt: share.revokedAt,
      shared_by_user_id: share.shared_by_user_id,
      note: share.note,
      name: share.custom_checklist ? share.custom_checklist.name : '',
      owner: share.custom_checklist && share.custom_checklist.owner ? {
        id: share.custom_checklist.owner.id,
        name: share.custom_checklist.owner.name,
        email: share.custom_checklist.owner.email,
        username: share.custom_checklist.owner.username
      } : null
    }));
    console.log('GET /checklst_shares/shared response:', JSON.stringify(result, null, 2));
    res.json(result);
  } catch (err) {
    console.error('Paylaşılan checklistler hatası:', err);
    res.status(500).json({ error: 'Paylaşılan checklistler alınamadı', detail: err.message });
  }
});

// DELETE /checklst_shares/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const share = await db.ChecklstShare.findByPk(id);
    if (!share) return res.status(404).json({ error: 'Paylaşım bulunamadı.' });
    await share.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('Checklist paylaşım silme hatası:', err);
    res.status(500).json({ error: 'Paylaşım silinemedi', detail: err.message });
  }
});

module.exports = router;
