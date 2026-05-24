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
    max_concurrent_calls: { type: DataTypes.SMALLINT, allowNull: true, defaultValue: 10 },
    max_sends_per_minute: { type: DataTypes.SMALLINT, allowNull: true },
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
