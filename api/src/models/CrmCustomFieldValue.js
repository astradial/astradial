const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CrmCustomFieldValue = sequelize.define('CrmCustomFieldValue', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    field_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'crm_custom_fields', key: 'id' } },
    entity_id: { type: DataTypes.UUID, allowNull: false },
    value: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'crm_custom_field_values',
    timestamps: true,
    underscored: true,
  });

  return CrmCustomFieldValue;
};
