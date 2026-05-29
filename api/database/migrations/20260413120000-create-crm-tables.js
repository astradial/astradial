'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Companies
    await queryInterface.createTable('crm_companies', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      name: { type: Sequelize.STRING, allowNull: false },
      industry: { type: Sequelize.STRING, allowNull: true },
      size: { type: Sequelize.ENUM('1-10', '11-50', '51-200', '201-500', '500+'), allowNull: true },
      phone: { type: Sequelize.STRING, allowNull: true },
      email: { type: Sequelize.STRING, allowNull: true },
      website: { type: Sequelize.STRING, allowNull: true },
      address: { type: Sequelize.TEXT, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      assigned_to: { type: Sequelize.UUID, allowNull: true, comment: 'org_users UUID' },
      created_by: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('crm_companies', ['org_id']);
    await queryInterface.addIndex('crm_companies', ['assigned_to']);

    // 2. Contacts (People)
    await queryInterface.createTable('crm_contacts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      company_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'crm_companies', key: 'id' }, onDelete: 'SET NULL' },
      first_name: { type: Sequelize.STRING, allowNull: false },
      last_name: { type: Sequelize.STRING, allowNull: true },
      email: { type: Sequelize.STRING, allowNull: true },
      phone: { type: Sequelize.STRING, allowNull: true },
      job_title: { type: Sequelize.STRING, allowNull: true },
      lead_source: { type: Sequelize.ENUM('website', 'phone', 'referral', 'social', 'advertisement', 'cold_call', 'event', 'other'), allowNull: true },
      lead_status: { type: Sequelize.ENUM('new', 'contacted', 'qualified', 'converted', 'lost'), defaultValue: 'new' },
      notes: { type: Sequelize.TEXT, allowNull: true },
      assigned_to: { type: Sequelize.UUID, allowNull: true, comment: 'org_users UUID' },
      created_by: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('crm_contacts', ['org_id']);
    await queryInterface.addIndex('crm_contacts', ['company_id']);
    await queryInterface.addIndex('crm_contacts', ['lead_status']);
    await queryInterface.addIndex('crm_contacts', ['assigned_to']);
    await queryInterface.addIndex('crm_contacts', ['phone']);

    // 3. Deals
    await queryInterface.createTable('crm_deals', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      company_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'crm_companies', key: 'id' }, onDelete: 'SET NULL' },
      contact_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'crm_contacts', key: 'id' }, onDelete: 'SET NULL' },
      title: { type: Sequelize.STRING, allowNull: false },
      stage: { type: Sequelize.ENUM('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'), defaultValue: 'lead' },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      currency: { type: Sequelize.STRING(3), defaultValue: 'INR' },
      expected_close: { type: Sequelize.DATEONLY, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      assigned_to: { type: Sequelize.UUID, allowNull: true, comment: 'org_users UUID' },
      created_by: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('crm_deals', ['org_id']);
    await queryInterface.addIndex('crm_deals', ['stage']);
    await queryInterface.addIndex('crm_deals', ['company_id']);
    await queryInterface.addIndex('crm_deals', ['contact_id']);
    await queryInterface.addIndex('crm_deals', ['assigned_to']);

    // 4. Activities (notes, calls, meetings, tasks)
    await queryInterface.createTable('crm_activities', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      contact_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'crm_contacts', key: 'id' }, onDelete: 'CASCADE' },
      company_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'crm_companies', key: 'id' }, onDelete: 'CASCADE' },
      deal_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'crm_deals', key: 'id' }, onDelete: 'CASCADE' },
      type: { type: Sequelize.ENUM('note', 'call', 'email', 'meeting', 'task'), allowNull: false },
      subject: { type: Sequelize.STRING, allowNull: true },
      body: { type: Sequelize.TEXT, allowNull: true },
      due_date: { type: Sequelize.DATE, allowNull: true },
      completed: { type: Sequelize.BOOLEAN, defaultValue: false },
      assigned_to: { type: Sequelize.UUID, allowNull: true },
      created_by: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('crm_activities', ['org_id']);
    await queryInterface.addIndex('crm_activities', ['contact_id']);
    await queryInterface.addIndex('crm_activities', ['company_id']);
    await queryInterface.addIndex('crm_activities', ['deal_id']);
    await queryInterface.addIndex('crm_activities', ['type']);

    // 5. Custom field definitions
    await queryInterface.createTable('crm_custom_fields', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      entity_type: { type: Sequelize.ENUM('contact', 'company', 'deal'), allowNull: false },
      field_name: { type: Sequelize.STRING, allowNull: false },
      field_label: { type: Sequelize.STRING, allowNull: false },
      field_type: { type: Sequelize.ENUM('text', 'number', 'date', 'select', 'checkbox', 'email', 'phone', 'url', 'textarea'), allowNull: false },
      options: { type: Sequelize.JSON, allowNull: true, comment: 'Options for select fields' },
      required: { type: Sequelize.BOOLEAN, defaultValue: false },
      sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('crm_custom_fields', ['org_id', 'entity_type']);
    await queryInterface.addIndex('crm_custom_fields', { fields: ['org_id', 'entity_type', 'field_name'], unique: true });

    // 6. Custom field values
    await queryInterface.createTable('crm_custom_field_values', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      field_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'crm_custom_fields', key: 'id' }, onDelete: 'CASCADE' },
      entity_id: { type: Sequelize.UUID, allowNull: false, comment: 'FK to contact/company/deal depending on field entity_type' },
      value: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('crm_custom_field_values', ['field_id']);
    await queryInterface.addIndex('crm_custom_field_values', { fields: ['field_id', 'entity_id'], unique: true });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('crm_custom_field_values');
    await queryInterface.dropTable('crm_custom_fields');
    await queryInterface.dropTable('crm_activities');
    await queryInterface.dropTable('crm_deals');
    await queryInterface.dropTable('crm_contacts');
    await queryInterface.dropTable('crm_companies');
  },
};
