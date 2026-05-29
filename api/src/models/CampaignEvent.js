const { DataTypes } = require('sequelize');

// Append-only event stream. Powers lead-drawer timeline, dashboard activity
// feed, and transcript views. INSERT-before-dispatch on idempotency_key
// guarantees at-most-once channel calls across scheduler crashes/retries.
module.exports = (sequelize) => {
  const CampaignEvent = sequelize.define('CampaignEvent', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    campaign_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' } },
    campaign_lead_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'campaign_leads', key: 'id' } },
    kind: {
      type: DataTypes.ENUM(
        'enrolled',
        'whatsapp_sent', 'whatsapp_delivered', 'whatsapp_replied',
        'call_started', 'call_completed', 'call_failed',
        'status_changed',
        'qualified', 'disqualified', 'halted',
        'approval_created', 'approval_decided'
      ),
      allowNull: false,
    },
    node_id: { type: DataTypes.STRING(64), allowNull: true },
    idempotency_key: { type: DataTypes.STRING(128), allowNull: true, unique: true },
    payload: { type: DataTypes.JSON, allowNull: true },
  }, {
    tableName: 'campaign_events',
    timestamps: true,
    underscored: true,
    updatedAt: false,
  });

  return CampaignEvent;
};
