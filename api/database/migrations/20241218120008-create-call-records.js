'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('call_records', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      org_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'organizations',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      call_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      channel_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      from_number: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      to_number: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      caller_id_name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      direction: {
        type: Sequelize.ENUM('inbound', 'outbound', 'internal'),
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('initiated', 'ringing', 'answered', 'busy', 'no_answer', 'failed', 'cancelled', 'completed'),
        allowNull: false
      },
      trunk_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'sip_trunks',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      queue_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'queues',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      answered_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      duration: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: 'Total call duration in seconds'
      },
      talk_time: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: 'Actual talk time in seconds'
      },
      wait_time: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: 'Time waiting in queue in seconds'
      },
      recording_url: {
        type: Sequelize.STRING,
        allowNull: true
      },
      recording_file: {
        type: Sequelize.STRING,
        allowNull: true
      },
      hangup_cause: {
        type: Sequelize.STRING,
        allowNull: true
      },
      cost: {
        type: Sequelize.DECIMAL(10, 4),
        defaultValue: 0.0000,
        allowNull: false
      },
      variables: {
        type: Sequelize.JSON,
        defaultValue: {},
        allowNull: false
      },
      asterisk_uniqueid: {
        type: Sequelize.STRING,
        allowNull: true
      },
      asterisk_linkedid: {
        type: Sequelize.STRING,
        allowNull: true
      },
      source_ip: {
        type: Sequelize.STRING,
        allowNull: true
      },
      user_agent: {
        type: Sequelize.STRING,
        allowNull: true
      },
      codec: {
        type: Sequelize.STRING,
        allowNull: true
      },
      quality_score: {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: true,
        comment: 'Call quality score from 0.00 to 10.00'
      },
      transfer_info: {
        type: Sequelize.JSON,
        defaultValue: {},
        allowNull: false
      },
      conference_info: {
        type: Sequelize.JSON,
        defaultValue: {},
        allowNull: false
      },
      billing_info: {
        type: Sequelize.JSON,
        defaultValue: {
          rate_per_minute: 0,
          total_cost: 0,
          currency: 'USD',
          provider: null
        },
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Add indexes
    await queryInterface.addIndex('call_records', ['org_id']);
    await queryInterface.addIndex('call_records', ['call_id'], { unique: true });
    await queryInterface.addIndex('call_records', ['org_id', 'call_id'], { unique: true });
    await queryInterface.addIndex('call_records', ['channel_id']);
    await queryInterface.addIndex('call_records', ['from_number']);
    await queryInterface.addIndex('call_records', ['to_number']);
    await queryInterface.addIndex('call_records', ['direction']);
    await queryInterface.addIndex('call_records', ['status']);
    await queryInterface.addIndex('call_records', ['trunk_id']);
    await queryInterface.addIndex('call_records', ['user_id']);
    await queryInterface.addIndex('call_records', ['queue_id']);
    await queryInterface.addIndex('call_records', ['started_at']);
    await queryInterface.addIndex('call_records', ['answered_at']);
    await queryInterface.addIndex('call_records', ['ended_at']);
    await queryInterface.addIndex('call_records', ['duration']);
    await queryInterface.addIndex('call_records', ['asterisk_uniqueid']);
    await queryInterface.addIndex('call_records', ['asterisk_linkedid']);
    await queryInterface.addIndex('call_records', ['hangup_cause']);

    // Composite indexes for common queries
    await queryInterface.addIndex('call_records', ['org_id', 'started_at']);
    await queryInterface.addIndex('call_records', ['org_id', 'direction', 'started_at']);
    await queryInterface.addIndex('call_records', ['org_id', 'status', 'started_at']);
    await queryInterface.addIndex('call_records', ['user_id', 'started_at']);
    await queryInterface.addIndex('call_records', ['queue_id', 'started_at']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('call_records');
  }
};