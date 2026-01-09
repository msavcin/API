const { DataTypes } = require('sequelize');
const db = require('./index');

const CampgroundImage = db.sequelize.define('CampgroundImage', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  campground_id: { type: DataTypes.INTEGER, allowNull: false },
  image_id: { type: DataTypes.STRING, allowNull: false, unique: true },
  image_url: { type: DataTypes.STRING, allowNull: false },
  source: { type: DataTypes.STRING },
  uploaded_by: { type: DataTypes.INTEGER },
  created_by: { type: DataTypes.INTEGER },
}, {
  tableName: 'campground_images',
  timestamps: false
});

module.exports = CampgroundImage;
