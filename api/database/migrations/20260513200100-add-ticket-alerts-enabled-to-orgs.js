'use strict';

/**
 * Per-org toggle for the missed-call WhatsApp alert.
 *
 * When false (default), the daily 18:00 IST scheduler skips this org
 * entirely — no DB scan of subscribers, no MSG91 call. Customers opt-in
 * explicitly from the Tickets page.
 *
 * Kept as a column on `organizations` rather than a row in `org_settings`
 * to match the existing pattern for other per-org feature flags and to
 * keep the scheduler's "which orgs do I need to notify" query a single
 * indexed lookup.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('organizations', 'ticket_alerts_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'When true, the daily 18:00 IST scheduler sends a WhatsApp missed-call summary to every subscriber for this org.',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('organizations', 'ticket_alerts_enabled');
  },
};
