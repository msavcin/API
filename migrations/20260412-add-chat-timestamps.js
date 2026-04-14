"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add timestamp columns
    await queryInterface.addColumn('chat_conversation_participants', 'created_at', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') });
    await queryInterface.addColumn('chat_conversation_participants', 'updated_at', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') });

    await queryInterface.addColumn('chat_messages', 'created_at', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') });
    await queryInterface.addColumn('chat_messages', 'updated_at', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') });

    await queryInterface.addColumn('chat_conversations', 'created_at', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') });
    await queryInterface.addColumn('chat_conversations', 'updated_at', { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') });

    // Create or replace trigger function and triggers for updated_at
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // conversation participants
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_chat_conversation_participants_updated_at ON chat_conversation_participants;`);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_chat_conversation_participants_updated_at
      BEFORE UPDATE ON chat_conversation_participants
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // messages
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_chat_messages_updated_at ON chat_messages;`);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_chat_messages_updated_at
      BEFORE UPDATE ON chat_messages
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // conversations
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_chat_conversations_updated_at ON chat_conversations;`);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER trg_chat_conversations_updated_at
      BEFORE UPDATE ON chat_conversations
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop triggers
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_chat_conversation_participants_updated_at ON chat_conversation_participants;`);
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_chat_messages_updated_at ON chat_messages;`);
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS trg_chat_conversations_updated_at ON chat_conversations;`);

    // Remove columns
    await queryInterface.removeColumn('chat_conversation_participants', 'created_at');
    await queryInterface.removeColumn('chat_conversation_participants', 'updated_at');

    await queryInterface.removeColumn('chat_messages', 'created_at');
    await queryInterface.removeColumn('chat_messages', 'updated_at');

    await queryInterface.removeColumn('chat_conversations', 'created_at');
    await queryInterface.removeColumn('chat_conversations', 'updated_at');
  }
};
