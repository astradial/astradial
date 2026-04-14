'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('webhooks', {
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
      url: {
        type: Sequelize.STRING,
        allowNull: false
      },
      events: {
        type: Sequelize.JSON,
        defaultValue: [],
        allowNull: false
      },
      secret: {
        type: Sequelize.STRING,
        allowNull: true
      },
      active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      retry_count: {
        type: Sequelize.INTEGER,
        defaultValue: 3,
        allowNull: false
      },
      timeout: {
        type: Sequelize.INTEGER,
        defaultValue: 30,
        allowNull: false
      },
      last_delivery: {
        type: Sequelize.DATE,
        allowNull: true
      },
      last_status: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      failure_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      headers: {
        type: Sequelize.JSON,
        defaultValue: {},
        allowNull: false
      },
      delivery_method: {
        type: Sequelize.ENUM('POST', 'PUT', 'PATCH'),
        defaultValue: 'POST',
        allowNull: false
      },
      content_type: {
        type: Sequelize.ENUM('application/json', 'application/x-www-form-urlencoded'),
        defaultValue: 'application/json',
        allowNull: false
      },
      ssl_verify: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      rate_limit: {
        type: Sequelize.JSON,
        defaultValue: {
          enabled: false,
          max_requests: 100,
          window_seconds: 60
        },
        allowNull: false
      },
      statistics: {
        type: Sequelize.JSON,
        defaultValue: {
          total_deliveries: 0,
          successful_deliveries: 0,
          failed_deliveries: 0,
          avg_response_time: 0,
          last_success: null,
          last_failure: null
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
    await queryInterface.addIndex('webhooks', ['org_id']);
    await queryInterface.addIndex('webhooks', ['active']);
    await queryInterface.addIndex('webhooks', ['last_delivery']);
    await queryInterface.addIndex('webhooks', ['last_status']);
    await queryInterface.addIndex('webhooks', ['failure_count']);
    await queryInterface.addIndex('webhooks', ['url']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('webhooks');
  }
};