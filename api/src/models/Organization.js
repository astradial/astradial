const { DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

module.exports = (sequelize) => {
  const Organization = sequelize.define('Organization', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: {
        msg: 'Organization name must be unique'
      },
      validate: {
        notEmpty: true,
        len: [2, 255]
      }
    },
    context_prefix: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      validate: {
        is: /^[a-z0-9_]+$/i
      }
    },
    api_key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    api_secret: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('active', 'suspended', 'deleted'),
      defaultValue: 'active'
    },
    settings: {
      type: DataTypes.JSON,
      defaultValue: {
        max_trunks: 5,
        max_dids: 10,
        max_users: 50,
        max_queues: 10,
        recording_enabled: false,
        webhook_enabled: true,
        features: {
          call_transfer: true,
          call_recording: true,
          voicemail: true,
          conference: true,
          ivr: true,
          ai_agent: false
        }
      }
    },
    limits: {
      type: DataTypes.JSON,
      defaultValue: {
        concurrent_calls: 10,
        monthly_minutes: 10000,
        storage_gb: 10
      }
    },
    contact_info: {
      type: DataTypes.JSON,
      defaultValue: {
        email: null,
        phone: null,
        address: null
      }
    }
  }, {
    tableName: 'organizations',
    timestamps: true,
    underscored: true,
    hooks: {
      beforeValidate: async (org) => {
        // allowNull:false validates before beforeCreate, so populate here.
        if (!org.api_key) {
          org.api_key = `org_${uuidv4().replace(/-/g, '')}`;
        }
        if (!org.context_prefix) {
          org.context_prefix = `org_${Date.now().toString(36)}`;
        }
      },
      beforeCreate: async (org) => {
        if (!org.api_secret) {
          const secret = uuidv4();
          org.api_secret = await bcrypt.hash(secret, process.env.BCRYPT_ROUNDS || 12);
        }
      },
      beforeUpdate: async (org) => {
        // If API secret is being updated, hash it
        if (org.changed('api_secret') && !org.api_secret.startsWith('$2')) {
          org.api_secret = await bcrypt.hash(org.api_secret, process.env.BCRYPT_ROUNDS || 12);
        }
      }
    }
  });

  // Instance methods
  Organization.prototype.validateApiSecret = async function(secret) {
    return bcrypt.compare(secret, this.api_secret);
  };

  Organization.prototype.isActive = function() {
    return this.status === 'active';
  };

  Organization.prototype.canAddTrunk = function() {
    return this.settings.max_trunks > 0;
  };

  Organization.prototype.canAddDid = function() {
    return this.settings.max_dids > 0;
  };

  Organization.prototype.canAddUser = function() {
    return this.settings.max_users > 0;
  };

  Organization.prototype.getAsteriskContext = function(type = 'internal') {
    return `${this.context_prefix}${type}`;
  };

  return Organization;
};