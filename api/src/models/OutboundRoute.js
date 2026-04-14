module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  const OutboundRoute = sequelize.define('OutboundRoute', {
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
      allowNull: false,
      comment: 'Friendly name for this route'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    trunk_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'sip_trunks',
        key: 'id'
      },
      comment: 'SIP trunk to use for outbound calls'
    },
    dial_pattern: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Asterisk dial pattern (e.g., _1NXXNXXXXXX, _011., _NXXXXXX)'
    },
    dial_prefix: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Prefix to prepend to dialed number (e.g., 1, 011)'
    },
    strip_digits: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Number of digits to strip from beginning of dialed number'
    },
    prepend_digits: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Digits to prepend after stripping'
    },
    caller_id_override: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Override caller ID for outbound calls (e.g., +15551234567)'
    },
    caller_id_name_override: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Override caller ID name'
    },
    recording_enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Enable call recording for this route'
    },
    max_channels: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Maximum concurrent channels for this route'
    },
    route_type: {
      type: DataTypes.ENUM('emergency', 'local', 'long_distance', 'international', 'toll_free', 'custom'),
      defaultValue: 'custom',
      comment: 'Type of route for easier categorization'
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 10,
      comment: 'Priority order (lower number = higher priority)'
    },
    time_conditions: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Time-based routing conditions (days, hours)'
    },
    user_permissions: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'User or group permissions for this route'
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    }
  }, {
    tableName: 'outbound_routes',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['org_id', 'priority']
      },
      {
        fields: ['trunk_id']
      },
      {
        fields: ['route_type']
      }
    ]
  });

  return OutboundRoute;
};
