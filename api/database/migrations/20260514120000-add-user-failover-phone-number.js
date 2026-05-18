'use strict';

/**
 * Extend SIP-user failover with an optional phone-number destination.
 *
 * Operators previously could only fail over to another SIP user (a
 * UUID FK; see migration `20260513120000-add-user-failover-fields`).
 * Some hotel customers (V7 specifically) want to fail over to a
 * mobile phone instead — e.g. "if Reception is unreachable, ring
 * the night manager's cell." This migration adds:
 *
 *   failover_phone_number  VARCHAR(20) NULL
 *
 * Semantics enforced at the API layer (no DB-level constraint
 * because Sequelize's MariaDB dialect doesn't fluently support
 * CHECK constraints across versions):
 *
 *   - At most ONE of `failover_destination_user_id` / `failover_phone_number`
 *     may be set; both NULL means no failover (current default).
 *   - Phone number is stored as digits-only with optional +91 prefix
 *     (e.g. `+919876543210` or `9876543210`). The dialplan strips
 *     non-digits at generation time and trims to 10 digits, matching
 *     the existing `ring_target='phone'` behavior in
 *     `dialplanGenerator.js generateUserExtension()`.
 *
 * No new index — this field is read alongside the row, never WHERE'd.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'failover_phone_number', {
      type: Sequelize.STRING(20),
      allowNull: true,
      after: 'failover_destination_user_id',
      comment: 'External phone number to ring as failover (e.g. +919876543210). Mutually exclusive with failover_destination_user_id; only one may be set.'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'failover_phone_number');
  }
};
