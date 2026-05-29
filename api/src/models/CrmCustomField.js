const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CrmCustomField = sequelize.define('CrmCustomField', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    entity_type: { type: DataTypes.ENUM('contact', 'company', 'deal'), allowNull: false },
    field_name: { type: DataTypes.STRING, allowNull: false },
    field_label: { type: DataTypes.STRING, allowNull: false },
    field_type: { type: DataTypes.ENUM('text', 'number', 'date', 'select', 'checkbox', 'email', 'phone', 'url', 'textarea'), allowNull: false },
    options: { type: DataTypes.JSON, allowNull: true },
    required: { type: DataTypes.BOOLEAN, defaultValue: false },
    sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  }, {
    tableName: 'crm_custom_fields',
    timestamps: true,
    underscored: true,
  });

  return CrmCustomField;
};
