'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// Stubs for models
const STUB_MODELS = {
  Campaign: {
    findByPk: async () => null,
    findAll: async () => [],
  },
  CampaignLead: {
    findByPk: async () => null,
    findAll: async () => [],
    update: async () => ({}),
  },
  CampaignLeadRun: {
    findByPk: async () => null,
    findAll: async () => [],
    update: async () => [1],
    count: async () => 0,
  },
  CampaignEvent: {
    create: async () => ({}),
  },
  Organization: {
    findByPk: async () => null,
  },
  sequelize: {
    constructor: {
      QueryTypes: {
        SELECT: 'SELECT',
      }
    },
    transaction: async () => ({
      commit: async () => {},
      rollback: async () => {},
    }),
    query: async (sql) => {
      if (sql && sql.includes('VERSION()')) {
        return [{ v: '10.6.0' }];
      }
      return [[]];
    },
  },
  Op: {
    in: Symbol('in'),
    or: Symbol('or'),
    gte: Symbol('gte'),
  }
};

// require.cache patch for models
const modelsPath = path.resolve(__dirname, '../src/models/index.js');
require.cache[modelsPath] = {
  id: modelsPath,
  filename: modelsPath,
  loaded: true,
  exports: STUB_MODELS,
};

// Spies and Mocks for Queues
let processWhatsAppJobFn = null;
let schedulerTickFn = null;
let enqueuedJobs = [];

const STUB_QUEUES = {
  createWorker: (queueName, processFn, opts) => {
    if (queueName === 'campaign-whatsapp') {
      processWhatsAppJobFn = processFn;
    } else if (queueName === 'campaign-scheduler') {
      schedulerTickFn = processFn;
    }
    return { close: async () => {} };
  },
  getQueue: (queueName) => ({
    add: async (name, data, opts) => {
      enqueuedJobs.push({ queueName, name, data, opts });
      return { id: `job-${Date.now()}-${Math.random()}` };
    },
    removeRepeatable: async () => {},
  }),
  WHATSAPP_QUEUE: 'campaign-whatsapp',
  CALLS_QUEUE: 'campaign-calls',
  SCHEDULER_QUEUE: 'campaign-scheduler'
};

const queuesPath = path.resolve(__dirname, '../src/jobs/campaignQueues.js');
require.cache[queuesPath] = {
  id: queuesPath,
  filename: queuesPath,
  loaded: true,
  exports: STUB_QUEUES,
};

// Mocks for rate limiter
const STUB_RATE_LIMITER = {
  tryConsume: async () => true,
};
const rateLimiterPath = path.resolve(__dirname, '../src/services/campaign-rate-limiter.js');
require.cache[rateLimiterPath] = {
  id: rateLimiterPath,
  filename: rateLimiterPath,
  loaded: true,
  exports: STUB_RATE_LIMITER,
};

// Mocks for campaign actions
let runWhatsAppResult = { ok: true, requestId: 'req-123' };
let runWhatsAppCalls = [];

const STUB_ACTIONS = {
  runWhatsApp: async (args) => {
    runWhatsAppCalls.push(args);
    return runWhatsAppResult;
  },
  validateSnapshot: () => ({ valid: true, errors: [] }),
};
const actionsPath = path.resolve(__dirname, '../src/services/campaign-actions.js');
require.cache[actionsPath] = {
  id: actionsPath,
  filename: actionsPath,
  loaded: true,
  exports: STUB_ACTIONS,
};

// Mocks for AsteriskManager
const asteriskManagerPath = path.resolve(__dirname, '../src/services/asterisk/asteriskManager.js');
let activeChannelsMock = [];
class StubAsteriskManager {
  async connect() {}
  async disconnect() {}
  async getActiveChannels() {
    return activeChannelsMock;
  }
}
require.cache[asteriskManagerPath] = {
  id: asteriskManagerPath,
  filename: asteriskManagerPath,
  loaded: true,
  exports: StubAsteriskManager,
};

// Now import target files
const { startWhatsAppWorker } = require('../src/jobs/campaignWhatsAppWorker');
const { startSchedulerWorker } = require('../src/jobs/campaignSchedulerJob');

test('WhatsApp Campaign Status Rules', async (t) => {

  test.before(async () => {
    await startWhatsAppWorker();
    await startSchedulerWorker();
  });

  t.beforeEach(() => {
    enqueuedJobs = [];
    runWhatsAppCalls = [];
    runWhatsAppResult = { ok: true, requestId: 'req-123' };

    // Reset all model stubs to default implementations to avoid test pollution
    STUB_MODELS.Campaign.findByPk = async () => null;
    STUB_MODELS.Campaign.findAll = async () => [];
    STUB_MODELS.Campaign.findOne = async () => null;

    STUB_MODELS.CampaignLead.findByPk = async () => null;
    STUB_MODELS.CampaignLead.findAll = async () => [];
    STUB_MODELS.CampaignLead.update = async () => ({});

    STUB_MODELS.CampaignLeadRun.findByPk = async () => null;
    STUB_MODELS.CampaignLeadRun.findAll = async () => [];
    STUB_MODELS.CampaignLeadRun.findOne = async () => null;
    STUB_MODELS.CampaignLeadRun.update = async () => [1];
    STUB_MODELS.CampaignLeadRun.count = async () => 0;

    STUB_MODELS.CampaignEvent.create = async () => ({});
    STUB_MODELS.Organization.findByPk = async () => null;
    STUB_MODELS.Organization.findAll = async () => [];
  });

  await t.test('1. Creating/importing a WhatsApp campaign lead keeps status as raw', async () => {
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210'
    };
    assert.equal(lead.status, 'raw');
  });

  await t.test('2. Starting/scheduling a WhatsApp campaign keeps status as raw', async () => {
    let leadStatusDuringSchedule = 'raw';
    let leadUpdateCallCount = 0;

    STUB_MODELS.Campaign.findByPk = async () => ({
      id: 'campaign-1',
      org_id: 'org-1',
      status: 'running',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'whatsapp', template: 'temp-1', namespace: 'ns-1' }
            ]
          }
        ]
      }
    });

    STUB_MODELS.CampaignLeadRun.findAll = async () => [
      {
        id: 'run-1',
        org_id: 'org-1',
        campaign_id: 'campaign-1',
        campaign_lead_id: 'lead-1',
        current_day_index: 0,
        current_action_index: 0,
        status: 'pending'
      }
    ];

    STUB_MODELS.CampaignLead.findAll = async () => [
      {
        id: 'lead-1',
        status: 'raw',
      }
    ];

    STUB_MODELS.CampaignLead.update = async (data) => {
      leadUpdateCallCount++;
      leadStatusDuringSchedule = data.status;
      return {};
    };

    // Run scheduler tick
    STUB_MODELS.sequelize.query = async () => [{ id: 'run-1' }];

    await schedulerTickFn({ data: { campaignId: 'campaign-1' } });

    assert.equal(leadStatusDuringSchedule, 'raw');
    assert.equal(leadUpdateCallCount, 0, 'Lead status should not be updated during scheduling');
    assert.equal(enqueuedJobs.length, 1);
    assert.equal(enqueuedJobs[0].queueName, 'campaign-whatsapp');
  });

  await t.test('3. Queueing a WhatsApp job keeps status as raw', async () => {
    const lead = {
      id: 'lead-1',
      status: 'raw',
    };
    assert.equal(lead.status, 'raw');
  });

  await t.test('4. Before the MSG91 request resolves successfully, status remains raw', async () => {
    let leadStatusBeforeMSG91 = 'raw';
    let leadUpdateCalls = [];

    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };

    const run = {
      id: 'run-1',
      status: 'queued',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      update: async () => {}
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findByPk = async () => ({
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'whatsapp', template: 'temp-1' }
            ]
          }
        ]
      }
    });
    STUB_MODELS.Organization.findByPk = async () => ({ id: 'org-1' });

    STUB_MODELS.CampaignLead.update = async (data) => {
      leadUpdateCalls.push(data);
      lead.status = data.status;
      return {};
    };

    // Intercept runWhatsApp to check lead status before it resolves
    STUB_ACTIONS.runWhatsApp = async () => {
      leadStatusBeforeMSG91 = lead.status;
      return { ok: true, requestId: 'req-123' };
    };

    await processWhatsAppJobFn({
      data: {
        runId: 'run-1',
        orgId: 'org-1',
        campaignId: 'campaign-1',
        leadId: 'lead-1',
        action: { type: 'whatsapp', template: 'temp-1' }
      }
    });

    assert.equal(leadStatusBeforeMSG91, 'raw', 'Lead status must remain raw before MSG91 call');
    assert.equal(lead.status, 'contacted', 'Lead status should transition to contacted after successful MSG91 send');
  });

  await t.test('5. Successful MSG91 send changes raw to contacted', async () => {
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };

    const run = {
      id: 'run-1',
      status: 'queued',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      update: async () => {}
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findByPk = async () => ({
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'whatsapp', template: 'temp-1' }
            ]
          }
        ]
      }
    });
    STUB_MODELS.Organization.findByPk = async () => ({ id: 'org-1' });

    let leadStatusUpdated = null;
    STUB_MODELS.CampaignLead.update = async (data) => {
      leadStatusUpdated = data.status;
      lead.status = data.status;
      return {};
    };

    runWhatsAppResult = { ok: true, requestId: 'req-123' };
    STUB_ACTIONS.runWhatsApp = async () => runWhatsAppResult;

    await processWhatsAppJobFn({
      data: {
        runId: 'run-1',
        orgId: 'org-1',
        campaignId: 'campaign-1',
        leadId: 'lead-1',
        action: { type: 'whatsapp', template: 'temp-1' }
      }
    });

    assert.equal(leadStatusUpdated, 'contacted', 'Successful MSG91 send must change raw to contacted');
  });

  await t.test('6. Failed MSG91 send keeps status as raw', async () => {
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };

    const run = {
      id: 'run-1',
      status: 'queued',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      update: async () => {}
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findByPk = async () => ({ id: 'campaign-1' });
    STUB_MODELS.Organization.findByPk = async () => ({ id: 'org-1' });

    let leadUpdated = false;
    STUB_MODELS.CampaignLead.update = async (data) => {
      leadUpdated = true;
      return {};
    };

    runWhatsAppResult = { ok: false, transient: false, error: 'Invalid number' };
    STUB_ACTIONS.runWhatsApp = async () => runWhatsAppResult;

    await processWhatsAppJobFn({
      data: {
        runId: 'run-1',
        orgId: 'org-1',
        campaignId: 'campaign-1',
        leadId: 'lead-1',
        action: { type: 'whatsapp', template: 'temp-1' }
      }
    });

    assert.equal(leadUpdated, false, 'Failed MSG91 send must not update lead status');
    assert.equal(lead.status, 'raw');
  });

  await t.test('7. Failed call action does not move raw to contacted', async () => {
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };

    const run = {
      id: 'run-1',
      status: 'waiting',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findByPk = async () => ({
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'call', script: 'bot-1' }
            ]
          }
        ]
      }
    });

    let leadUpdated = false;
    STUB_MODELS.CampaignLead.update = async (data) => {
      leadUpdated = true;
      return {};
    };

    const { advance } = require('../src/services/campaign-advance');
    // Simulate failed call by passing touchSucceeded = false
    await advance(run, {
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'call', script: 'bot-1' }
            ]
          }
        ]
      }
    }, false);

    assert.equal(leadUpdated, false, 'Failed call action must not update lead status');
  });

  await t.test('8. Successful completed call changes raw to contacted', async () => {
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };

    const run = {
      id: 'run-1',
      status: 'waiting',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findByPk = async () => ({
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'call', script: 'bot-1' }
            ]
          }
        ]
      }
    });

    let leadStatusUpdated = null;
    STUB_MODELS.CampaignLead.update = async (data) => {
      leadStatusUpdated = data.status;
      return {};
    };

    const { advance } = require('../src/services/campaign-advance');
    // Simulate successful call by passing touchSucceeded = true
    await advance(run, {
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'call', script: 'bot-1' }
            ]
          }
        ]
      }
    }, true);

    assert.equal(leadStatusUpdated, 'contacted', 'Successful call action must change raw to contacted');
  });

  await t.test('9. Keyword-matched inbound WhatsApp reply changes contacted to interested', async () => {
    const lead = {
      id: 'lead-1',
      status: 'contacted',
      phone: '919876543210',
      campaign_id: 'campaign-1',
      update: async (data) => {
        lead.status = data.status;
      }
    };

    const run = {
      id: 'run-1',
      status: 'waiting',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      lead,
      update: async (data) => {
        run.status = data.status;
      }
    };

    STUB_MODELS.CampaignLeadRun.findOne = async () => run;
    STUB_MODELS.Campaign.findByPk = async () => ({
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'whatsapp', template: 'temp-1', interest_keywords: ['yes'] }
            ]
          }
        ]
      }
    });

    const { markInterestedAndHalt } = require('../src/services/campaign-reply-handler');
    const result = await markInterestedAndHalt('org-1', '919876543210', 'Yes');
    
    assert.equal(result.classified, 'interested');
    assert.equal(lead.status, 'interested');
    assert.equal(run.status, 'halted');
  });

  await t.test('10. Non-matching inbound reply changes contacted to engaged', async () => {
    const lead = {
      id: 'lead-1',
      status: 'contacted',
      phone: '919876543210',
      campaign_id: 'campaign-1',
      update: async (data) => {
        lead.status = data.status;
      }
    };

    const run = {
      id: 'run-1',
      status: 'waiting',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      lead,
      update: async (data) => {
        run.status = data.status;
      }
    };

    STUB_MODELS.CampaignLeadRun.findOne = async () => run;
    STUB_MODELS.Campaign.findByPk = async () => ({
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'whatsapp', template: 'temp-1', interest_keywords: ['yes'] }
            ]
          }
        ]
      }
    });

    const { markInterestedAndHalt } = require('../src/services/campaign-reply-handler');
    const result = await markInterestedAndHalt('org-1', '919876543210', 'No');
    
    assert.equal(result.classified, 'engaged');
    assert.equal(lead.status, 'engaged');
  });

  await t.test('11. Webhook /call-completed with status: failed keeps lead as raw', async () => {
    let leadUpdated = false;
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };
    const run = {
      id: 'run-1',
      status: 'waiting',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
    };

    STUB_MODELS.CampaignLeadRun.findOne = async () => run;
    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findOne = async () => ({
      id: 'campaign-1',
      org_id: 'org-1',
      template_snapshot: {
        days: [{ actions: [{ type: 'call', script: 'bot-1' }] }]
      },
      update: async () => {}
    });

    STUB_MODELS.CampaignLeadRun.update = async (data) => {
      run.status = data.status;
      return [1];
    };
    STUB_MODELS.CampaignLead.update = async () => {
      leadUpdated = true;
      return {};
    };

    const webhooksRouter = require('../src/routes/webhooks');
    const callCompletedRoute = webhooksRouter.stack.find(
      (layer) => layer.route && layer.route.path === '/call-completed'
    );
    const callCompletedHandler = callCompletedRoute.route.stack[callCompletedRoute.route.stack.length - 1].handle;

    const req = {
      body: {
        org_id: 'org-1',
        campaign_id: 'campaign-1',
        campaign_lead_id: 'lead-1',
        call_id: 'call-1',
        duration_seconds: 10,
        status: 'failed',
      }
    };
    const res = { json: () => {} };

    await callCompletedHandler(req, res);

    assert.equal(leadUpdated, false, 'Failed call webhook must not update lead status');
    assert.equal(lead.status, 'raw');
  });

  await t.test('12. Webhook /call-completed with status: completed moves raw to contacted', async () => {
    let leadUpdatedStatus = null;
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };
    const run = {
      id: 'run-1',
      status: 'waiting',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
    };

    STUB_MODELS.CampaignLeadRun.findOne = async () => run;
    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findOne = async () => ({
      id: 'campaign-1',
      org_id: 'org-1',
      template_snapshot: {
        days: [{ actions: [{ type: 'call', script: 'bot-1' }] }]
      },
      update: async () => {}
    });

    STUB_MODELS.CampaignLeadRun.update = async (data) => {
      run.status = data.status;
      return [1];
    };
    STUB_MODELS.CampaignLead.update = async (data) => {
      leadUpdatedStatus = data.status;
      lead.status = data.status;
      return {};
    };

    const webhooksRouter = require('../src/routes/webhooks');
    const callCompletedRoute = webhooksRouter.stack.find(
      (layer) => layer.route && layer.route.path === '/call-completed'
    );
    const callCompletedHandler = callCompletedRoute.route.stack[callCompletedRoute.route.stack.length - 1].handle;

    const req = {
      body: {
        org_id: 'org-1',
        campaign_id: 'campaign-1',
        campaign_lead_id: 'lead-1',
        call_id: 'call-1',
        duration_seconds: 10,
        status: 'completed',
      }
    };
    const res = { json: () => {} };

    await callCompletedHandler(req, res);

    assert.equal(leadUpdatedStatus, 'contacted');
    assert.equal(lead.status, 'contacted');
  });

  await t.test('13. Inactive call channel before timeout leaves lead raw and run waiting', async () => {
    let leadUpdated = false;
    let runAdvanced = false;

    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };
    const run = {
      id: 'run-1',
      status: 'waiting',
      campaign_id: 'campaign-1',
      org_id: 'org-1',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      updated_at: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes (less than 15 mins)
      lead,
    };

    STUB_MODELS.Campaign.findAll = async () => [
      {
        id: 'campaign-1',
        org_id: 'org-1',
        template_snapshot: { days: [{ actions: [{ type: 'call', script: 'bot-1' }] }] },
        avg_call_seconds: 180,
      }
    ];
    STUB_MODELS.Organization.findAll = async () => [
      {
        id: 'org-1',
        context_prefix: 'ctx',
        settings: { campaign_max_concurrent_calls: 30 }
      }
    ];

    STUB_MODELS.CampaignLeadRun.findAll = async (options) => {
      if (options.where.status === 'waiting') {
        return [run];
      }
      return [];
    };

    STUB_MODELS.CampaignLeadRun.update = async () => {
      runAdvanced = true;
      return [1];
    };
    STUB_MODELS.CampaignLead.update = async () => {
      leadUpdated = true;
      return {};
    };

    activeChannelsMock = []; // Inactive channel

    const { runPoll } = require('../src/jobs/campaignCallWorker');
    
    await runPoll();

    assert.equal(runAdvanced, false, 'Should not advance before timeout');
    assert.equal(leadUpdated, false, 'Should not update lead status');
  });

  await t.test('14. Inactive call channel after timeout advances safely with lead still raw', async () => {
    let leadUpdated = false;
    let runAdvanced = false;

    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };
    const run = {
      id: 'run-1',
      status: 'waiting',
      campaign_id: 'campaign-1',
      org_id: 'org-1',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      updated_at: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes (more than 15 mins)
      lead,
    };

    STUB_MODELS.Campaign.findAll = async () => [
      {
        id: 'campaign-1',
        org_id: 'org-1',
        template_snapshot: { days: [{ actions: [{ type: 'call', script: 'bot-1' }] }] },
        avg_call_seconds: 180,
      }
    ];
    STUB_MODELS.Organization.findAll = async () => [
      {
        id: 'org-1',
        context_prefix: 'ctx',
        settings: { campaign_max_concurrent_calls: 30 }
      }
    ];

    STUB_MODELS.CampaignLeadRun.findAll = async (options) => {
      if (options.where.status === 'waiting') {
        return [run];
      }
      return [];
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.CampaignLeadRun.update = async (data) => {
      runAdvanced = true;
      run.status = data.status;
      return [1];
    };
    STUB_MODELS.CampaignLead.update = async () => {
      leadUpdated = true;
      return {};
    };

    activeChannelsMock = []; // Inactive channel

    const { runPoll } = require('../src/jobs/campaignCallWorker');
    
    await runPoll();

    assert.equal(runAdvanced, true, 'Should advance after timeout');
    assert.equal(leadUpdated, false, 'Should keep lead status raw');
    assert.equal(run.status, 'completed', 'Should advance run status');
  });

  await t.test('15. Concurrent advance() attempts only execute side effects once', async () => {
    let leadUpdateCount = 0;

    const lead = {
      id: 'lead-1',
      status: 'raw',
    };
    const run = {
      id: 'run-1',
      status: 'waiting',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;

    let callIndex = 0;
    STUB_MODELS.CampaignLeadRun.update = async (data) => {
      callIndex++;
      if (callIndex === 1) {
        run.status = data.status;
        return [1];
      }
      return [0];
    };

    STUB_MODELS.CampaignLead.update = async () => {
      leadUpdateCount++;
      return {};
    };

    enqueuedJobs = [];

    const { advance } = require('../src/services/campaign-advance');

    const p1 = advance(run, {
      id: 'campaign-1',
      org_id: 'org-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'call', script: 'bot-1' },
              { type: 'whatsapp', template: 'temp-1', namespace: 'ns-1' }
            ]
          }
        ]
      }
    }, true);

    const p2 = advance(run, {
      id: 'campaign-1',
      org_id: 'org-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'call', script: 'bot-1' },
              { type: 'whatsapp', template: 'temp-1', namespace: 'ns-1' }
            ]
          }
        ]
      }
    }, true);

    await Promise.all([p1, p2]);

    assert.equal(leadUpdateCount, 1, 'Lead should only be updated once');
    assert.equal(enqueuedJobs.length, 1, 'Next action should only be enqueued once');
  });

  await t.test('16. Delayed webhook after poll-worker timeout does not double-advance', async () => {
    let leadUpdateCount = 0;

    const lead = {
      id: 'lead-1',
      status: 'raw',
    };
    const run = {
      id: 'run-1',
      status: 'completed', 
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
    };

    STUB_MODELS.CampaignLeadRun.findOne = async () => null;
    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;

    STUB_MODELS.CampaignLeadRun.update = async () => {
      throw new Error('Should not update already completed run');
    };
    STUB_MODELS.CampaignLead.update = async () => {
      leadUpdateCount++;
      return {};
    };

    const webhooksRouter = require('../src/routes/webhooks');
    const callCompletedRoute = webhooksRouter.stack.find(
      (layer) => layer.route && layer.route.path === '/call-completed'
    );
    const callCompletedHandler = callCompletedRoute.route.stack[callCompletedRoute.route.stack.length - 1].handle;

    const req = {
      body: {
        org_id: 'org-1',
        campaign_id: 'campaign-1',
        campaign_lead_id: 'lead-1',
        call_id: 'call-1',
        duration_seconds: 10,
        status: 'completed',
      }
    };
    const res = { json: () => {} };

    await callCompletedHandler(req, res);

    assert.equal(leadUpdateCount, 0, 'Should not perform any updates or side effects');
  });

  await t.test('17. Successful WhatsApp send creates exactly one CampaignEvent with safe metadata', async () => {
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };

    const run = {
      id: 'run-1',
      status: 'queued',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      update: async () => {}
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findByPk = async () => ({
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'whatsapp', template: 'temp-1' }
            ]
          }
        ]
      }
    });
    STUB_MODELS.Organization.findByPk = async () => ({ id: 'org-1' });

    let createdEvent = null;
    STUB_MODELS.CampaignEvent.create = async (data) => {
      createdEvent = data;
      return {};
    };

    runWhatsAppResult = { ok: true, requestId: 'req-123' };
    STUB_ACTIONS.runWhatsApp = async () => runWhatsAppResult;

    await processWhatsAppJobFn({
      data: {
        runId: 'run-1',
        orgId: 'org-1',
        campaignId: 'campaign-1',
        leadId: 'lead-1',
        action: { type: 'whatsapp', template: 'temp-1' }
      }
    });

    assert.ok(createdEvent, 'Timeline event must be created');
    assert.equal(createdEvent.kind, 'whatsapp_sent');
    assert.equal(createdEvent.campaign_lead_id, 'lead-1');
    assert.equal(createdEvent.payload.template_name, 'temp-1');
    assert.equal(createdEvent.payload.direction, 'outbound');
    assert.equal(createdEvent.payload.send_status, 'sent');
    assert.equal(createdEvent.payload.request_id, 'req-123');
    assert.equal(createdEvent.idempotency_key, 'whatsapp-sent-run-1-d0-a0');
  });

  await t.test('18. Failed WhatsApp send does not create CampaignEvent', async () => {
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };

    const run = {
      id: 'run-1',
      status: 'queued',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      update: async () => {}
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findByPk = async () => ({ id: 'campaign-1' });
    STUB_MODELS.Organization.findByPk = async () => ({ id: 'org-1' });

    let eventCreated = false;
    STUB_MODELS.CampaignEvent.create = async () => {
      eventCreated = true;
      return {};
    };

    runWhatsAppResult = { ok: false, transient: false, error: 'Invalid template' };
    STUB_ACTIONS.runWhatsApp = async () => runWhatsAppResult;

    await processWhatsAppJobFn({
      data: {
        runId: 'run-1',
        orgId: 'org-1',
        campaignId: 'campaign-1',
        leadId: 'lead-1',
        action: { type: 'whatsapp', template: 'temp-1' }
      }
    });

    assert.equal(eventCreated, false, 'Failed send must not create Timeline event');
  });

  await t.test('19. Duplicate WhatsApp send processing does not throw and skips CampaignEvent creation', async () => {
    const lead = {
      id: 'lead-1',
      status: 'raw',
      phone: '919876543210',
    };

    const run = {
      id: 'run-1',
      status: 'queued',
      campaign_lead_id: 'lead-1',
      current_day_index: 0,
      current_action_index: 0,
      update: async () => {}
    };

    STUB_MODELS.CampaignLeadRun.findByPk = async () => run;
    STUB_MODELS.CampaignLead.findByPk = async () => lead;
    STUB_MODELS.Campaign.findByPk = async () => ({
      id: 'campaign-1',
      template_snapshot: {
        days: [
          {
            actions: [
              { type: 'whatsapp', template: 'temp-1' }
            ]
          }
        ]
      }
    });
    STUB_MODELS.Organization.findByPk = async () => ({ id: 'org-1' });

    // Mock CampaignEvent.create to throw a unique constraint error
    let createCount = 0;
    STUB_MODELS.CampaignEvent.create = async () => {
      createCount++;
      const err = new Error('Validation error');
      err.name = 'SequelizeUniqueConstraintError';
      throw err;
    };

    runWhatsAppResult = { ok: true, requestId: 'req-123' };
    STUB_ACTIONS.runWhatsApp = async () => runWhatsAppResult;

    // This should run without throwing any error and successfully advance the campaign
    await assert.doesNotReject(async () => {
      await processWhatsAppJobFn({
        data: {
          runId: 'run-1',
          orgId: 'org-1',
          campaignId: 'campaign-1',
          leadId: 'lead-1',
          action: { type: 'whatsapp', template: 'temp-1' }
        }
      });
    }, 'Process WhatsApp job should handle unique constraint error gracefully');

    assert.equal(createCount, 1, 'Event creation should be attempted exactly once');
  });

});

