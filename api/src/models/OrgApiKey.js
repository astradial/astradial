const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const OrgApiKey = sequelize.define('OrgApiKey', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
    name: { type: DataTypes.STRING, allowNull: false },
    api_key: { type: DataTypes.STRING, allowNull: false, unique: true },
    api_secret_hash: { type: DataTypes.STRING, allowNull: false },
    permissions: { type: DataTypes.JSON, defaultValue: ['calls.read', 'calls.write', 'calls.click_to_call'] },
    status: { type: DataTypes.ENUM('active', 'revoked'), defaultValue: 'active' },
    last_used_at: { type: DataTypes.DATE, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
  }, {
    tableName: 'org_api_keys',
    timestamps: true,
    underscored: true,
  });

  return OrgApiKey;
};
