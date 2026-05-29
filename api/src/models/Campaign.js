const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Campaign = sequelize.define('Campaign', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    name: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    template_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'campaign_templates', key: 'id' } },
    template_snapshot: { type: DataTypes.JSON, allowNull: true },
    owner_user_id: { type: DataTypes.UUID, allowNull: true },
    status: {
      type: DataTypes.ENUM('draft', 'scheduled', 'running', 'paused', 'completed', 'archived'),
      defaultValue: 'draft',
    },
    start_at: { type: DataTypes.DATE, allowNull: true },
    started_at: { type: DataTypes.DATE, allowNull: true },
    paused_at: { type: DataTypes.DATE, allowNull: true },
    completed_at: { type: DataTypes.DATE, allowNull: true },
    // DEPRECATED (Phase D): concurrency limits moved to org.settings.campaign_max_concurrent_calls
    // and org.settings.campaign_max_whatsapp_per_minute. Columns retained for backward compat;
    // workers no longer read them. See migration 20260524180000-deprecate-campaign-throughput.js.
    avg_call_seconds: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 180 },
    stats: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: { total: 0, contacted: 0, engaged: 0, interested: 0, qualified: 0 },
    },
    created_by: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'campaigns',
    timestamps: true,
    underscored: true,
  });

  return Campaign;
};
