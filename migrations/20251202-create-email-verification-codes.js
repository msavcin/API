module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('email_verification_codes', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      email: { type: Sequelize.STRING, allowNull: false, unique: true },
      code: { type: Sequelize.STRING(6), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('email_verification_codes');
  }
};
