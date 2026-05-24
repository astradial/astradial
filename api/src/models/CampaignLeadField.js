const { DataTypes } = require('sequelize');

// Org-wide custom field configuration. Drives leads-table columns and the
// manual create-lead form. System rows (name/phone/country/status/lastTouch)
// cannot be deleted. Soft-delete preserves historical references in
// campaign_leads.custom_fields JSON.
module.exports = (sequelize) => {
  const CampaignLeadField = sequelize.define('CampaignLeadField', {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    label: { type: DataTypes.STRING(120), allowNull: false },
    type: {
      type: DataTypes.ENUM(
        'text', 'number', 'select', 'multi', 'date', 'datetime',
        'phone', 'email', 'url', 'boolean', 'currency', 'identifier'
      ),
      allowNull: false,
    },
    description: { type: DataTypes.STRING(255), allowNull: true },
    options: { type: DataTypes.JSON, allowNull: true },
    required: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_system: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  }, {
    tableName: 'campaign_lead_fields',
    timestamps: true,
    underscored: true,
  });

  return CampaignLeadField;
};
