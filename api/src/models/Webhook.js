const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Webhook = sequelize.define('Webhook', {
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
    url: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isUrl: true
      }
    },
    events: {
      type: DataTypes.JSON,
      allowNull: false,
      validate: {
        isValidEvents(value) {
          const validEvents = [
            'call.initiated', 'call.ringing', 'call.answered', 'call.ended', 'call.failed',
            'queue.entered', 'queue.abandoned', 'queue.answered',
            'user.registered', 'user.unregistered', 'trunk.registered', 'trunk.failed'
          ];
          if (!Array.isArray(value) || value.length === 0) {
            throw new Error('Events must be a non-empty array');
          }
          for (const event of value) {
            if (!validEvents.includes(event)) {
              throw new Error(`Invalid event: ${event}`);
            }
          }
        }
      }
    },
    secret: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'HMAC secret for webhook validation'
    },
    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    retry_count: {
      type: DataTypes.INTEGER,
      defaultValue: 3,
      validate: {
        min: 0,
        max: 10
      }
    },
    timeout: {
      type: DataTypes.INTEGER,
      defaultValue: 5000,
      comment: 'Timeout in milliseconds'
    },
    last_delivery: {
      type: DataTypes.DATE,
      allowNull: true
    },
    last_status: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Last HTTP status code received'
    },
    failure_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    headers: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Additional headers to send with webhook'
    }
  }, {
    tableName: 'webhooks',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['org_id']
      },
      {
        fields: ['active']
      }
    ]
  });

  // Instance methods
  Webhook.prototype.isActive = function() {
    return this.active;
  };

  Webhook.prototype.shouldRetry = function() {
    return this.failure_count < this.retry_count;
  };

  Webhook.prototype.recordSuccess = function() {
    this.last_delivery = new Date();
    this.last_status = 200;
    this.failure_count = 0;
    return this.save();
  };

  Webhook.prototype.recordFailure = function(statusCode = null) {
    this.last_delivery = new Date();
    this.last_status = statusCode;
    this.failure_count += 1;

    // Auto-disable after too many failures
    if (this.failure_count >= this.retry_count * 2) {
      this.active = false;
    }

    return this.save();
  };

  Webhook.prototype.matchesEvent = function(eventType) {
    return this.isActive() && this.events.includes(eventType);
  };

  return Webhook;
};