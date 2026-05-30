'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { Op } = require('sequelize');

// 1. Stub the DB models first
const STUB_MODELS = {
  Campaign: {
    findAll: async () => [],
    findOne: async () => null,
  },
  CampaignLead: {
    findAndCountAll: async () => ({ count: 0, rows: [] }),
    findAll: async () => [],
  },
  CampaignTemplate: {},
  CampaignLeadField: {},
  CampaignEvent: {},
  CampaignApproval: {},
  CampaignImportJob: {},
  Organization: {},
  sequelize: {
    fn: (name, val) => ({ name, val }),
    col: (val) => val,
    transaction: async () => ({
      commit: async () => {},
      rollback: async () => {},
    })
  },
  Op
};

const modelsPath = path.resolve(__dirname, '../src/models/index.js');
require.cache[modelsPath] = {
  id: modelsPath,
  filename: modelsPath,
  loaded: true,
  exports: STUB_MODELS,
};

// 2. Stub the RBAC middleware so it bypasses permission checks
const rbacPath = path.resolve(__dirname, '../src/middleware/rbac.js');
require.cache[rbacPath] = {
  id: rbacPath,
  filename: rbacPath,
  loaded: true,
  exports: {
    requirePermission: () => (req, res, next) => next(),
  }
};

// 3. Stub validators as no-ops
const validatorsPath = path.resolve(__dirname, '../src/middleware/campaign-validators.js');
require.cache[validatorsPath] = {
  id: validatorsPath,
  filename: validatorsPath,
  loaded: true,
  exports: {
    templateCreate: (req, res, next) => next(),
    templateUpdate: (req, res, next) => next(),
    throughputUpdate: (req, res, next) => next(),
  }
};

// 4. Require the router under test
const router = require('../src/routes/campaigns');

test('Campaign Leads Overview Endpoints', async (t) => {

  t.beforeEach(() => {
    // Reset all model stubs to default implementations
    STUB_MODELS.Campaign.findAll = async () => [];
    STUB_MODELS.CampaignLead.findAndCountAll = async () => ({ count: 0, rows: [] });
    STUB_MODELS.CampaignLead.findAll = async () => [];
  });

  await t.test('1. Verify /leads route is registered BEFORE /:id in router stack', () => {
    const leadsIdx = router.stack.findIndex(l => l.route && l.route.path === '/leads');
    const idIdx = router.stack.findIndex(l => l.route && l.route.path === '/:id');
    
    assert.ok(leadsIdx !== -1, '/leads route must exist');
    assert.ok(idIdx !== -1, '/:id route must exist');
    assert.ok(leadsIdx < idIdx, '/leads route must be registered BEFORE /:id to prevent parameter capture');
  });

  await t.test('2. Active campaign scoping excludes draft by default', async () => {
    let campaignWhere = null;
    STUB_MODELS.Campaign.findAll = async (options) => {
      campaignWhere = options.where;
      return [
        { id: 'camp-1', name: 'Campaign 1' }
      ];
    };

    // Mock Express request / response
    let statusSent = null;
    let jsonSent = null;
    const req = {
      orgId: 'org-test-1',
      query: {}
    };
    const res = {
      status(code) { statusSent = code; return this; },
      json(data) { jsonSent = data; return this; }
    };

    // Extract and run `/leads` handler
    const leadsRoute = router.stack.find(l => l.route && l.route.path === '/leads');
    const handler = leadsRoute.route.stack[leadsRoute.route.stack.length - 1].handle;
    
    try {
      await handler(req, res);
    } catch (err) {
      console.error('HANDLER EXCEPTION:', err);
    }

    if (jsonSent && jsonSent.error) {
      console.error('HANDLER RETURNED ERROR:', jsonSent);
    }

    assert.ok(campaignWhere, 'should query campaigns');
    assert.equal(campaignWhere.org_id, 'org-test-1');
    assert.ok(campaignWhere.status, 'should query campaign statuses');
    assert.deepEqual(campaignWhere.status[STUB_MODELS.Op.in], ['running', 'paused', 'scheduled']);
  });

  await t.test('3. Search parameter q filters name, business, and phone', async () => {
    let leadWhere = null;
    
    STUB_MODELS.Campaign.findAll = async () => [
      { id: 'camp-1', name: 'Campaign 1' }
    ];
    STUB_MODELS.CampaignLead.findAndCountAll = async (options) => {
      leadWhere = options.where;
      return { count: 1, rows: [] };
    };

    const req = {
      orgId: 'org-test-1',
      query: { q: 'Alice' }
    };
    const res = {
      status() { return this; },
      json() { return this; }
    };

    const leadsRoute = router.stack.find(l => l.route && l.route.path === '/leads');
    const handler = leadsRoute.route.stack[leadsRoute.route.stack.length - 1].handle;

    await handler(req, res);

    assert.ok(leadWhere, 'should query leads');
    assert.ok(leadWhere[STUB_MODELS.Op.or], 'should apply OR query');
    const orFields = leadWhere[STUB_MODELS.Op.or];
    assert.equal(orFields.length, 3, 'should search on 3 fields');
    assert.deepEqual(orFields[0].name[STUB_MODELS.Op.like], '%Alice%');
    assert.deepEqual(orFields[1].phone[STUB_MODELS.Op.like], '%Alice%');
    assert.deepEqual(orFields[2].business[STUB_MODELS.Op.like], '%Alice%');
  });

  await t.test('4. Counts respect q but ignore status query param', async () => {
    let leadWhere = null;
    let countWhere = null;

    STUB_MODELS.Campaign.findAll = async () => [
      { id: 'camp-1', name: 'Campaign 1' }
    ];
    STUB_MODELS.CampaignLead.findAndCountAll = async (options) => {
      leadWhere = options.where;
      return { count: 0, rows: [] };
    };
    STUB_MODELS.CampaignLead.findAll = async (options) => {
      countWhere = options.where;
      return [];
    };

    const req = {
      orgId: 'org-test-1',
      query: { q: 'Bob', status: 'engaged' }
    };
    const res = {
      status() { return this; },
      json() { return this; }
    };

    const leadsRoute = router.stack.find(l => l.route && l.route.path === '/leads');
    const handler = leadsRoute.route.stack[leadsRoute.route.stack.length - 1].handle;

    await handler(req, res);

    assert.equal(leadWhere.status, 'engaged', 'leads list query should filter by status');
    assert.equal(countWhere.status, undefined, 'leads count query should NOT filter by status');
    
    // Both should still filter by search term q
    assert.ok(leadWhere[STUB_MODELS.Op.or], 'leads list filter has search');
    assert.ok(countWhere[STUB_MODELS.Op.or], 'counts filter has search');
  });

  await t.test('5. Response maps campaign_name and score correctly', async () => {
    STUB_MODELS.Campaign.findAll = async () => [
      { id: 'camp-1', name: 'Special Campaign' }
    ];
    STUB_MODELS.CampaignLead.findAndCountAll = async () => ({
      count: 1,
      rows: [
        {
          id: 'lead-uuid-1',
          name: 'Jane Doe',
          phone: '+919999988888',
          business: 'Jane Corp',
          status: 'qualified',
          campaign_id: 'camp-1',
          intent_score: 95,
          last_touch_at: new Date('2026-05-30T10:00:00Z'),
          campaign: { name: 'Special Campaign' },
          toJSON() { return this; }
        }
      ]
    });
    STUB_MODELS.CampaignLead.findAll = async () => [
      { status: 'qualified', n: 1 }
    ];

    const req = {
      orgId: 'org-test-1',
      query: {}
    };
    let jsonSent = null;
    const res = {
      status() { return this; },
      json(data) { jsonSent = data; return this; }
    };

    const leadsRoute = router.stack.find(l => l.route && l.route.path === '/leads');
    const handler = leadsRoute.route.stack[leadsRoute.route.stack.length - 1].handle;

    await handler(req, res);

    assert.ok(jsonSent, 'should return response');
    assert.equal(jsonSent.total, 1);
    assert.equal(jsonSent.data.length, 1);
    
    const mapped = jsonSent.data[0];
    assert.equal(mapped.id, 'lead-uuid-1');
    assert.equal(mapped.campaign_name, 'Special Campaign');
    assert.equal(mapped.score, 95);
    assert.equal(mapped.status, 'qualified');

    // Verify exact counts mapping
    assert.equal(jsonSent.counts.qualified, 1);
    assert.equal(jsonSent.counts.raw, 0);
  });
});
