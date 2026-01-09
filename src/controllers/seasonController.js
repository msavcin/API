const db = require('../models');
const Season = db.Season || require('../models/season');

// GET /seasons
exports.listSeasons = async (req, res) => {
  const seasons = await Season.findAll();
  res.json(seasons);
};
