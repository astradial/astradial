'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addColumn('campaigns', 'max_concurrent_calls', {
        type: Sequelize.SMALLINT,
        allowNull: true,
        defaultValue: 10,
      });
    } catch (e) {
      console.log(`      (add max_concurrent_calls skipped: ${e.message.slice(0, 80)})`);
    }

    try {
      await queryInterface.addColumn('campaigns', 'max_sends_per_minute', {
        type: Sequelize.SMALLINT,
        allowNull: true,
      });
    } catch (e) {
      console.log(`      (add max_sends_per_minute skipped: ${e.message.slice(0, 80)})`);
    }

    try {
      await queryInterface.addColumn('campaigns', 'avg_call_seconds', {
        type: Sequelize.SMALLINT,
        allowNull: false,
        defaultValue: 180,
      });
    } catch (e) {
      console.log(`      (add avg_call_seconds skipped: ${e.message.slice(0, 80)})`);
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeColumn('campaigns', 'avg_call_seconds');
    } catch (e) {
      console.log(`      (remove avg_call_seconds skipped: ${e.message.slice(0, 80)})`);
    }

    try {
      await queryInterface.removeColumn('campaigns', 'max_sends_per_minute');
    } catch (e) {
      console.log(`      (remove max_sends_per_minute skipped: ${e.message.slice(0, 80)})`);
    }

    try {
      await queryInterface.removeColumn('campaigns', 'max_concurrent_calls');
    } catch (e) {
      console.log(`      (remove max_concurrent_calls skipped: ${e.message.slice(0, 80)})`);
    }
  },
};
