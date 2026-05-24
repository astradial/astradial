const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CampaignApproval = sequelize.define('CampaignApproval', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    campaign_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' } },
    campaign_lead_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'campaign_leads', key: 'id' } },
    channel: { type: DataTypes.ENUM('whatsapp', 'call'), allowNull: false },
    node_id: { type: DataTypes.STRING(64), allowNull: true },
    draft: { type: DataTypes.TEXT, allowNull: true },
    reasoning: { type: DataTypes.TEXT, allowNull: true },
    context: { type: DataTypes.JSON, allowNull: true },
    sla_at: { type: DataTypes.DATE, allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'expired'),
      defaultValue: 'pending',
    },
    decided_by: { type: DataTypes.UUID, allowNull: true },
    decided_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'campaign_approvals',
    timestamps: true,
    underscored: true,
  });

  return CampaignApproval;
};
