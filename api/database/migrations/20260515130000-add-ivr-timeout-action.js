'use strict';

/**
 * Default destination when the IVR's WaitExten times out with no
 * keypress. Today the 't' handler retries the greeting up to
 * `max_retries` times then hangs up — for customers whose IVR is
 * really just "press 5 for queue, but default to queue too" this
 * means 3 × (greeting + WaitExten) of dead air before anyone hears
 * a ring. Setting `timeout_action` to 'queue'/'extension'/'hangup'
 * skips retries and routes immediately on first timeout.
 *
 * `timeout_action='retry'` (default) preserves existing behavior so
 * IVRs created before this PR keep retrying.
 *
 * `timeout_destination` interpretation depends on timeout_action:
 *   - 'queue'     → queue number (e.g. '5002')
 *   - 'extension' → extension number (e.g. '1004')
 *   - 'hangup'    → ignored
 *   - 'retry'     → ignored
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('ivrs', 'timeout_action', {
      type: Sequelize.ENUM('retry', 'queue', 'extension', 'hangup'),
      allowNull: false,
      defaultValue: 'retry',
      comment: 'What to do on WaitExten timeout: retry the greeting (default), or route to queue/extension/hangup immediately',
    });
    await queryInterface.addColumn('ivrs', 'timeout_destination', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Destination (queue/extension number) when timeout_action is queue or extension',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('ivrs', 'timeout_destination');
    await queryInterface.removeColumn('ivrs', 'timeout_action');
    // Drop the ENUM type that the column referenced; on MariaDB this
    // is a no-op (ENUM is inline), on Postgres the removeColumn
    // already drops the inline type.
  },
};
