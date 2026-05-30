const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Define database stub state
let mockBots = [];

const mockCampaignBot = {
  findOne: async ({ where }) => {
    if (where.id) {
      return mockBots.find(b => b.id === where.id && b.org_id === where.org_id) || null;
    }
    if (where.name) {
      return mockBots.find(b => b.name === where.name && b.org_id === where.org_id) || null;
    }
    return null;
  },
  findAll: async ({ where }) => {
    return mockBots.filter(b => b.org_id === where.org_id);
  }
};

const modelsPath = path.resolve(__dirname, '../src/models/index.js');
require.cache[modelsPath] = {
  id: modelsPath,
  filename: modelsPath,
  loaded: true,
  exports: {
    CampaignBot: mockCampaignBot
  }
};

const { runCall } = require('../src/services/campaign-actions');

test('campaign-bot wss_url construction', async (t) => {
  const originalFetch = global.fetch;
  const originalWsBase = process.env.CAMPAIGN_BOT_WS_BASE_URL;

  // Force a predictable base URL for test assertions
  process.env.CAMPAIGN_BOT_WS_BASE_URL = 'ws://localhost:8765/bot';

  t.after(() => {
    global.fetch = originalFetch;
    if (originalWsBase === undefined) {
      delete process.env.CAMPAIGN_BOT_WS_BASE_URL;
    } else {
      process.env.CAMPAIGN_BOT_WS_BASE_URL = originalWsBase;
    }
  });

  // Mock global.fetch to intercept target payload
  let interceptedBody = null;
  global.fetch = async (url, options) => {
    interceptedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, id: 'test-call-id' })
    };
  };

  const orgId = 'test-org-id';
  const campaignId = 'test-campaign-id';
  const lead = { id: 'test-lead-id', phone: '919999999999' };
  const run = { id: 'test-run-id' };
  const campaignRow = { options: {} };

  // Helper to trigger runCall and return resolved values
  const testOriginate = async (script) => {
    interceptedBody = null;
    await runCall({
      orgId,
      campaignId,
      lead,
      run,
      action: { script, interest_keywords: ['yes'] },
      campaignRow
    });
    return interceptedBody;
  };

  // Rule 1: UUID exists in DB for this org
  await t.test('Rule 1: UUID exists in DB for this org', async () => {
    mockBots = [
      { id: '11111111-2222-3333-4444-555555555555', name: 'Real Bot', org_id: orgId }
    ];
    const body = await testOriginate('11111111-2222-3333-4444-555555555555');
    assert.strictEqual(body.bot_id, '11111111-2222-3333-4444-555555555555');
    assert.strictEqual(body.wss_url, 'ws://localhost:8765/bot/11111111-2222-3333-4444-555555555555');
  });

  // Rule 2: Match by exact campaign bot name
  await t.test('Rule 2: Match by exact campaign bot name', async () => {
    mockBots = [
      { id: '22222222-2222-3333-4444-555555555555', name: 'Exact Name Bot', org_id: orgId }
    ];
    const body = await testOriginate('Exact Name Bot');
    assert.strictEqual(body.bot_id, '22222222-2222-3333-4444-555555555555');
    assert.strictEqual(body.wss_url, 'ws://localhost:8765/bot/22222222-2222-3333-4444-555555555555');
  });

  // Rule 3: Match by normalized campaign bot name (case-insensitive & strip symbols)
  await t.test('Rule 3: Match by normalized campaign bot name', async () => {
    mockBots = [
      { id: '33333333-2222-3333-4444-555555555555', name: 'Test Bot v1', org_id: orgId }
    ];
    // "test_bot_v1" should normalize to "testbotv1", matching "Test Bot v1" (which normalizes to "testbotv1")
    const body = await testOriginate('test_bot_v1');
    assert.strictEqual(body.bot_id, '33333333-2222-3333-4444-555555555555');
    assert.strictEqual(body.wss_url, 'ws://localhost:8765/bot/33333333-2222-3333-4444-555555555555');
  });

  // Rule 4: Fallback to the first available campaign bot for that org
  await t.test('Rule 4: Fallback to the first available campaign bot for that org', async () => {
    mockBots = [
      { id: '44444444-2222-3333-4444-555555555555', name: 'Primary Bot', org_id: orgId },
      { id: '55555555-2222-3333-4444-555555555555', name: 'Secondary Bot', org_id: orgId }
    ];
    // No match for "unmatched_bot_name", should fall back to first bot (Primary Bot)
    const body = await testOriginate('unmatched_bot_name');
    assert.strictEqual(body.bot_id, '44444444-2222-3333-4444-555555555555');
    assert.strictEqual(body.wss_url, 'ws://localhost:8765/bot/44444444-2222-3333-4444-555555555555');
  });

  // Rule 5: If no bot exists, pass through original value
  await t.test('Rule 5: If no bot exists, pass through original value', async () => {
    mockBots = [];
    const body = await testOriginate('missing_bot_v1');
    assert.strictEqual(body.bot_id, 'missing_bot_v1');
    assert.strictEqual(body.wss_url, 'ws://localhost:8765/bot/missing_bot_v1');
  });
});
