const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
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
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [2, 255]
      }
    },
    host: {
      type: DataTypes.STRING,
      allowNull: true, // NULL for inbound trunks (dynamic registration)
      validate: {
        notEmptyIfRequired(value) {
          // Host is required for outbound and peer2peer, but not for inbound
          if (this.trunk_type !== 'inbound' && (!value || value.trim() === '')) {
            throw new Error('Host is required for outbound and peer2peer trunk types');
          }
        }
      }
    },
    username: {
      type: DataTypes.STRING,
      allowNull: true
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true
    },
    port: {
      type: DataTypes.INTEGER,
      defaultValue: 5060,
      validate: {
        min: 1,
        max: 65535
      }
    },
    transport: {
      type: DataTypes.ENUM('udp', 'tcp', 'tls'),
      defaultValue: 'udp'
    },
    trunk_type: {
      type: DataTypes.ENUM('inbound', 'outbound', 'peer2peer'),
      defaultValue: 'outbound',
      allowNull: false,
      comment: 'Type of trunk: inbound (provider registers to us), outbound (we register to provider), peer2peer (SIP OPTIONS only)'
    },
    retry_interval: {
      type: DataTypes.INTEGER,
      defaultValue: 60,
      allowNull: true,
      comment: 'Registration retry interval in seconds (for inbound type)'
    },
    expiration: {
      type: DataTypes.INTEGER,
      defaultValue: 3600,
      allowNull: true,
      comment: 'Registration expiration time in seconds (for inbound type)'
    },
    contact_user: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Contact user for registration (defaults to username if not set)'
    },
    max_channels: {
      type: DataTypes.INTEGER,
      defaultValue: 10,
      validate: {
        min: 1,
        max: 1000
      }
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'maintenance'),
      defaultValue: 'active'
    },
    asterisk_peer_name: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Generated Asterisk peer name for this trunk'
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
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Additional Asterisk-specific configuration'
    }
  }, {
    tableName: 'sip_trunks',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['org_id']
      },
      {
        fields: ['org_id', 'name'],
        unique: true
      },
      {
        fields: ['asterisk_peer_name'],
        unique: true,
        where: {
          asterisk_peer_name: { [sequelize.Sequelize.Op.ne]: null }
        }
      }
    ],
    hooks: {
      beforeCreate: async (trunk) => {
        // Generate unique Asterisk peer name
        if (!trunk.asterisk_peer_name) {
          const orgPrefix = trunk.org_id.substring(0, 8);
          const trunkSuffix = trunk.name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10);
          trunk.asterisk_peer_name = `trunk_${orgPrefix}_${trunkSuffix}`;
        }
      }
    }
  });

  // Instance methods
  SipTrunk.prototype.getAsteriskPeerConfig = function() {
    return {
      name: this.asterisk_peer_name,
      type: 'peer',
      host: this.host,
      port: this.port,
      transport: this.transport,
      username: this.username,
      secret: this.password,
      qualify: 'yes',
      insecure: 'port,invite',
      canreinvite: 'no',
      context: `${this.Organization?.context_prefix || 'default'}incoming`,
      dtmfmode: 'rfc2833',
      ...this.configuration
    };
  };

  SipTrunk.prototype.isActive = function() {
    return this.status === 'active';
  };

  SipTrunk.prototype.isRegistered = function() {
    return this.registration_status === 'registered';
  };

  return SipTrunk;
};