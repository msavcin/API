const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const CustomChecklist = sequelize.define('CustomChecklist', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  is_shared: { type: DataTypes.BOOLEAN, defaultValue: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'custom_checklists',
  timestamps: false,
});

module.exports = CustomChecklist;
