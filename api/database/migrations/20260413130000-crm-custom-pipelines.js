'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Pipeline stage config table
    await queryInterface.createTable('crm_pipeline_stages', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      pipeline: { type: Sequelize.ENUM('lead', 'deal'), allowNull: false },
      stage_key: { type: Sequelize.STRING(50), allowNull: false, comment: 'Machine-readable key' },
      stage_label: { type: Sequelize.STRING(100), allowNull: false, comment: 'Display label' },
      sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('crm_pipeline_stages', ['org_id', 'pipeline']);
    await queryInterface.addIndex('crm_pipeline_stages', { fields: ['org_id', 'pipeline', 'stage_key'], unique: true });

    // 2. Change lead_status ENUM → VARCHAR so custom stages work
    await queryInterface.changeColumn('crm_contacts', 'lead_status', {
      type: Sequelize.STRING(50),
      defaultValue: 'new',
    });

    // 3. Change deal stage ENUM → VARCHAR
    await queryInterface.changeColumn('crm_deals', 'stage', {
      type: Sequelize.STRING(50),
      defaultValue: 'lead',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('crm_pipeline_stages');
    await queryInterface.changeColumn('crm_contacts', 'lead_status', {
      type: Sequelize.ENUM('new', 'contacted', 'qualified', 'converted', 'lost'),
      defaultValue: 'new',
    });
    await queryInterface.changeColumn('crm_deals', 'stage', {
      type: Sequelize.ENUM('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'),
      defaultValue: 'lead',
    });
  },
};
