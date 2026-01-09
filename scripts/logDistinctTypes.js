const db = require('../src/models');
const Campground = db.Campground || require('../src/models/campground');

async function logDistinctTypes() {
  const types = await Campground.findAll({
    attributes: [
      [db.sequelize.fn('DISTINCT', db.sequelize.col('type')), 'type']
    ],
    raw: true
  });
  console.log('[DEBUG] Veritabanındaki farklı type değerleri:', types.map(t => t.type));
}

logDistinctTypes();
