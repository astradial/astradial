const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const QueueMember = sequelize.define('QueueMember', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    queue_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'queues',
        key: 'id'
      }
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    penalty: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 10
      }
    },
    paused: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    paused_reason: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ring_inuse: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Ring member when already in use'
    }
  }, {
    tableName: 'queue_members',
    timestamps: true,
    underscored: true,
    createdAt: 'added_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['queue_id']
      },
      {
        fields: ['user_id']
      },
      {
        fields: ['queue_id', 'user_id'],
        unique: true
      }
    ]
  });

  // Instance methods
  QueueMember.prototype.getAsteriskMemberString = function() {
    // Returns format: PJSIP/endpoint,penalty,paused,membername
    const endpoint = this.User?.asterisk_endpoint || `ext_${this.user_id.substring(0, 8)}`;
    const memberName = this.User?.full_name || this.User?.username || 'Unknown';
    return `PJSIP/${endpoint},${this.penalty},${this.paused ? '1' : '0'},"${memberName}"`;
  };

  QueueMember.prototype.isActive = function() {
    return !this.paused && this.User?.status === 'active';
  };

  return QueueMember;
};