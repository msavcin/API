const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const StandardChecklistItem = sequelize.define('StandardChecklistItem', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  checklist_id: { type: DataTypes.INTEGER, allowNull: false },
  item_name: { type: DataTypes.STRING, allowNull: false },
  category: { type: DataTypes.STRING, allowNull: true }
}, {
  tableName: 'standard_checklist_items',
  timestamps: false,
});

module.exports = StandardChecklistItem;
