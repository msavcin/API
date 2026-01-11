const { DataTypes } = require('sequelize');
const db = require('./index');

const CampgroundDeleted = db.sequelize.define('CampgroundDeleted', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  external_id: { type: DataTypes.STRING, allowNull: false },
  deleted_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'campgrounds_deleted',
  timestamps: false,
  indexes: [
    { fields: ['deleted_at'], name: 'idx_deleted_at' },
    { fields: ['external_id'], name: 'idx_external_id' }
  ]
});

module.exports = CampgroundDeleted;