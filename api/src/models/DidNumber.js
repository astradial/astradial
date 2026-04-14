const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const DidNumber = sequelize.define('DidNumber', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    org_id: {
      type: DataTypes.UUID,
      allowNull: true, // null = unassigned (in pool)
      references: { model: 'organizations', key: 'id' }
    },
    trunk_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'sip_trunks', key: 'id' }
    },
    number: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { notEmpty: true }
    },
    description: { type: DataTypes.STRING, allowNull: true },
    routing_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    routing_destination: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recording_enabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    },
    pool_status: {
      type: DataTypes.ENUM('available', 'pending', 'assigned', 'reserved'),
      defaultValue: 'available',
    },
    requested_by_org: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'organizations', key: 'id' },
    },
    requested_at: { type: DataTypes.DATE, allowNull: true },
    monthly_price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    region: { type: DataTypes.STRING, allowNull: true },
    provider: { type: DataTypes.STRING, allowNull: true },
    asterisk_extension: { type: DataTypes.STRING, allowNull: true },
    call_limit: { type: DataTypes.INTEGER, defaultValue: 0 },
  }, {
    tableName: 'did_numbers',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['org_id'] },
      { fields: ['number'], unique: true },
      { fields: ['trunk_id'] },
      { fields: ['pool_status'] },
    ]
  });

  return DidNumber;
};
