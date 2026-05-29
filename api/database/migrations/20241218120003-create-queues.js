'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('queues', {
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
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      number: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      strategy: {
        type: Sequelize.ENUM('ringall', 'roundrobin', 'leastrecent', 'fewestcalls', 'random', 'rrmemory'),
        defaultValue: 'ringall',
        allowNull: false
      },
      timeout: {
        type: Sequelize.INTEGER,
        defaultValue: 15,
        allowNull: false
      },
      max_wait_time: {
        type: Sequelize.INTEGER,
        defaultValue: 300,
        allowNull: false
      },
      music_on_hold: {
        type: Sequelize.STRING,
        defaultValue: 'default',
        allowNull: false
      },
      asterisk_queue_name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      recording_enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      wrap_up_time: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      announce_frequency: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      announce_round_seconds: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      announce_holdtime: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      announce_position: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      retry: {
        type: Sequelize.INTEGER,
        defaultValue: 5,
        allowNull: false
      },
      weight: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      autopause: {
        type: Sequelize.ENUM('yes', 'no', 'all'),
        defaultValue: 'no',
        allowNull: false
      },
      max_len: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      service_level: {
        type: Sequelize.INTEGER,
        defaultValue: 60,
        allowNull: false
      },
      join_empty: {
        type: Sequelize.ENUM('yes', 'no', 'strict', 'loose'),
        defaultValue: 'yes',
        allowNull: false
      },
      leave_when_empty: {
        type: Sequelize.ENUM('yes', 'no', 'strict', 'loose'),
        defaultValue: 'no',
        allowNull: false
      },
      ringinuse: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'paused'),
        defaultValue: 'active',
        allowNull: false
      },
      configuration: {
        type: Sequelize.JSON,
        defaultValue: {},
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
    await queryInterface.addIndex('queues', ['org_id']);
    await queryInterface.addIndex('queues', ['org_id', 'name'], { unique: true });
    await queryInterface.addIndex('queues', ['org_id', 'number'], { unique: true });
    await queryInterface.addIndex('queues', ['asterisk_queue_name'], {
      unique: true,
      where: {
        asterisk_queue_name: {
          [Sequelize.Op.ne]: null
        }
      }
    });
    await queryInterface.addIndex('queues', ['status']);
    await queryInterface.addIndex('queues', ['strategy']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('queues');
  }
};