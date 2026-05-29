const test = require('node:test');
const assert = require('node:assert');
const { runCall } = require('../src/services/campaign-actions');

test('campaign-bot wss_url construction', async (t) => {
  // Save original fetch
  const originalFetch = global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.CAMPAIGN_BOT_WS_BASE_URL;
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
  const action = { script: 'test-bot-uuid', interest_keywords: ['yes'] };
  const campaignRow = { options: {} };

  // Test Case 1: no environment override => constructs Node fallback URL
  delete process.env.CAMPAIGN_BOT_WS_BASE_URL;
  await runCall({ orgId, campaignId, lead, run, action, campaignRow });
  assert.strictEqual(interceptedBody.wss_url, 'ws://localhost:8765/bot/test-bot-uuid');

  // Test Case 2: Python override value => Python URL constructed correctly
  process.env.CAMPAIGN_BOT_WS_BASE_URL = 'ws://pipecat-flow:7860/campaign-bot';
  await runCall({ orgId, campaignId, lead, run, action, campaignRow });
  assert.strictEqual(interceptedBody.wss_url, 'ws://pipecat-flow:7860/campaign-bot/test-bot-uuid');
});
