'use strict';

// Phase D schema changes:
//   1. Add 'queued' to campaign_lead_runs.status ENUM (between 'pending' and 'waiting').
//      Scheduler marks runs 'queued' when enqueued to a channel queue, preventing
//      double-enqueue between ticks while the job waits in BullMQ.
//   2. Add asterisk_channel_id VARCHAR(64) NULL to campaign_lead_runs.
//      Stores the lead's phone at originate time; the 5-second Asterisk poll
//      uses it to detect when a call has ended (phone absent from CoreShowChannels).

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'mariadb' || dialect === 'mysql') {
      // MariaDB/MySQL: ALTER COLUMN to extend the ENUM.
      // MODIFY COLUMN rewrites the full ENUM definition — list all values.
      await queryInterface.sequelize.query(`
        ALTER TABLE campaign_lead_runs
        MODIFY COLUMN status ENUM('pending','queued','waiting','halted','completed','failed')
        NOT NULL DEFAULT 'pending'
      `);
    }
    // PostgreSQL (CI): add the enum value idempotently.
    else if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        DO $$ BEGIN
          ALTER TYPE enum_campaign_lead_runs_status ADD VALUE IF NOT EXISTS 'queued' AFTER 'pending';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
    }

    await queryInterface.addColumn('campaign_lead_runs', 'asterisk_channel_id', {
      type: Sequelize.STRING(64),
      allowNull: true,
      defaultValue: null,
      comment: 'Lead phone stored at originate time; 5-s Asterisk poll uses it to detect call end',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('campaign_lead_runs', 'asterisk_channel_id');

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'mariadb' || dialect === 'mysql') {
      await queryInterface.sequelize.query(`
        ALTER TABLE campaign_lead_runs
        MODIFY COLUMN status ENUM('pending','waiting','halted','completed','failed')
        NOT NULL DEFAULT 'pending'
      `);
    }
    // PostgreSQL: enum values cannot be removed without dropping/recreating the type.
  },
};
