'use strict';

// queue_log table for Asterisk queue_log_realtime ingestion.
//
// Schema mirrors what app_queue.so writes when extconfig.conf has
//   queue_log => odbc,asterisk
//
// Once the realtime mapping is active, every ENTERQUEUE / CONNECT / ABANDON /
// COMPLETEAGENT / COMPLETECALLER event for every queue call lands as a row
// here. The primary downstream use is the dashboard "Call Pickup Time" card
// (CONNECT.data1 = holdtime in seconds = time from queue entry to agent
// pickup), but the same table also unblocks queue-level reporting (abandon
// rate, agent utilization) in the future.
//
// IMPORTANT: creating this table alone does NOT start the ingestion. After
// this migration runs, an operator must also:
//   1. Add 'queue_log => odbc,asterisk' under [settings] in /etc/asterisk/extconfig.conf
//   2. Run 'module reload app_queue.so' on the Asterisk box
// See sip-gateway/cloud-staging/extconfig.conf for the template and the PR
// body for the runbook.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('queue_log', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      time: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      callid: {
        type: Sequelize.STRING(80),
        allowNull: false,
        defaultValue: '',
      },
      queuename: {
        type: Sequelize.STRING(80),
        allowNull: false,
        defaultValue: '',
      },
      agent: {
        type: Sequelize.STRING(80),
        allowNull: false,
        defaultValue: '',
      },
      event: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: '',
      },
      data1: { type: Sequelize.STRING(100), allowNull: false, defaultValue: '' },
      data2: { type: Sequelize.STRING(100), allowNull: false, defaultValue: '' },
      data3: { type: Sequelize.STRING(100), allowNull: false, defaultValue: '' },
      data4: { type: Sequelize.STRING(100), allowNull: false, defaultValue: '' },
      data5: { type: Sequelize.STRING(100), allowNull: false, defaultValue: '' },
    });

    // time: every dashboard query is "events in last N days" — by far the
    // hottest predicate. queuename: per-org filtering matches a LIKE prefix
    // on the org's context_prefix. event: most reads filter to CONNECT only.
    await queryInterface.addIndex('queue_log', ['time']);
    await queryInterface.addIndex('queue_log', ['queuename']);
    await queryInterface.addIndex('queue_log', ['event']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('queue_log');
  },
};
