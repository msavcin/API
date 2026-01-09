const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const ChecklstShare = sequelize.define('ChecklstShare', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  checklist_id: { type: DataTypes.INTEGER, allowNull: false },
  shared_with_user_id: { type: DataTypes.INTEGER, allowNull: false }
}, {
  tableName: 'checklist_shares',
  timestamps: false,
});

module.exports = ChecklstShare;
