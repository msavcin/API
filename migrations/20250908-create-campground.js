"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("campgrounds", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING, allowNull: false },
      latitude: { type: Sequelize.FLOAT, allowNull: false },
      longitude: { type: Sequelize.FLOAT, allowNull: false },
      type: { type: Sequelize.STRING },
      description: { type: Sequelize.TEXT },
      website: { type: Sequelize.STRING },
      phone: { type: Sequelize.STRING },
      opening_hours: { type: Sequelize.STRING },
      capacity: { type: Sequelize.INTEGER },
      fee: { type: Sequelize.STRING },
      status: { type: Sequelize.STRING },
      rating: { type: Sequelize.FLOAT },
      review_count: { type: Sequelize.INTEGER },
      price_range: { type: Sequelize.STRING },
      facilities: { type: Sequelize.TEXT },
      accessibility: { type: Sequelize.TEXT },
      social_media: { type: Sequelize.TEXT },
      booking_url: { type: Sequelize.STRING },
      contact_email: { type: Sequelize.STRING },
      last_verified: { type: Sequelize.DATE },
      visibility: { type: Sequelize.STRING },
      owner_id: { type: Sequelize.INTEGER },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
      external_id: { type: Sequelize.STRING },
      source_id: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      photo_links: { type: Sequelize.TEXT },
      amenities: { type: Sequelize.TEXT },
      images: { type: Sequelize.TEXT },
      tags: { type: Sequelize.TEXT },
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable("campgrounds");
  },
};
