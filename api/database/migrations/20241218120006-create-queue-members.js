'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('queue_members', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      queue_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'queues',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      penalty: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      paused: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      paused_reason: {
        type: Sequelize.STRING,
        allowNull: true
      },
      ring_inuse: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      state_interface: {
        type: Sequelize.STRING,
        allowNull: true
      },
      membership: {
        type: Sequelize.ENUM('dynamic', 'static'),
        defaultValue: 'dynamic',
        allowNull: false
      },
      call_limit: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      last_call: {
        type: Sequelize.DATE,
        allowNull: true
      },
      calls_taken: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('available', 'busy', 'unavailable', 'ringing', 'in_call', 'paused'),
        defaultValue: 'available',
        allowNull: false
      },
      added_at: {
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
    await queryInterface.addIndex('queue_members', ['queue_id']);
    await queryInterface.addIndex('queue_members', ['user_id']);
    await queryInterface.addIndex('queue_members', ['queue_id', 'user_id'], { unique: true });
    await queryInterface.addIndex('queue_members', ['paused']);
    await queryInterface.addIndex('queue_members', ['penalty']);
    await queryInterface.addIndex('queue_members', ['status']);
    await queryInterface.addIndex('queue_members', ['membership']);
    await queryInterface.addIndex('queue_members', ['last_call']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('queue_members');
  }
};