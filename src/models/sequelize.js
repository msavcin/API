const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('kampdefterim', 'postgres', 's1vc10n', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false,
});

module.exports = sequelize;
