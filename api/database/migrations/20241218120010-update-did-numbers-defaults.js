'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add routing_rule_id column if it doesn't exist
    await queryInterface.addColumn('did_numbers', 'routing_rule_id', {
      type: Sequelize.STRING(36),
      allowNull: true,
      defaultValue: null,
      after: 'routing_destination'
    }).catch(() => {
      // Column might already exist, ignore error
      console.log('routing_rule_id column already exists, skipping...');
    });

    // Add index for routing_rule_id
    await queryInterface.addIndex('did_numbers', ['routing_rule_id'], {
      name: 'idx_routing_rule_id'
    }).catch(() => {
      console.log('idx_routing_rule_id index already exists, skipping...');
    });

    // Set default NULL for columns that were missing defaults
    await queryInterface.changeColumn('did_numbers', 'inbound_routing', {
      type: Sequelize.TEXT('long'),
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.changeColumn('did_numbers', 'emergency_routing', {
      type: Sequelize.TEXT('long'),
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.changeColumn('did_numbers', 'analytics', {
      type: Sequelize.TEXT('long'),
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.changeColumn('did_numbers', 'configuration', {
      type: Sequelize.TEXT('long'),
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.changeColumn('did_numbers', 'asterisk_extension', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove routing_rule_id column
    await queryInterface.removeColumn('did_numbers', 'routing_rule_id');

    // Revert columns to NOT NULL (if that was the original state)
    // Note: This is a simplified rollback - adjust based on original schema
  }
};
