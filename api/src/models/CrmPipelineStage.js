const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CrmPipelineStage = sequelize.define('CrmPipelineStage', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    pipeline: { type: DataTypes.ENUM('lead', 'deal'), allowNull: false },
    stage_key: { type: DataTypes.STRING(50), allowNull: false },
    stage_label: { type: DataTypes.STRING(100), allowNull: false },
    sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  }, {
    tableName: 'crm_pipeline_stages',
    timestamps: true,
    underscored: true,
  });

  return CrmPipelineStage;
};
