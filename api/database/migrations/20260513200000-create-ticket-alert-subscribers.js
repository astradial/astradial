'use strict';

/**
 * Per-org subscriber list for the daily missed-call WhatsApp alert.
 *
 * Each row is one phone number a customer org wants to notify at 18:00 IST
 * when their org had ≥1 missed inbound call that day. The `ticket_alerts_enabled`
 * flag lives on `organizations` (separate migration) so the scheduler can
 * skip the org entirely without scanning subscribers.
 *
 * Phone storage choice: split into `country_code` (fixed '91' for v1) +
 * `phone` (10 digits, no plus/zero prefix). UI keeps `91` non-editable.
 * Storing them separately makes future expansion (other country codes,
 * carrier-specific routing) a column add, not a parsing migration.
 *
 * Unique (org_id, country_code, phone) prevents accidental dupes when
 * an admin adds the same number twice.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ticket_alert_subscribers', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      org_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'Owning org; subscribers wiped when org is deleted',
      },
      country_code: {
        type: Sequelize.STRING(4),
        allowNull: false,
        defaultValue: '91',
        comment: 'Country code without plus. v1 fixed to "91" but stored for future expansion.',
      },
      phone: {
        type: Sequelize.STRING(15),
        allowNull: false,
        comment: '10-digit national number (no country code, no leading zero)',
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
        comment: 'Display name for the subscriber, e.g. "Ramesh Kumar"',
      },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'User who added this subscriber; NULL after that user is hard-deleted',
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

    // No explicit addIndex on org_id — the FK auto-creates the index on
    // MariaDB 11 and re-adding it would 1061 (per the established gotcha
    // memory). The composite unique below DOES need to be added explicitly.
    await queryInterface.addIndex('ticket_alert_subscribers', {
      fields: ['org_id', 'country_code', 'phone'],
      unique: true,
      name: 'ux_ticket_alert_subscribers_org_phone',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('ticket_alert_subscribers');
  },
};
