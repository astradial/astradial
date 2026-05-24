'use strict';

// Job tracking for async CSV imports. The synchronous /leads/import
// endpoint stays for small files; this table backs /leads/import-async
// which is the path the dashboard takes for 5 lakh-row uploads.
//
// Also adds a partial index on campaign_lead_runs(next_run_at) for the
// scheduler's hot-path query — at ~2.5M open rows in steady state the
// existing (status, next_run_at, org_id) btree bloats with completed
// rows; the partial keeps the index tiny.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('campaign_import_jobs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      campaign_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
      status: {
        type: Sequelize.ENUM('queued', 'running', 'completed', 'failed', 'cancelled'),
        defaultValue: 'queued',
        allowNull: false,
      },
      mode: {
        type: Sequelize.ENUM('skip_duplicates', 'upsert', 'fail_on_conflict'),
        defaultValue: 'skip_duplicates',
        allowNull: false,
      },
      // Source file — kept on the API pod's local /tmp until the worker
      // finishes. Multi-pod deployments would need S3 here; v1 is OK.
      file_path: { type: Sequelize.STRING(512), allowNull: false },
      original_filename: { type: Sequelize.STRING(255), allowNull: true },
      file_size_bytes: { type: Sequelize.BIGINT, allowNull: true },
      column_mapping: { type: Sequelize.JSON, allowNull: false },
      // Progress counters — updated every ~5k rows by the worker, NOT
      // every row. Keep DB write rate sane at 500k inputs.
      total_rows: { type: Sequelize.INTEGER, allowNull: true },
      processed: { type: Sequelize.INTEGER, defaultValue: 0, allowNull: false },
      inserted: { type: Sequelize.INTEGER, defaultValue: 0, allowNull: false },
      updated: { type: Sequelize.INTEGER, defaultValue: 0, allowNull: false },
      skipped: { type: Sequelize.INTEGER, defaultValue: 0, allowNull: false },
      error_count: { type: Sequelize.INTEGER, defaultValue: 0, allowNull: false },
      // First N row-level errors kept verbatim so the user sees something
      // useful in the dashboard. Truncated to 100 errors in code; the
      // full set is in worker logs.
      errors: { type: Sequelize.JSON, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      // BullMQ job id — lets the API cancel/inspect a job without
      // re-querying via campaign+timestamp.
      queue_job_id: { type: Sequelize.STRING(64), allowNull: true },
      created_by: { type: Sequelize.UUID, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: true },
      finished_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('campaign_import_jobs', ['org_id', 'campaign_id', 'created_at']);
    await queryInterface.addIndex('campaign_import_jobs', ['status', 'created_at']);
    await queryInterface.addIndex('campaign_import_jobs', { fields: ['queue_job_id'], unique: false });

    // Partial index on campaign_lead_runs — only the hot rows. Postgres
    // and modern MariaDB (10.5+) both support partial / filtered indexes;
    // skip silently if the dialect can't take it.
    try {
      const dialect = queryInterface.sequelize.getDialect();
      if (dialect === 'postgres') {
        await queryInterface.sequelize.query(
          "CREATE INDEX IF NOT EXISTS idx_campaign_lead_runs_pending ON campaign_lead_runs (next_run_at) WHERE status = 'pending'"
        );
      }
      // MariaDB/MySQL: no partial-index syntax; the existing
      // (status, next_run_at, org_id) compound is good enough at this
      // scale. Leave it.
    } catch (e) {
      console.warn('[migration] could not create partial index on campaign_lead_runs:', e.message);
    }
  },

  down: async (queryInterface) => {
    try {
      if (queryInterface.sequelize.getDialect() === 'postgres') {
        await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_campaign_lead_runs_pending');
      }
    } catch { /* ignore */ }
    await queryInterface.dropTable('campaign_import_jobs');
  },
};
