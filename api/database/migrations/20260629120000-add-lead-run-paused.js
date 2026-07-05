'use strict';

// Lead-level pause/resume:
//   1. Add 'paused' to campaign_lead_runs.status ENUM. A paused run is skipped
//      by the scheduler (claims only 'pending'), advance() (acts only on
//      pending/waiting/queued) and both workers — no engine changes needed.
//   2. Add paused_at DATETIME NULL (informational / audit).

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'mariadb' || dialect === 'mysql') {
      // MODIFY COLUMN rewrites the full ENUM definition — list all values.
      await queryInterface.sequelize.query(`
        ALTER TABLE campaign_lead_runs
        MODIFY COLUMN status ENUM('pending','queued','waiting','halted','completed','failed','paused')
        NOT NULL DEFAULT 'pending'
      `);
    } else if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        DO $$ BEGIN
          ALTER TYPE enum_campaign_lead_runs_status ADD VALUE IF NOT EXISTS 'paused';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
    }

    await queryInterface.addColumn('campaign_lead_runs', 'paused_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
      comment: 'When the run was paused via lead-level pause; NULL when active',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('campaign_lead_runs', 'paused_at');

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'mariadb' || dialect === 'mysql') {
      // Any paused rows must leave the enum before it's narrowed, or the
      // MODIFY would truncate them. Treat a paused run as resumable → pending.
      await queryInterface.sequelize.query(`
        UPDATE campaign_lead_runs SET status = 'pending', next_run_at = NOW() WHERE status = 'paused'
      `);
      await queryInterface.sequelize.query(`
        ALTER TABLE campaign_lead_runs
        MODIFY COLUMN status ENUM('pending','queued','waiting','halted','completed','failed')
        NOT NULL DEFAULT 'pending'
      `);
    }
    // PostgreSQL: enum values can't be dropped without recreating the type.
  },
};
