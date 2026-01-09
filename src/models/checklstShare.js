const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const ChecklstShare = sequelize.define('ChecklstShare', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  checklist_id: { type: DataTypes.INTEGER, allowNull: false },
  shared_with_user_id: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  revokedAt: { type: DataTypes.DATE, allowNull: true },
  shared_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
  note: { type: DataTypes.STRING, allowNull: true }
}, {
  tableName: 'checklist_shares',
  timestamps: true,
});

module.exports = ChecklstShare;
