const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CampaignLeadRun = sequelize.define('CampaignLeadRun', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    campaign_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' } },
    campaign_lead_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'campaign_leads', key: 'id' } },
    current_day_index: { type: DataTypes.INTEGER, defaultValue: 0 },
    current_action_index: { type: DataTypes.INTEGER, defaultValue: 0 },
    next_run_at: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM('pending', 'queued', 'waiting', 'halted', 'completed', 'failed', 'paused'),
      defaultValue: 'pending',
    },
    asterisk_channel_id: { type: DataTypes.STRING(64), allowNull: true },
    halted_at: { type: DataTypes.DATE, allowNull: true },
    paused_at: { type: DataTypes.DATE, allowNull: true },
    locked_at: { type: DataTypes.DATE, allowNull: true },
    locked_by: { type: DataTypes.STRING(64), allowNull: true },
    attempts: { type: DataTypes.TINYINT, defaultValue: 0 },
    last_error: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'campaign_lead_runs',
    timestamps: true,
    underscored: true,
  });

  return CampaignLeadRun;
};
