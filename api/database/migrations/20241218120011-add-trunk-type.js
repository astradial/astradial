'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add trunk_type column with three types: inbound, outbound, peer2peer
    await queryInterface.addColumn('sip_trunks', 'trunk_type', {
      type: Sequelize.ENUM('inbound', 'outbound', 'peer2peer'),
      defaultValue: 'outbound',
      allowNull: false,
      after: 'transport'
    });

    // Add retry_interval for inbound registration trunks
    await queryInterface.addColumn('sip_trunks', 'retry_interval', {
      type: Sequelize.INTEGER,
      defaultValue: 60,
      allowNull: true,
      after: 'trunk_type',
      comment: 'Registration retry interval in seconds (for inbound type)'
    });

    // Add expiration for inbound registration trunks
    await queryInterface.addColumn('sip_trunks', 'expiration', {
      type: Sequelize.INTEGER,
      defaultValue: 3600,
      allowNull: true,
      after: 'retry_interval',
      comment: 'Registration expiration time in seconds (for inbound type)'
    });

    // Add contact_user for inbound registration
    await queryInterface.addColumn('sip_trunks', 'contact_user', {
      type: Sequelize.STRING,
      allowNull: true,
      after: 'expiration',
      comment: 'Contact user for registration (defaults to username if not set)'
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove columns in reverse order
    await queryInterface.removeColumn('sip_trunks', 'contact_user');
    await queryInterface.removeColumn('sip_trunks', 'expiration');
    await queryInterface.removeColumn('sip_trunks', 'retry_interval');
    await queryInterface.removeColumn('sip_trunks', 'trunk_type');
  }
};
