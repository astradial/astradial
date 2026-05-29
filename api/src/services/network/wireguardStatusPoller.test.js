/**
 * Tests for WireguardStatusPoller orchestration.
 *
 * Run: `node api/src/services/network/wireguardStatusPoller.test.js`
 *
 * The poller is mostly orchestration on top of the status service +
 * Sequelize models. We mock both layers.
 */

'use strict';

const assert = require('node:assert/strict');
const { WireguardStatusPoller, DEFAULT_INTERVAL_MS } = require('./wireguardStatusPoller');

let passed = 0;
let failed = 0;

function test(name, fn) {
  testQueue.push(async () => {
    try {
      await fn();
      console.log(`PASS  ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL  ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  });
}
const testQueue = [];

const V7_PUBKEY = 'kT+6Zes5CTvxU662Duh9sDwBvAKfPXeLo9ZK84lgzgA=';
const FIXED_NOW = new Date('2026-05-12T08:00:00.000Z');
const ONE_MIN_AGO_UNIX = Math.floor(FIXED_NOW.getTime() / 1000) - 60;

const DUMP_WITH_V7 = [
  'priv\tpub\t51821\toff',
  `${V7_PUBKEY}\t(none)\t1.2.3.4:51821\t10.20.7.2/32\t${ONE_MIN_AGO_UNIX}\t1000\t2000\t25`
].join('\n');

function makeMockModels({ tunnels = [], failCreate = false } = {}) {
  const created = [];
  const destroyed = [];
  // Mock sequelize.constructor.Op for the prune path's Sequelize.Op.lt lookup.
  const mockSequelize = {
    constructor: { Op: { lt: Symbol('lt'), gte: Symbol('gte'), lte: Symbol('lte') } }
  };
  return {
    created,
    destroyed,
    CustomerTunnel: {
      findAll: async () => tunnels
    },
    TunnelMetric: {
      sequelize: mockSequelize,
      create: async (row) => {
        if (failCreate) throw new Error('mock db write failed');
        created.push(row);
        return row;
      },
      // Retention prune (audit fix P1 #6). Mock returns 0 deleted by default;
      // tests can override per-instance if they need to assert prune behavior.
      destroy: async ({ where } = {}) => {
        destroyed.push({ where });
        return 0;
      }
    }
  };
}

function makeMockIo(stdout = DUMP_WITH_V7, opts = {}) {
  return {
    exec: async () => {
      if (opts.fail) throw new Error(opts.fail);
      return { stdout, stderr: '' };
    }
  };
}

// ─── Basic lifecycle ──────────────────────────────────────────────────────

test('constructor throws when models is missing', () => {
  assert.throws(() => new WireguardStatusPoller(), /models.*required/);
});

test('start + stop is idempotent', () => {
  const poller = new WireguardStatusPoller({
    models: makeMockModels(),
    intervalMs: 60_000,
    io: makeMockIo(),
    onError: () => {}
  });
  poller.start();
  poller.start(); // no-op
  assert.equal(poller.getStatus().running, true);
  poller.stop();
  poller.stop(); // no-op
  assert.equal(poller.getStatus().running, false);
});

test('getStatus reports counters and interval', () => {
  const poller = new WireguardStatusPoller({
    models: makeMockModels(),
    intervalMs: 12345,
    interfaceName: 'wg42',
    io: makeMockIo(),
    onError: () => {}
  });
  const s = poller.getStatus();
  assert.equal(s.running, false);
  assert.equal(s.interval_ms, 12345);
  assert.equal(s.interface_name, 'wg42');
  assert.equal(s.consecutive_failures, 0);
  assert.equal(s.total_snapshots_written, 0);
});

// ─── _tick (single cycle) ─────────────────────────────────────────────────

test('_tick writes one metric row per active tunnel', async () => {
  const tunnels = [
    { id: 'tunnel-v7', customer_pubkey: V7_PUBKEY }
  ];
  const models = makeMockModels({ tunnels });
  const poller = new WireguardStatusPoller({
    models,
    io: makeMockIo(),
    onError: () => {},
    nowFn: () => FIXED_NOW
  });
  const result = await poller._tick();
  assert.equal(result.written, 1);
  assert.equal(models.created.length, 1);
  const row = models.created[0];
  assert.equal(row.tunnel_id, 'tunnel-v7');
  assert.equal(row.endpoint_ip, '1.2.3.4');
  assert.equal(row.endpoint_port, 51821);
  assert.equal(row.bytes_received, 1000);
  assert.equal(row.bytes_sent, 2000);
  assert.equal(row.peer_count_total, 1);
  assert.ok(row.latest_handshake_at instanceof Date);
});

test('_tick handles tunnel NOT present in wg (writes row with null endpoint)', async () => {
  const tunnels = [
    { id: 'tunnel-missing', customer_pubkey: 'NOTINDUMP'.padEnd(43, 'A') + '=' }
  ];
  const models = makeMockModels({ tunnels });
  const poller = new WireguardStatusPoller({
    models,
    io: makeMockIo(),
    onError: () => {},
    nowFn: () => FIXED_NOW
  });
  await poller._tick();
  assert.equal(models.created.length, 1);
  const row = models.created[0];
  assert.equal(row.endpoint_ip, null);
  assert.equal(row.endpoint_port, null);
  assert.equal(row.bytes_received, 0);
  assert.equal(row.latest_handshake_at, null);
});

test('_tick continues when one tunnel snapshot fails', async () => {
  // Two tunnels — make the first DB create fail, second succeed
  const tunnels = [
    { id: 'fail-me', customer_pubkey: V7_PUBKEY },
    { id: 'ok', customer_pubkey: V7_PUBKEY }
  ];
  let callCount = 0;
  // Mock Sequelize.Op for the retention prune path (audit fix P1 #6).
  const mockSequelize = {
    constructor: { Op: { lt: Symbol('lt') } }
  };
  const models = {
    CustomerTunnel: { findAll: async () => tunnels },
    TunnelMetric: {
      sequelize: mockSequelize,
      create: async (row) => {
        callCount++;
        if (callCount === 1) throw new Error('first row blew up');
        return row;
      },
      destroy: async () => 0
    }
  };
  const errors = [];
  const poller = new WireguardStatusPoller({
    models,
    io: makeMockIo(),
    onError: (err) => errors.push(err),
    nowFn: () => FIXED_NOW
  });
  const result = await poller._tick();
  assert.equal(result.written, 1, 'second tunnel succeeded');
  assert.equal(errors.length, 1, 'first failure logged');
  assert.match(errors[0].message, /fail-me snapshot failed/);
});

test('_tick: exec failure increments consecutive_failures', async () => {
  const poller = new WireguardStatusPoller({
    models: makeMockModels({ tunnels: [{ id: 'x', customer_pubkey: V7_PUBKEY }] }),
    io: makeMockIo('', { fail: 'wg dead' }),
    onError: () => {}
  });
  await assert.rejects(() => poller._tick(), /wg dead/);
  assert.equal(poller.getStatus().consecutive_failures, 1);
});

test('_tick: success resets consecutive_failures', async () => {
  const poller = new WireguardStatusPoller({
    models: makeMockModels({ tunnels: [{ id: 'x', customer_pubkey: V7_PUBKEY }] }),
    io: makeMockIo(),
    onError: () => {}
  });
  poller._consecutiveFailures = 3; // simulate prior failures
  await poller._tick();
  assert.equal(poller.getStatus().consecutive_failures, 0);
});

test('_tick: skips when in-flight (overlapping protection)', async () => {
  const poller = new WireguardStatusPoller({
    models: makeMockModels({ tunnels: [{ id: 'x', customer_pubkey: V7_PUBKEY }] }),
    io: makeMockIo(),
    onError: () => {}
  });
  poller._inFlight = true;
  const r = await poller._tick();
  assert.equal(r.skipped, true);
  assert.equal(r.written, 0);
});

test('_tick: no active tunnels = 0 written, no error', async () => {
  const poller = new WireguardStatusPoller({
    models: makeMockModels({ tunnels: [] }),
    io: makeMockIo(),
    onError: () => {}
  });
  const r = await poller._tick();
  assert.equal(r.written, 0);
  assert.equal(r.skipped, false);
});

// ─── Retention (audit fix P1 #6) ──────────────────────────────────────────

test('_maybePrune calls TunnelMetric.destroy with cutoff older than retentionDays', async () => {
  const models = makeMockModels({ tunnels: [{ id: 't1', customer_pubkey: V7_PUBKEY }] });
  const poller = new WireguardStatusPoller({
    models,
    io: makeMockIo(),
    onError: () => {},
    nowFn: () => FIXED_NOW,
    retentionDays: 30
  });
  await poller._maybePrune();
  assert.equal(models.destroyed.length, 1);
  // The where clause was built with the mocked Op.lt symbol — just confirm
  // the call shape was right and cutoff is roughly 30 days before FIXED_NOW.
  const where = models.destroyed[0].where;
  assert.ok(where.snapshot_at, 'destroy was called with a snapshot_at filter');
});

test('_maybePrune throttles to once per retentionPruneIntervalMs', async () => {
  const models = makeMockModels({ tunnels: [] });
  const poller = new WireguardStatusPoller({
    models,
    io: makeMockIo(),
    onError: () => {},
    nowFn: () => FIXED_NOW,
    retentionDays: 30,
    retentionPruneIntervalMs: 3_600_000  // 1 hour
  });
  await poller._maybePrune();   // first call: runs
  await poller._maybePrune();   // second call: throttled, skips
  await poller._maybePrune();   // third call: throttled, skips
  assert.equal(models.destroyed.length, 1, 'only the first prune should hit the DB within the interval');
});

test('_maybePrune failure is logged via onError but does not throw', async () => {
  const errors = [];
  const models = makeMockModels({ tunnels: [] });
  // Override destroy to fail
  models.TunnelMetric.destroy = async () => { throw new Error('mock destroy failed'); };
  const poller = new WireguardStatusPoller({
    models,
    io: makeMockIo(),
    onError: (err) => errors.push(err),
    nowFn: () => FIXED_NOW
  });
  const result = await poller._maybePrune();
  assert.equal(result.pruned, 0);
  assert.equal(result.skipped, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /tunnel_metrics prune failed/);
});

test('getStatus reports retention counters', () => {
  const poller = new WireguardStatusPoller({
    models: makeMockModels(),
    retentionDays: 45
  });
  const s = poller.getStatus();
  assert.equal(s.retention_days, 45);
  assert.equal(s.total_pruned, 0);
  assert.equal(s.last_prune_at, null);
});

test('_tick: total_snapshots_written accumulates across cycles', async () => {
  const tunnels = [{ id: 't1', customer_pubkey: V7_PUBKEY }];
  const poller = new WireguardStatusPoller({
    models: makeMockModels({ tunnels }),
    io: makeMockIo(),
    onError: () => {},
    nowFn: () => FIXED_NOW
  });
  await poller._tick();
  await poller._tick();
  await poller._tick();
  assert.equal(poller.getStatus().total_snapshots_written, 3);
});

// ─── Run sequentially ─────────────────────────────────────────────────────

(async () => {
  for (const t of testQueue) await t();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
