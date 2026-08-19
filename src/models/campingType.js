const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const CampingType = sequelize.define('CampingType', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  code: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  svg: { type: DataTypes.TEXT, allowNull: true },
  color: { type: DataTypes.STRING(20), allowNull: true, defaultValue: '#73768fff' },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  deleted_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'camping_types',
  timestamps: false,
});

module.exports = CampingType;
