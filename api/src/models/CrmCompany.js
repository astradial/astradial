const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CrmCompany = sequelize.define('CrmCompany', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    name: { type: DataTypes.STRING, allowNull: false },
    industry: { type: DataTypes.STRING, allowNull: true },
    size: { type: DataTypes.ENUM('1-10', '11-50', '51-200', '201-500', '500+'), allowNull: true },
    phone: { type: DataTypes.STRING, allowNull: true },
    email: { type: DataTypes.STRING, allowNull: true },
    website: { type: DataTypes.STRING, allowNull: true },
    address: { type: DataTypes.TEXT, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    assigned_to: { type: DataTypes.UUID, allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
  }, {
    tableName: 'crm_companies',
    timestamps: true,
    underscored: true,
  });

  return CrmCompany;
};
