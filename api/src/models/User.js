module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  const User = sequelize.define('User', {
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
    username: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true
      }
    },
    extension: {
      type: DataTypes.STRING(10),
      allowNull: false
    },
    full_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    role: {
      type: DataTypes.ENUM('admin', 'supervisor', 'agent', 'user'),
      defaultValue: 'agent'
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    },
    password_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    sip_password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    asterisk_endpoint: {
      type: DataTypes.STRING,
      allowNull: false
    },
    recording_enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    routing_type: {
      type: DataTypes.ENUM('sip', 'ai_agent'),
      defaultValue: 'sip',
      comment: 'sip = ring PJSIP endpoint, ai_agent = connect to pipecat WSS'
    },
    routing_destination: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'WSS URL for ai_agent routing (e.g. ws://server:8765)'
    },
    phone_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'External phone number to ring when calling this extension'
    },
    ring_target: {
      type: DataTypes.ENUM('ext', 'phone'),
      defaultValue: 'ext',
      comment: 'Where to ring: ext = SIP endpoint, phone = external phone number'
    }
  }, {
    tableName: 'users',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['org_id', 'username'],
        name: 'unique_org_username'
      }
    ]
  });

  return User;
};
