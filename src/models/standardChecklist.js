const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const StandardChecklist = sequelize.define('StandardChecklist', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  season_id: { type: DataTypes.INTEGER, allowNull: false },
  camping_type_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false }
}, {
  tableName: 'standard_checklists',
  timestamps: false,
});

module.exports = StandardChecklist;