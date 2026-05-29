'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Make org_id nullable (DIDs in pool have no org)
    await queryInterface.changeColumn('did_numbers', 'org_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'organizations', key: 'id' },
    });

    // 2. Make trunk_id nullable
    await queryInterface.changeColumn('did_numbers', 'trunk_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'sip_trunks', key: 'id' },
    });

    // 3. Make routing_type nullable (unassigned DIDs have no routing)
    await queryInterface.changeColumn('did_numbers', 'routing_type', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });

    // 4. Make routing_destination nullable
    await queryInterface.changeColumn('did_numbers', 'routing_destination', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // 5. Add pool_status
    await queryInterface.addColumn('did_numbers', 'pool_status', {
      type: Sequelize.ENUM('available', 'pending', 'assigned', 'reserved'),
      defaultValue: 'assigned', // existing DIDs are already assigned
      allowNull: false,
    });

    // 6. Add request tracking
    await queryInterface.addColumn('did_numbers', 'requested_by_org', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'organizations', key: 'id' },
      comment: 'Org that requested this DID (while pending)',
    });

    await queryInterface.addColumn('did_numbers', 'requested_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // 7. Monthly price (for display in marketplace)
    await queryInterface.addColumn('did_numbers', 'monthly_price', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Monthly cost in INR for billing display',
    });

    // 8. Region/city label
    await queryInterface.addColumn('did_numbers', 'region', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'City or region label (e.g. Bangalore, Mumbai)',
    });

    // 9. Provider label
    await queryInterface.addColumn('did_numbers', 'provider', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Trunk provider name for display (e.g. Tata, Airtel)',
    });

    // Drop the old unique index on (org_id, number) since org_id can be null now
    try {
      await queryInterface.removeIndex('did_numbers', ['org_id', 'number']);
    } catch (e) { /* index may not exist */ }

    // Add new unique index on just number (globally unique)
    await queryInterface.addIndex('did_numbers', { fields: ['number'], unique: true });
    await queryInterface.addIndex('did_numbers', ['pool_status']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('did_numbers', 'pool_status');
    await queryInterface.removeColumn('did_numbers', 'requested_by_org');
    await queryInterface.removeColumn('did_numbers', 'requested_at');
    await queryInterface.removeColumn('did_numbers', 'monthly_price');
    await queryInterface.removeColumn('did_numbers', 'region');
    await queryInterface.removeColumn('did_numbers', 'provider');

    await queryInterface.changeColumn('did_numbers', 'org_id', {
      type: Sequelize.UUID, allowNull: false,
      references: { model: 'organizations', key: 'id' },
    });
    await queryInterface.changeColumn('did_numbers', 'trunk_id', {
      type: Sequelize.UUID, allowNull: false,
      references: { model: 'sip_trunks', key: 'id' },
    });
  },
};
