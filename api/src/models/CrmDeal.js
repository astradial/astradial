const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CrmDeal = sequelize.define('CrmDeal', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    company_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'crm_companies', key: 'id' } },
    contact_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'crm_contacts', key: 'id' } },
    title: { type: DataTypes.STRING, allowNull: false },
    stage: { type: DataTypes.ENUM('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'), defaultValue: 'lead' },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    currency: { type: DataTypes.STRING(3), defaultValue: 'INR' },
    expected_close: { type: DataTypes.DATEONLY, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    assigned_to: { type: DataTypes.UUID, allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'crm_deals',
    timestamps: true,
    underscored: true,
  });

  return CrmDeal;
};
