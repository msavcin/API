// Topluluk işlemleri controller
const db = require('../models');
const Community = db.Community || require('../models/community');

exports.listCommunities = async (req, res) => {
  const communities = await Community.findAll();
  res.json(communities);
};

exports.getCommunity = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Geçersiz id' });
  const community = await Community.findByPk(id);
  if (!community) return res.status(404).json({ error: 'Topluluk bulunamadı' });
  res.json(community);
};

exports.createCommunity = async (req, res) => {
  res.json({ message: 'createCommunity endpoint' });
};

exports.updateCommunity = async (req, res) => {
  res.json({ message: 'updateCommunity endpoint' });
};

exports.deleteCommunity = async (req, res) => {
  res.json({ message: 'deleteCommunity endpoint' });
};
