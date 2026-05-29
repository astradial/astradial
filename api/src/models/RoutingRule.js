const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const RoutingRule = sequelize.define('RoutingRule', {
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
        len: [2, 100]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 100,
      validate: {
        min: 1,
        max: 999
      }
    },
    conditions: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
      comment: 'Routing conditions (caller_id, time_based, etc.)'
    },
    action_type: {
      type: DataTypes.ENUM('extension', 'queue', 'ivr', 'hangup', 'voicemail', 'external'),
      allowNull: false
    },
    action_data: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
      comment: 'Action configuration (extension number, queue id, etc.)'
    },
    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    time_restrictions: {
      type: DataTypes.JSON,
      defaultValue: null,
      comment: 'Time-based routing restrictions'
    }
  }, {
    tableName: 'routing_rules',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['org_id']
      },
      {
        fields: ['org_id', 'priority']
      },
      {
        fields: ['active']
      }
    ]
  });

  // Instance methods
  RoutingRule.prototype.isActive = function() {
    return this.active;
  };

  RoutingRule.prototype.matchesConditions = function(callData) {
    if (!this.isActive()) return false;

    // Check time restrictions
    if (this.time_restrictions) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday

      if (this.time_restrictions.hours) {
        const [startHour, endHour] = this.time_restrictions.hours;
        if (currentHour < startHour || currentHour > endHour) {
          return false;
        }
      }

      if (this.time_restrictions.days && !this.time_restrictions.days.includes(currentDay)) {
        return false;
      }
    }

    // Check caller ID conditions
    if (this.conditions.caller_id_patterns) {
      const callerNumber = callData.caller_number || callData.from_number;
      const patterns = this.conditions.caller_id_patterns;

      let matches = false;
      for (const pattern of patterns) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        if (regex.test(callerNumber)) {
          matches = true;
          break;
        }
      }

      if (!matches) return false;
    }

    // Check DID conditions
    if (this.conditions.did_numbers) {
      const didNumber = callData.called_number || callData.to_number;
      if (!this.conditions.did_numbers.includes(didNumber)) {
        return false;
      }
    }

    return true;
  };

  RoutingRule.prototype.getAsteriskDialplanEntry = function() {
    const context = `${this.Organization?.context_prefix || 'default'}incoming`;

    switch (this.action_type) {
      case 'extension':
        return {
          context,
          extension: this.action_data.extension_number,
          priority: this.priority,
          application: 'Dial',
          data: `PJSIP/${this.action_data.asterisk_endpoint},30`
        };

      case 'queue':
        return {
          context,
          extension: this.action_data.queue_number,
          priority: this.priority,
          application: 'Queue',
          data: this.action_data.asterisk_queue_name
        };

      case 'hangup':
        return {
          context,
          extension: '_X.',
          priority: this.priority,
          application: 'Hangup',
          data: this.action_data.cause || '16'
        };

      case 'voicemail':
        return {
          context,
          extension: this.action_data.extension_number,
          priority: this.priority,
          application: 'VoiceMail',
          data: `${this.action_data.mailbox}@${context}`
        };

      default:
        return null;
    }
  };

  return RoutingRule;
};