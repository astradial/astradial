const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CrmActivity = sequelize.define('CrmActivity', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    contact_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'crm_contacts', key: 'id' } },
    company_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'crm_companies', key: 'id' } },
    deal_id: { type: DataTypes.UUID, allowNull: true, references: { model: 'crm_deals', key: 'id' } },
    type: { type: DataTypes.ENUM('note', 'call', 'email', 'meeting', 'task'), allowNull: false },
    subject: { type: DataTypes.STRING, allowNull: true },
    body: { type: DataTypes.TEXT, allowNull: true },
    due_date: { type: DataTypes.DATE, allowNull: true },
    completed: { type: DataTypes.BOOLEAN, defaultValue: false },
    assigned_to: { type: DataTypes.UUID, allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'crm_activities',
    timestamps: true,
    underscored: true,
  });

  return CrmActivity;
};
