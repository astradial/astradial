'use strict';

/**
 * Per-member ring timeout for queue members.
 *
 * Why: Asterisk's queue `timeout` parameter is queue-wide — one value
 * applied uniformly when ringing each member. Customers want per-member
 * ring time (e.g. front-desk rings 10s, manager rings 30s) so a slow
 * responder doesn't burn the whole caller-patience budget before the next
 * member is tried.
 *
 * How it works at runtime: the dialplan generator emits a per-queue
 * helper context (`<prefix>_queue_<queue_id>_members`) with one extension
 * per member doing `Dial(PJSIP/<phone>@<trunk>, ring_timeout_seconds, tT)`.
 * The queue's `member =>` line points at `Local/qm_<member_id>@<that-context>/n`
 * so each member's hangup-on-no-answer is timed independently of `queue.timeout`.
 *
 * Default 20 matches Asterisk's previous queue-wide timeout, so existing
 * queues keep current behavior on first deploy.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('queue_members', 'ring_timeout_seconds', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 20,
      comment: 'Seconds to ring this member before moving on (per-member, overrides queue.timeout)',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('queue_members', 'ring_timeout_seconds');
  },
};
