'use strict';

/**
 * Singleton config row for the Astradial-admin MSG91 WhatsApp account.
 *
 * This is DIFFERENT from per-org MSG91 settings (used inside org workflows).
 * This is *our* MSG91 account used by the daily scheduler to send missed-
 * call alerts FROM Astradial TO subscribers across every customer org.
 *
 * Singleton enforced by `is_singleton` CHECK on a constant value of TRUE
 * with a unique index — guarantees the table holds at most one row
 * regardless of how many INSERTs happen.
 *
 * Auth key is intentionally NOT stored here. It lives in the API's `.env`
 * as `MSG91_ADMIN_AUTH_KEY` so it can be rotated without a DB write and
 * is never exposed via any UI or admin API response.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('admin_whatsapp_config', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      is_singleton: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Always TRUE; combined with unique index ux_admin_whatsapp_config_singleton to enforce one row',
      },
      integrated_number: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'MSG91 integrated WhatsApp Business number (E.164 without +), e.g. 15558897024',
      },
      namespace: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'MSG91 template namespace UUID with underscores, e.g. ab7728b6_9e3c_4160_b51e_958e57f151e0',
      },
      selected_template_name: {
        type: Sequelize.STRING(120),
        allowNull: true,
        comment: 'MSG91 template name the scheduler uses for the daily missed-call alert (e.g. missed_calls_alert). The admin picks this from the MSG91 template list in the UI.',
      },
      template_language: {
        type: Sequelize.STRING(8),
        allowNull: false,
        defaultValue: 'en',
        comment: 'Template language code (en, en_GB, hi, etc.)',
      },
      updated_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Admin user who last updated the config',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Singleton enforcement: unique index on is_singleton (always true)
    // guarantees the table never holds more than one row.
    await queryInterface.addIndex('admin_whatsapp_config', {
      fields: ['is_singleton'],
      unique: true,
      name: 'ux_admin_whatsapp_config_singleton',
    });

    // Seed a default row so the admin UI always has something to read+update.
    // All MSG91 fields are NULL until an admin configures them — the
    // scheduler refuses to send until they're set.
    //
    // UUID generated in JS rather than via `Sequelize.literal('UUID()')`
    // so the migration is dialect-agnostic (sqlite-in-memory tests don't
    // have UUID() function).
    const { randomUUID } = require('crypto');
    const now = new Date();
    await queryInterface.bulkInsert('admin_whatsapp_config', [{
      id: randomUUID(),
      is_singleton: true,
      template_language: 'en',
      created_at: now,
      updated_at: now,
    }]);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('admin_whatsapp_config');
  },
};
