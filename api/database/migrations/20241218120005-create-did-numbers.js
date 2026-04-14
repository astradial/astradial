'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('did_numbers', {
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
      number: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      description: {
        type: Sequelize.STRING,
        allowNull: true
      },
      routing_type: {
        type: Sequelize.ENUM('extension', 'queue', 'ivr', 'conference', 'voicemail', 'external', 'routing_rule'),
        allowNull: false
      },
      routing_destination: {
        type: Sequelize.STRING,
        allowNull: false
      },
      recording_enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'ported', 'suspended'),
        defaultValue: 'active',
        allowNull: false
      },
      asterisk_extension: {
        type: Sequelize.STRING,
        allowNull: true
      },
      call_limit: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      caller_id_name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      caller_id_number: {
        type: Sequelize.STRING,
        allowNull: true
      },
      inbound_routing: {
        type: Sequelize.JSON,
        defaultValue: {
          enabled: true,
          business_hours: {
            action: 'route_to_destination',
            destination: null
          },
          after_hours: {
            action: 'voicemail',
            destination: null
          },
          busy: {
            action: 'voicemail',
            destination: null
          },
          no_answer: {
            action: 'voicemail',
            destination: null,
            timeout: 30
          }
        },
        allowNull: false
      },
      emergency_routing: {
        type: Sequelize.JSON,
        defaultValue: {
          enabled: false,
          action: 'route_to_destination',
          destination: null,
          priority: 1
        },
        allowNull: false
      },
      analytics: {
        type: Sequelize.JSON,
        defaultValue: {
          total_calls: 0,
          answered_calls: 0,
          missed_calls: 0,
          average_call_duration: 0,
          last_call_date: null
        },
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
    await queryInterface.addIndex('did_numbers', ['org_id']);
    await queryInterface.addIndex('did_numbers', ['trunk_id']);
    await queryInterface.addIndex('did_numbers', ['number'], { unique: true });
    await queryInterface.addIndex('did_numbers', ['org_id', 'number'], { unique: true });
    await queryInterface.addIndex('did_numbers', ['asterisk_extension'], {
      unique: true,
      where: {
        asterisk_extension: {
          [Sequelize.Op.ne]: null
        }
      }
    });
    await queryInterface.addIndex('did_numbers', ['status']);
    await queryInterface.addIndex('did_numbers', ['routing_type']);
    await queryInterface.addIndex('did_numbers', ['routing_destination']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('did_numbers');
  }
};