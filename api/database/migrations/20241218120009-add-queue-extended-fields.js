'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add new queue configuration fields
    await queryInterface.addColumn('queues', 'announce_position_limit', {
      type: Sequelize.INTEGER,
      defaultValue: 5,
      allowNull: false,
      comment: 'Only announce position if within this limit'
    });

    await queryInterface.addColumn('queues', 'ring_sound', {
      type: Sequelize.STRING,
      defaultValue: 'ring',
      allowNull: false
    });

    await queryInterface.addColumn('queues', 'autopausedelay', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
      comment: 'Delay before auto-pausing agent (seconds)'
    });

    await queryInterface.addColumn('queues', 'autopausebusy', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Auto-pause on busy'
    });

    await queryInterface.addColumn('queues', 'autopauseunavail', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Auto-pause when unavailable'
    });

    await queryInterface.addColumn('queues', 'max_callers', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
      comment: 'Maximum callers in queue (0 = unlimited)'
    });

    await queryInterface.addColumn('queues', 'periodic_announce', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Periodic announcement audio file'
    });

    await queryInterface.addColumn('queues', 'periodic_announce_frequency', {
      type: Sequelize.INTEGER,
      defaultValue: 60,
      allowNull: false,
      comment: 'How often to play periodic announcement (seconds)'
    });

    await queryInterface.addColumn('queues', 'min_announce_frequency', {
      type: Sequelize.INTEGER,
      defaultValue: 15,
      allowNull: false,
      comment: 'Minimum time between announcements (seconds)'
    });

    await queryInterface.addColumn('queues', 'relative_periodic_announce', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Reset periodic announce timer on each announcement'
    });

    await queryInterface.addColumn('queues', 'queue_youarenext', {
      type: Sequelize.STRING,
      defaultValue: 'queue-youarenext',
      allowNull: false,
      comment: 'Audio file: You are now first in line'
    });

    await queryInterface.addColumn('queues', 'queue_thereare', {
      type: Sequelize.STRING,
      defaultValue: 'queue-thereare',
      allowNull: false,
      comment: 'Audio file: There are...'
    });

    await queryInterface.addColumn('queues', 'queue_callswaiting', {
      type: Sequelize.STRING,
      defaultValue: 'queue-callswaiting',
      allowNull: false,
      comment: 'Audio file: calls waiting'
    });

    await queryInterface.addColumn('queues', 'queue_holdtime', {
      type: Sequelize.STRING,
      defaultValue: 'queue-holdtime',
      allowNull: false,
      comment: 'Audio file: The current hold time is...'
    });

    await queryInterface.addColumn('queues', 'queue_minutes', {
      type: Sequelize.STRING,
      defaultValue: 'queue-minutes',
      allowNull: false,
      comment: 'Audio file: minutes'
    });

    await queryInterface.addColumn('queues', 'queue_seconds', {
      type: Sequelize.STRING,
      defaultValue: 'queue-seconds',
      allowNull: false,
      comment: 'Audio file: seconds'
    });

    await queryInterface.addColumn('queues', 'queue_thankyou', {
      type: Sequelize.STRING,
      defaultValue: 'queue-thankyou',
      allowNull: false,
      comment: 'Audio file: Thank you for your patience'
    });

    await queryInterface.addColumn('queues', 'queue_reporthold', {
      type: Sequelize.STRING,
      defaultValue: 'queue-reporthold',
      allowNull: false,
      comment: 'Audio file: Hold time report'
    });

    await queryInterface.addColumn('queues', 'reportholdtime', {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      comment: 'Report hold time to agent'
    });

    await queryInterface.addColumn('queues', 'memberdelay', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
      comment: 'Delay before connecting to agent (seconds)'
    });

    await queryInterface.addColumn('queues', 'timeoutpriority', {
      type: Sequelize.ENUM('app', 'conf'),
      defaultValue: 'app',
      allowNull: false,
      comment: 'Priority of timeout over priority'
    });

    // Fix existing announce_position to be ENUM instead of BOOLEAN
    await queryInterface.changeColumn('queues', 'announce_position', {
      type: Sequelize.ENUM('yes', 'no', 'limit', 'more'),
      defaultValue: 'yes',
      allowNull: false,
      comment: 'Announce position in queue to caller'
    });

    // Fix join_empty and leave_when_empty - change from ENUM to BOOLEAN
    await queryInterface.changeColumn('queues', 'join_empty', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Allow callers to join when no agents available'
    });

    await queryInterface.changeColumn('queues', 'leave_when_empty', {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
      allowNull: false,
      comment: 'Remove callers when no agents available'
    });

    // Add ring_inuse column (renaming ringinuse)
    await queryInterface.addColumn('queues', 'ring_inuse', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Ring members already on a call'
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove added columns
    await queryInterface.removeColumn('queues', 'announce_position_limit');
    await queryInterface.removeColumn('queues', 'ring_sound');
    await queryInterface.removeColumn('queues', 'autopausedelay');
    await queryInterface.removeColumn('queues', 'autopausebusy');
    await queryInterface.removeColumn('queues', 'autopauseunavail');
    await queryInterface.removeColumn('queues', 'max_callers');
    await queryInterface.removeColumn('queues', 'periodic_announce');
    await queryInterface.removeColumn('queues', 'periodic_announce_frequency');
    await queryInterface.removeColumn('queues', 'min_announce_frequency');
    await queryInterface.removeColumn('queues', 'relative_periodic_announce');
    await queryInterface.removeColumn('queues', 'queue_youarenext');
    await queryInterface.removeColumn('queues', 'queue_thereare');
    await queryInterface.removeColumn('queues', 'queue_callswaiting');
    await queryInterface.removeColumn('queues', 'queue_holdtime');
    await queryInterface.removeColumn('queues', 'queue_minutes');
    await queryInterface.removeColumn('queues', 'queue_seconds');
    await queryInterface.removeColumn('queues', 'queue_thankyou');
    await queryInterface.removeColumn('queues', 'queue_reporthold');
    await queryInterface.removeColumn('queues', 'reportholdtime');
    await queryInterface.removeColumn('queues', 'memberdelay');
    await queryInterface.removeColumn('queues', 'timeoutpriority');
    await queryInterface.removeColumn('queues', 'ring_inuse');

    // Revert announce_position back to BOOLEAN
    await queryInterface.changeColumn('queues', 'announce_position', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false
    });

    // Revert join_empty and leave_when_empty back to ENUM
    await queryInterface.changeColumn('queues', 'join_empty', {
      type: Sequelize.ENUM('yes', 'no', 'strict', 'loose'),
      defaultValue: 'yes',
      allowNull: false
    });

    await queryInterface.changeColumn('queues', 'leave_when_empty', {
      type: Sequelize.ENUM('yes', 'no', 'strict', 'loose'),
      defaultValue: 'no',
      allowNull: false
    });
  }
};
