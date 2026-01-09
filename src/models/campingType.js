const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const CampingType = sequelize.define('CampingType', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false }
}, {
  tableName: 'camping_types',
  timestamps: false,
});

module.exports = CampingType;
