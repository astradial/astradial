const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CampaignLead = sequelize.define('CampaignLead', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    campaign_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' } },
    name: { type: DataTypes.STRING(200), allowNull: false },
    phone: { type: DataTypes.STRING(32), allowNull: false },
    country: { type: DataTypes.STRING(8), allowNull: true },
    business: { type: DataTypes.STRING(200), allowNull: true },
    source: { type: DataTypes.ENUM('csv', 'webform', 'api', 'manual'), defaultValue: 'manual' },
    status: {
      type: DataTypes.ENUM('raw', 'contacted', 'engaged', 'interested', 'qualified', 'disqualified', 'dnc'),
      defaultValue: 'raw',
    },
    custom_fields: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    custom_fields_schema_version: { type: DataTypes.INTEGER, defaultValue: 1 },
    intent_score: { type: DataTypes.SMALLINT, defaultValue: 0 },
    last_touch_at: { type: DataTypes.DATE, allowNull: true },
    current_node_id: { type: DataTypes.STRING(64), allowNull: true },
    crm_contact_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'crm_contacts', key: 'id' } },
    enrolled_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'campaign_leads',
    timestamps: true,
    underscored: true,
  });

  return CampaignLead;
};
