'use strict';

// Creates the seven tables for the Campaigns feature plus every index the
// dashboard, scheduler, and webhook handlers rely on.
//
// down() drops in reverse dependency order. It refuses to run if any campaign
// is currently in flight (status not in draft/archived/completed) — the
// safety guard prevents an accidental rollback from orphaning enrolled leads.

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Templates
    await queryInterface.createTable('campaign_templates', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      name: { type: Sequelize.STRING(200), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.ENUM('draft', 'published', 'archived'), defaultValue: 'draft' },
      version: { type: Sequelize.INTEGER, defaultValue: 1 },
      workflow: { type: Sequelize.JSON, allowNull: false },
      created_by: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('campaign_templates', ['org_id', 'status']);

    // 2. Campaigns
    await queryInterface.createTable('campaigns', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      name: { type: Sequelize.STRING(200), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      template_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'campaign_templates', key: 'id' }, onDelete: 'SET NULL' },
      template_snapshot: { type: Sequelize.JSON, allowNull: true },
      owner_user_id: { type: Sequelize.UUID, allowNull: true },
      status: {
        type: Sequelize.ENUM('draft', 'scheduled', 'running', 'paused', 'completed', 'archived'),
        defaultValue: 'draft',
      },
      start_at: { type: Sequelize.DATE, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: true },
      paused_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      stats: { type: Sequelize.JSON, allowNull: false },
      created_by: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('campaigns', ['org_id', 'status']);
    await queryInterface.addIndex('campaigns', ['org_id', 'owner_user_id']);

    // 3. Campaign leads
    await queryInterface.createTable('campaign_leads', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      campaign_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(200), allowNull: false },
      phone: { type: Sequelize.STRING(32), allowNull: false },
      country: { type: Sequelize.STRING(8), allowNull: true },
      business: { type: Sequelize.STRING(200), allowNull: true },
      source: { type: Sequelize.ENUM('csv', 'webform', 'api', 'manual'), defaultValue: 'manual' },
      status: {
        type: Sequelize.ENUM('raw', 'contacted', 'engaged', 'interested', 'qualified', 'disqualified', 'dnc'),
        defaultValue: 'raw',
      },
      custom_fields: { type: Sequelize.JSON, allowNull: false },
      custom_fields_schema_version: { type: Sequelize.INTEGER, defaultValue: 1 },
      intent_score: { type: Sequelize.SMALLINT, defaultValue: 0 },
      last_touch_at: { type: Sequelize.DATE, allowNull: true },
      current_node_id: { type: Sequelize.STRING(64), allowNull: true },
      crm_contact_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'crm_contacts', key: 'id' }, onDelete: 'SET NULL' },
      enrolled_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('campaign_leads', ['org_id', 'campaign_id', 'status']);
    await queryInterface.addIndex('campaign_leads', { fields: ['org_id', 'campaign_id', 'phone'], unique: true });
    await queryInterface.addIndex('campaign_leads', ['org_id', 'campaign_id', 'status', 'last_touch_at']);
    await queryInterface.addIndex('campaign_leads', ['org_id', 'phone']);
    await queryInterface.addIndex('campaign_leads', ['crm_contact_id']);

    // 4. Campaign lead runs (scheduler state)
    await queryInterface.createTable('campaign_lead_runs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      campaign_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
      campaign_lead_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'campaign_leads', key: 'id' }, onDelete: 'CASCADE' },
      current_day_index: { type: Sequelize.INTEGER, defaultValue: 0 },
      current_action_index: { type: Sequelize.INTEGER, defaultValue: 0 },
      next_run_at: { type: Sequelize.DATE, allowNull: false },
      status: {
        type: Sequelize.ENUM('pending', 'waiting', 'halted', 'completed', 'failed'),
        defaultValue: 'pending',
      },
      halted_at: { type: Sequelize.DATE, allowNull: true },
      locked_at: { type: Sequelize.DATE, allowNull: true },
      locked_by: { type: Sequelize.STRING(64), allowNull: true },
      attempts: { type: Sequelize.TINYINT, defaultValue: 0 },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    // Leading-`status` filters out most rows before the time-range scan.
    await queryInterface.addIndex('campaign_lead_runs', ['status', 'next_run_at', 'org_id']);
    await queryInterface.addIndex('campaign_lead_runs', ['campaign_lead_id']);
    await queryInterface.addIndex('campaign_lead_runs', ['locked_at', 'locked_by']);

    // 5. Campaign events (append-only)
    await queryInterface.createTable('campaign_events', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      campaign_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
      campaign_lead_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'campaign_leads', key: 'id' }, onDelete: 'CASCADE' },
      kind: {
        type: Sequelize.ENUM(
          'enrolled',
          'whatsapp_sent', 'whatsapp_delivered', 'whatsapp_replied',
          'call_started', 'call_completed', 'call_failed',
          'status_changed',
          'qualified', 'disqualified', 'halted',
          'approval_created', 'approval_decided'
        ),
        allowNull: false,
      },
      node_id: { type: Sequelize.STRING(64), allowNull: true },
      idempotency_key: { type: Sequelize.STRING(128), allowNull: true },
      payload: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('campaign_events', { fields: ['idempotency_key'], unique: true });
    await queryInterface.addIndex('campaign_events', ['campaign_lead_id', 'created_at']);
    await queryInterface.addIndex('campaign_events', ['campaign_id', 'created_at']);
    await queryInterface.addIndex('campaign_events', ['org_id', 'created_at']);

    // 6. Lead-field config (org-wide)
    await queryInterface.createTable('campaign_lead_fields', {
      id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      label: { type: Sequelize.STRING(120), allowNull: false },
      type: {
        type: Sequelize.ENUM(
          'text', 'number', 'select', 'multi', 'date', 'datetime',
          'phone', 'email', 'url', 'boolean', 'currency', 'identifier'
        ),
        allowNull: false,
      },
      description: { type: Sequelize.STRING(255), allowNull: true },
      options: { type: Sequelize.JSON, allowNull: true },
      required: { type: Sequelize.BOOLEAN, defaultValue: false },
      is_system: { type: Sequelize.BOOLEAN, defaultValue: false },
      is_deleted: { type: Sequelize.BOOLEAN, defaultValue: false },
      sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('campaign_lead_fields', ['org_id', 'sort_order']);
    await queryInterface.addIndex('campaign_lead_fields', ['org_id', 'is_deleted']);

    // 7. Approvals queue
    await queryInterface.createTable('campaign_approvals', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      org_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'organizations', key: 'id' } },
      campaign_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'campaigns', key: 'id' }, onDelete: 'CASCADE' },
      campaign_lead_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'campaign_leads', key: 'id' }, onDelete: 'CASCADE' },
      channel: { type: Sequelize.ENUM('whatsapp', 'call'), allowNull: false },
      node_id: { type: Sequelize.STRING(64), allowNull: true },
      draft: { type: Sequelize.TEXT, allowNull: true },
      reasoning: { type: Sequelize.TEXT, allowNull: true },
      context: { type: Sequelize.JSON, allowNull: true },
      sla_at: { type: Sequelize.DATE, allowNull: true },
      status: { type: Sequelize.ENUM('pending', 'approved', 'rejected', 'expired'), defaultValue: 'pending' },
      decided_by: { type: Sequelize.UUID, allowNull: true },
      decided_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('campaign_approvals', ['org_id', 'status', 'sla_at']);
    await queryInterface.addIndex('campaign_approvals', ['campaign_id', 'status']);
  },

  down: async (queryInterface, Sequelize) => {
    // Refuse rollback if any campaign is in flight.
    const [rows] = await queryInterface.sequelize.query(
      "SELECT COUNT(*) AS n FROM campaigns WHERE status NOT IN ('draft','archived','completed')"
    );
    const inFlight = Number(rows[0]?.n || 0);
    if (inFlight > 0) {
      throw new Error(
        `Refusing to drop campaign tables: ${inFlight} campaigns are still in flight. ` +
        'Pause or archive them, then re-run the rollback.'
      );
    }

    await queryInterface.dropTable('campaign_approvals');
    await queryInterface.dropTable('campaign_lead_fields');
    await queryInterface.dropTable('campaign_events');
    await queryInterface.dropTable('campaign_lead_runs');
    await queryInterface.dropTable('campaign_leads');
    await queryInterface.dropTable('campaigns');
    await queryInterface.dropTable('campaign_templates');
  },
};
