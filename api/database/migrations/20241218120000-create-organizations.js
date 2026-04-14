'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('organizations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      context_prefix: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true
      },
      api_key: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      api_secret: {
        type: Sequelize.STRING,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('active', 'suspended', 'deleted'),
        defaultValue: 'active',
        allowNull: false
      },
      settings: {
        type: Sequelize.JSON,
        defaultValue: {
          timezone: 'UTC',
          date_format: 'YYYY-MM-DD',
          time_format: '24h',
          language: 'en',
          auto_recording: false,
          voicemail_enabled: true,
          call_forwarding_enabled: true,
          conference_enabled: true,
          ivr_enabled: true,
          queue_enabled: true,
          reporting_enabled: true,
          api_access: true
        },
        allowNull: false
      },
      limits: {
        type: Sequelize.JSON,
        defaultValue: {
          concurrent_calls: 100,
          monthly_minutes: 10000,
          storage_gb: 10,
          users: 50,
          did_numbers: 10,
          sip_trunks: 5,
          queues: 10,
          conferences: 5,
          recordings_retention_days: 90
        },
        allowNull: false
      },
      contact_info: {
        type: Sequelize.JSON,
        defaultValue: {
          email: '',
          phone: '',
          address: {
            street: '',
            city: '',
            state: '',
            zip: '',
            country: ''
          },
          billing: {
            company: '',
            contact_name: '',
            email: '',
            phone: ''
          }
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
    await queryInterface.addIndex('organizations', ['status']);
    await queryInterface.addIndex('organizations', ['created_at']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('organizations');
  }
};