'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('routing_rules', {
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
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      priority: {
        type: Sequelize.INTEGER,
        defaultValue: 100,
        allowNull: false
      },
      conditions: {
        type: Sequelize.JSON,
        defaultValue: {},
        allowNull: false
      },
      action_type: {
        type: Sequelize.ENUM('transfer', 'queue', 'voicemail', 'hangup', 'ivr', 'conference', 'extension', 'external'),
        allowNull: false
      },
      action_data: {
        type: Sequelize.JSON,
        defaultValue: {},
        allowNull: false
      },
      active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      time_restrictions: {
        type: Sequelize.JSON,
        defaultValue: {
          enabled: false,
          timezone: 'UTC',
          schedule: {
            monday: { enabled: true, start: '09:00', end: '17:00' },
            tuesday: { enabled: true, start: '09:00', end: '17:00' },
            wednesday: { enabled: true, start: '09:00', end: '17:00' },
            thursday: { enabled: true, start: '09:00', end: '17:00' },
            friday: { enabled: true, start: '09:00', end: '17:00' },
            saturday: { enabled: false, start: '09:00', end: '17:00' },
            sunday: { enabled: false, start: '09:00', end: '17:00' }
          },
          holidays: []
        },
        allowNull: false
      },
      fallback_action: {
        type: Sequelize.JSON,
        defaultValue: {
          type: 'voicemail',
          data: {}
        },
        allowNull: false
      },
      match_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      last_matched: {
        type: Sequelize.DATE,
        allowNull: true
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
    await queryInterface.addIndex('routing_rules', ['org_id']);
    await queryInterface.addIndex('routing_rules', ['org_id', 'name'], { unique: true });
    await queryInterface.addIndex('routing_rules', ['org_id', 'priority']);
    await queryInterface.addIndex('routing_rules', ['action_type']);
    await queryInterface.addIndex('routing_rules', ['active']);
    await queryInterface.addIndex('routing_rules', ['priority']);
    await queryInterface.addIndex('routing_rules', ['last_matched']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('routing_rules');
  }
};