module.exports = (sequelize) => {
  const { DataTypes } = require('sequelize');

  const Queue = sequelize.define('Queue', {
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
    number: {
      type: DataTypes.STRING(10),
      allowNull: false
    },
    strategy: {
      type: DataTypes.ENUM('ringall', 'leastrecent', 'fewestcalls', 'random', 'rrmemory', 'linear'),
      defaultValue: 'ringall'
    },
    timeout: {
      type: DataTypes.INTEGER,
      defaultValue: 15
    },
    max_wait_time: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    music_on_hold: {
      type: DataTypes.STRING,
      defaultValue: 'default'
    },
    asterisk_queue_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    recording_enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    wrap_up_time: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Wrap-up time in seconds after call ends'
    },
    announce_frequency: {
      type: DataTypes.INTEGER,
      defaultValue: 30,
      comment: 'How often to announce position/holdtime (seconds)'
    },
    announce_holdtime: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Announce average hold time to caller'
    },
    announce_position: {
      type: DataTypes.ENUM('yes', 'no', 'limit', 'more'),
      defaultValue: 'yes',
      comment: 'Announce position in queue to caller'
    },
    announce_position_limit: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
      comment: 'Only announce position if within this limit'
    },
    join_empty: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Allow callers to join when no agents available'
    },
    leave_when_empty: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Remove callers when no agents available'
    },
    ring_inuse: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Ring members already on a call'
    },
    ring_sound: {
      type: DataTypes.STRING,
      defaultValue: 'ring'
    },
    retry: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
      comment: 'Delay before retrying member (seconds)'
    },
    service_level: {
      type: DataTypes.INTEGER,
      defaultValue: 60,
      comment: 'Service level target in seconds'
    },
    weight: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Queue weight for call distribution'
    },
    autopause: {
      type: DataTypes.ENUM('yes', 'no', 'all'),
      defaultValue: 'no',
      comment: 'Auto-pause agents on no answer'
    },
    autopausedelay: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Delay before auto-pausing agent (seconds)'
    },
    autopausebusy: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Auto-pause on busy'
    },
    autopauseunavail: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Auto-pause when unavailable'
    },
    max_callers: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Maximum callers in queue (0 = unlimited)'
    },
    periodic_announce: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Periodic announcement audio file'
    },
    periodic_announce_frequency: {
      type: DataTypes.INTEGER,
      defaultValue: 60,
      comment: 'How often to play periodic announcement (seconds)'
    },
    min_announce_frequency: {
      type: DataTypes.INTEGER,
      defaultValue: 15,
      comment: 'Minimum time between announcements (seconds)'
    },
    relative_periodic_announce: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Reset periodic announce timer on each announcement'
    },
    announce_round_seconds: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Round announce time to nearest X seconds'
    },
    queue_youarenext: {
      type: DataTypes.STRING,
      defaultValue: 'queue-youarenext',
      comment: 'Audio file: You are now first in line'
    },
    queue_thereare: {
      type: DataTypes.STRING,
      defaultValue: 'queue-thereare',
      comment: 'Audio file: There are...'
    },
    queue_callswaiting: {
      type: DataTypes.STRING,
      defaultValue: 'queue-callswaiting',
      comment: 'Audio file: calls waiting'
    },
    queue_holdtime: {
      type: DataTypes.STRING,
      defaultValue: 'queue-holdtime',
      comment: 'Audio file: The current hold time is...'
    },
    queue_minutes: {
      type: DataTypes.STRING,
      defaultValue: 'queue-minutes',
      comment: 'Audio file: minutes'
    },
    queue_seconds: {
      type: DataTypes.STRING,
      defaultValue: 'queue-seconds',
      comment: 'Audio file: seconds'
    },
    queue_thankyou: {
      type: DataTypes.STRING,
      defaultValue: 'queue-thankyou',
      comment: 'Audio file: Thank you for your patience'
    },
    queue_reporthold: {
      type: DataTypes.STRING,
      defaultValue: 'queue-reporthold',
      comment: 'Audio file: Hold time report'
    },
    reportholdtime: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Report hold time to agent'
    },
    memberdelay: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Delay before connecting to agent (seconds)'
    },
    timeoutpriority: {
      type: DataTypes.ENUM('app', 'conf'),
      defaultValue: 'app',
      comment: 'Priority of timeout over priority'
    },
    timeout_destination: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Destination on queue timeout (extension number, queue number, etc.)'
    },
    timeout_destination_type: {
      type: DataTypes.ENUM('extension', 'queue', 'ivr', 'external', 'hangup'),
      defaultValue: 'hangup',
      comment: 'Type of timeout destination'
    },
    greeting_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'greetings',
        key: 'id'
      },
      comment: 'Optional greeting to play before entering queue (overrides org default)'
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'paused'),
      defaultValue: 'active'
    }
  }, {
    tableName: 'queues',
    timestamps: true,
    underscored: true
  });

  return Queue;
};
