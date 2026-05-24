const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CampaignTemplate = sequelize.define('CampaignTemplate', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    name: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM('draft', 'published', 'archived'), defaultValue: 'draft' },
    version: { type: DataTypes.INTEGER, defaultValue: 1 },
    workflow: { type: DataTypes.JSON, allowNull: false, defaultValue: { meta: {}, days: [] } },
    created_by: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'campaign_templates',
    timestamps: true,
    underscored: true,
  });

  return CampaignTemplate;
};
