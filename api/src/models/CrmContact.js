const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CrmContact = sequelize.define('CrmContact', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    company_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'crm_companies', key: 'id' } },
    first_name: { type: DataTypes.STRING, allowNull: false },
    last_name: { type: DataTypes.STRING, allowNull: true },
    email: { type: DataTypes.STRING, allowNull: true },
    phone: { type: DataTypes.STRING, allowNull: true },
    job_title: { type: DataTypes.STRING, allowNull: true },
    lead_source: { type: DataTypes.ENUM('website', 'phone', 'referral', 'social', 'advertisement', 'cold_call', 'event', 'other'), allowNull: true },
    lead_status: { type: DataTypes.ENUM('new', 'contacted', 'qualified', 'converted', 'lost'), defaultValue: 'new' },
    notes: { type: DataTypes.TEXT, allowNull: true },
    assigned_to: { type: DataTypes.UUID, allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'crm_contacts',
    timestamps: true,
    underscored: true,
  });

  return CrmContact;
};
