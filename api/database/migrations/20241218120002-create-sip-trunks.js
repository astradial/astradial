'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('sip_trunks', {
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
      host: {
        type: Sequelize.STRING,
        allowNull: false
      },
      username: {
        type: Sequelize.STRING,
        allowNull: true
      },
      password: {
        type: Sequelize.STRING,
        allowNull: true
      },
      port: {
        type: Sequelize.INTEGER,
        defaultValue: 5060,
        allowNull: false
      },
      transport: {
        type: Sequelize.ENUM('udp', 'tcp', 'tls'),
        defaultValue: 'udp',
        allowNull: false
      },
      max_channels: {
        type: Sequelize.INTEGER,
        defaultValue: 10,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'maintenance'),
        defaultValue: 'active',
        allowNull: false
      },
      asterisk_peer_name: {
        type: Sequelize.STRING,
        allowNull: true
      },
      last_registration: {
        type: Sequelize.DATE,
        allowNull: true
      },
      registration_status: {
        type: Sequelize.ENUM('registered', 'unregistered', 'failed', 'unknown'),
        defaultValue: 'unknown',
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
    await queryInterface.addIndex('sip_trunks', ['org_id']);
    await queryInterface.addIndex('sip_trunks', ['org_id', 'name'], { unique: true });
    await queryInterface.addIndex('sip_trunks', ['asterisk_peer_name'], {
      unique: true,
      where: {
        asterisk_peer_name: {
          [Sequelize.Op.ne]: null
        }
      }
    });
    await queryInterface.addIndex('sip_trunks', ['status']);
    await queryInterface.addIndex('sip_trunks', ['registration_status']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('sip_trunks');
  }
};