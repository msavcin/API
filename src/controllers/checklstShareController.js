const db = require('../models');
const ChecklstShare = db.ChecklstShare || require('../models/checklstShare');
const CustomChecklist = db.CustomChecklist || require('../models/customChecklist');

// POST /checklst_shares
exports.createShare = async (req, res) => {
  const { checklist_id, shared_with_user_id } = req.body;
  if (!checklist_id || !shared_with_user_id) return res.status(400).json({ error: 'checklist_id ve shared_with_user_id zorunlu' });
  const share = await ChecklstShare.create({ checklist_id, shared_with_user_id });
  res.status(201).json(share);
};

// GET /custom_checklists?shared_with_user_id=...
exports.listSharedChecklists = async (req, res) => {
  const { shared_with_user_id } = req.query;
  if (!shared_with_user_id) return res.status(400).json({ error: 'shared_with_user_id gerekli' });
  const shares = await ChecklstShare.findAll({ where: { shared_with_user_id } });
  const checklistIds = shares.map(s => s.checklist_id);
  const checklists = await CustomChecklist.findAll({ where: { id: checklistIds } });
  res.json(checklists);
};
