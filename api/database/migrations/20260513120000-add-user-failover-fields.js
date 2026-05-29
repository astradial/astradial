'use strict';

/**
 * Add failover routing fields to users.
 *
 * Two columns:
 *
 * 1. `failover_destination_user_id` — UUID, nullable, FK to users.id with
 *    ON DELETE SET NULL. When the primary destination is unreachable
 *    (NOANSWER / BUSY / CHANUNAVAIL / CONGESTION) the dialplan tries this
 *    user's PJSIP endpoint as a second hop. Cross-org failover is
 *    prevented at the API validation layer (the FK alone would not catch
 *    it, since referential integrity allows any users.id).
 *
 *    NULL = no failover (current behavior — primary fails go straight to
 *    "the person at extension N is not available").
 *
 *    ON DELETE SET NULL: if the failover target user is hard-deleted, this
 *    column flips to NULL rather than cascading the deletion or leaving a
 *    dangling pointer. The dialplan re-generation on next deploy will
 *    notice and emit no failover branch.
 *
 * 2. `failover_timeout_seconds` — INT, default 20. How long the primary
 *    rings before falling over. Bounded 5-120 at the API layer. Lower
 *    is more responsive but gives the primary less chance to answer.
 *    20s mirrors the default Dial() timeout in the existing dialplan.
 *
 * MariaDB 11 FK auto-index gotcha (learned in PRs #125/#131): do NOT add
 * an explicit addIndex on the FK column — MariaDB creates one with the
 * FK constraint name automatically. Adding addIndex too will fail with
 * 1061 "Duplicate key name".
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'failover_destination_user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      after: 'outbound_did',
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      comment: 'User to ring if the primary endpoint fails (NOANSWER / BUSY / CHANUNAVAIL / CONGESTION). NULL = no failover. Cross-org refs forbidden at API layer.'
    });

    await queryInterface.addColumn('users', 'failover_timeout_seconds', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 20,
      after: 'failover_destination_user_id',
      comment: 'Seconds primary endpoint rings before failover. API-bounded 5-120.'
    });
  },

  async down(queryInterface) {
    // Drop in reverse order
    await queryInterface.removeColumn('users', 'failover_timeout_seconds');
    await queryInterface.removeColumn('users', 'failover_destination_user_id');
  }
};
