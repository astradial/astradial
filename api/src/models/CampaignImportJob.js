const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CampaignImportJob = sequelize.define('CampaignImportJob', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    campaign_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' } },
    status: {
      type: DataTypes.ENUM('queued', 'running', 'completed', 'failed', 'cancelled'),
      defaultValue: 'queued',
      allowNull: false,
    },
    mode: {
      type: DataTypes.ENUM('skip_duplicates', 'upsert', 'fail_on_conflict'),
      defaultValue: 'skip_duplicates',
      allowNull: false,
    },
    file_path: { type: DataTypes.STRING(512), allowNull: false },
    original_filename: { type: DataTypes.STRING(255), allowNull: true },
    file_size_bytes: { type: DataTypes.BIGINT, allowNull: true },
    column_mapping: { type: DataTypes.JSON, allowNull: false },
    total_rows: { type: DataTypes.INTEGER, allowNull: true },
    processed: { type: DataTypes.INTEGER, defaultValue: 0 },
    inserted: { type: DataTypes.INTEGER, defaultValue: 0 },
    updated: { type: DataTypes.INTEGER, defaultValue: 0 },
    skipped: { type: DataTypes.INTEGER, defaultValue: 0 },
    error_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    errors: { type: DataTypes.JSON, allowNull: true },
    last_error: { type: DataTypes.TEXT, allowNull: true },
    queue_job_id: { type: DataTypes.STRING(64), allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
    started_at: { type: DataTypes.DATE, allowNull: true },
    finished_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'campaign_import_jobs',
    timestamps: true,
    underscored: true,
  });

  return CampaignImportJob;
};
