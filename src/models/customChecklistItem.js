const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const CustomChecklistItem = sequelize.define('CustomChecklistItem', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  checklist_id: { type: DataTypes.INTEGER, allowNull: false },
  item_name: { type: DataTypes.STRING, allowNull: false }
}, {
  tableName: 'custom_checklist_items',
  timestamps: false,
});

module.exports = CustomChecklistItem;
