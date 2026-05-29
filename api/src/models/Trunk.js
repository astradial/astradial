module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  const SipTrunk = sequelize.define('SipTrunk', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    org_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'organizations',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    host: {
      type: DataTypes.STRING,
      allowNull: false
    },
    port: {
      type: DataTypes.INTEGER,
      defaultValue: 5060
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true
    },
    transport: {
      type: DataTypes.ENUM('udp', 'tcp', 'tls'),
      defaultValue: 'udp'
    },
    asterisk_peer_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    max_channels: {
      type: DataTypes.INTEGER,
      defaultValue: 10
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'maintenance'),
      defaultValue: 'active'
    },
    last_registration: {
      type: DataTypes.DATE,
      allowNull: true
    },
    registration_status: {
      type: DataTypes.ENUM('registered', 'unregistered', 'failed', 'unknown'),
      defaultValue: 'unknown'
    },
    configuration: {
      type: DataTypes.TEXT('long'),
      allowNull: true
    }
  }, {
    tableName: 'sip_trunks',
    timestamps: true,
    underscored: true
  });

  return SipTrunk;
};
