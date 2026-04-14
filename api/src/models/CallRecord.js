const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CallRecord = sequelize.define('CallRecord', {
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
    call_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: 'Asterisk unique call ID'
    },
    channel_id: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Asterisk channel ID'
    },
    from_number: {
      type: DataTypes.STRING,
      allowNull: false
    },
    to_number: {
      type: DataTypes.STRING,
      allowNull: false
    },
    caller_id_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    direction: {
      type: DataTypes.ENUM('inbound', 'outbound', 'internal'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('ringing', 'answered', 'busy', 'failed', 'no-answer', 'completed', 'abandoned'),
      defaultValue: 'ringing'
    },
    trunk_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'sip_trunks',
        key: 'id'
      }
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    queue_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'queues',
        key: 'id'
      }
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    answered_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Total call duration in seconds'
    },
    talk_time: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Actual talk time in seconds (after answer)'
    },
    wait_time: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Time spent waiting in queue (seconds)'
    },
    recording_url: {
      type: DataTypes.STRING,
      allowNull: true
    },
    recording_file: {
      type: DataTypes.STRING,
      allowNull: true
    },
    hangup_cause: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Asterisk hangup cause'
    },
    cost: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true,
      comment: 'Call cost if applicable'
    },
    variables: {
      type: DataTypes.JSON,
      defaultValue: {},
      comment: 'Additional call variables from Asterisk'
    }
  }, {
    tableName: 'call_records',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['org_id']
      },
      {
        fields: ['call_id'],
        unique: true
      },
      {
        fields: ['org_id', 'started_at']
      },
      {
        fields: ['org_id', 'status']
      },
      {
        fields: ['user_id']
      },
      {
        fields: ['queue_id']
      },
      {
        fields: ['trunk_id']
      }
    ]
  });

  // Instance methods
  CallRecord.prototype.isActive = function() {
    return ['ringing', 'answered'].includes(this.status);
  };

  CallRecord.prototype.isCompleted = function() {
    return ['completed', 'busy', 'failed', 'no-answer', 'abandoned'].includes(this.status);
  };

  CallRecord.prototype.calculateDuration = function() {
    if (!this.ended_at) return null;

    const start = new Date(this.started_at);
    const end = new Date(this.ended_at);
    return Math.floor((end - start) / 1000);
  };

  CallRecord.prototype.calculateTalkTime = function() {
    if (!this.answered_at || !this.ended_at) return null;

    const answered = new Date(this.answered_at);
    const ended = new Date(this.ended_at);
    return Math.floor((ended - answered) / 1000);
  };

  CallRecord.prototype.markAnswered = function() {
    this.status = 'answered';
    this.answered_at = new Date();
    return this.save();
  };

  CallRecord.prototype.markEnded = function(hangupCause = null) {
    this.status = 'completed';
    this.ended_at = new Date();
    this.duration = this.calculateDuration();
    this.talk_time = this.calculateTalkTime();
    if (hangupCause) this.hangup_cause = hangupCause;
    return this.save();
  };

  // Static methods
  CallRecord.getActiveCallsCount = async function(orgId) {
    return this.count({
      where: {
        org_id: orgId,
        status: ['ringing', 'answered']
      }
    });
  };

  CallRecord.getCallStatistics = async function(orgId, timeframe = '24h') {
    const { Op } = require('sequelize');

    let startDate;
    switch (timeframe) {
      case '1h':
        startDate = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    const stats = await this.findAll({
      where: {
        org_id: orgId,
        started_at: {
          [Op.gte]: startDate
        }
      },
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        [sequelize.fn('AVG', sequelize.col('duration')), 'avg_duration'],
        [sequelize.fn('SUM', sequelize.col('duration')), 'total_duration']
      ],
      group: ['status'],
      raw: true
    });

    return stats;
  };

  return CallRecord;
};