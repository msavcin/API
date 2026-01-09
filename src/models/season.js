const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const Season = sequelize.define('Season', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  created_at: { type: DataTypes.STRING, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.STRING, defaultValue: DataTypes.NOW }
}, {
  tableName: 'seasons',
  timestamps: false,
});

module.exports = Season;
