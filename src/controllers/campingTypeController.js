const db = require('../models');
const CampingType = db.CampingType || require('../models/campingType');

// GET /camping_types
exports.listCampingTypes = async (req, res) => {
  const types = await CampingType.findAll({ order: [['sort_order', 'ASC']] });
  res.json(types);
};
