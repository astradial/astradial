/**
 * Tests for wireguardStatusService.
 *
 * Run: `node api/src/services/network/wireguardStatusService.test.js`
 *
 * Pure helpers (buildTunnelStatus) are tested directly. exec-using
 * functions (getDumpedInterface, getTunnelStatus, getStatusForTunnels)
 * use injected mock exec to avoid spawning wg.
 */

'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_INTERFACE,
  DEFAULT_EXEC_TIMEOUT_MS,
  assertValidInterfaceName,
  getDumpedInterface,
  buildTunnelStatus,
  getTunnelStatus,
  getStatusForTunnels
} = require('./wireguardStatusService');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const run = async () => {
    try {
      await fn();
      console.log(`PASS  ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL  ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  };
  testQueue.push(run);
}
const testQueue = [];

// Fixtures
const V7_PUBKEY = 'kT+6Zes5CTvxU662Duh9sDwBvAKfPXeLo9ZK84lgzgA=';
const OTHER_PUBKEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const FIXED_NOW = new Date('2026-05-12T08:00:00.000Z');
const FIVE_MIN_AGO_UNIX = Math.floor(FIXED_NOW.getTime() / 1000) - 300;
const ONE_MIN_AGO_UNIX = Math.floor(FIXED_NOW.getTime() / 1000) - 60;

const V7_TUNNEL = {
  id: 'tunnel-v7-uuid',
  customer_pubkey: V7_PUBKEY,
  customer_tunnel_ip: '10.20.7.2'
};

const REAL_DUMP_V7_ALIVE = [
  'iKQAH+++key+for+iface+private+key+content+go=\tmBYga+pubkey+for+iface+content+go+here+as+ok=\t51821\toff',
  `${V7_PUBKEY}\t(none)\t49.207.232.227:37309\t10.20.7.2/32\t${ONE_MIN_AGO_UNIX}\t1234\t5678\t25`
].join('\n');

const REAL_DUMP_V7_STALE = [
  'iKQAH+++key+for+iface+private+key+content+go=\tmBYga+pubkey+for+iface+content+go+here+as+ok=\t51821\toff',
  `${V7_PUBKEY}\t(none)\t49.207.232.227:37309\t10.20.7.2/32\t${FIVE_MIN_AGO_UNIX}\t1234\t5678\t25`
].join('\n');

const REAL_DUMP_V7_NEVER_HANDSHAKEN = [
  'iKQAH+++key+for+iface+private+key+content+go=\tmBYga+pubkey+for+iface+content+go+here+as+ok=\t51821\toff',
  `${V7_PUBKEY}\t(none)\t(none)\t10.20.7.2/32\t0\t0\t0\t25`
].join('\n');

const REAL_DUMP_WITHOUT_V7 = [
  'iKQAH+++key+for+iface+private+key+content+go=\tmBYga+pubkey+for+iface+content+go+here+as+ok=\t51821\toff',
  `${OTHER_PUBKEY}\t(none)\t1.1.1.1:51821\t10.20.0.2/32\t${ONE_MIN_AGO_UNIX}\t100\t100\t25`
].join('\n');

const EMPTY_DUMP = 'iKQAH+++key+for+iface+private+key+content+go=\tmBYga+pubkey+for+iface+content+go+here+as+ok=\t51821\toff';

function makeMockIo(stdout = REAL_DUMP_V7_ALIVE, opts = {}) {
  const calls = [];
  return {
    calls,
    exec: async (cmd, options) => {
      calls.push({ cmd, options });
      if (opts.fail) throw new Error(opts.fail);
      return { stdout, stderr: '' };
    }
  };
}

// ─── assertValidInterfaceName ─────────────────────────────────────────────

test('assertValidInterfaceName accepts wg0/wg1/etc', () => {
  assert.doesNotThrow(() => assertValidInterfaceName('wg0'));
  assert.doesNotThrow(() => assertValidInterfaceName('wg1'));
});

test('assertValidInterfaceName rejects shell-injection attempts', () => {
  assert.throws(() => assertValidInterfaceName('wg1; rm -rf /'), /Invalid/);
  assert.throws(() => assertValidInterfaceName('wg1$(id)'), /Invalid/);
  assert.throws(() => assertValidInterfaceName('wg1`whoami`'), /Invalid/);
  assert.throws(() => assertValidInterfaceName('../wg1'), /Invalid/);
});

test('assertValidInterfaceName rejects non-string + too-long', () => {
  assert.throws(() => assertValidInterfaceName(null), /Invalid/);
  assert.throws(() => assertValidInterfaceName(''), /Invalid/);
  assert.throws(() => assertValidInterfaceName('a'.repeat(16)), /Invalid/);
});

// ─── buildTunnelStatus (pure) ────────────────────────────────────────────

test('buildTunnelStatus: peer alive + recent handshake', () => {
  const parsed = require('./wireguardStatusParser').parseWgShowDump(REAL_DUMP_V7_ALIVE);
  const s = buildTunnelStatus(V7_TUNNEL, parsed, { nowFn: () => FIXED_NOW });
  assert.equal(s.tunnel_id, 'tunnel-v7-uuid');
  assert.equal(s.alive, true);
  assert.equal(s.present_in_wg, true);
  assert.equal(s.handshake_age_seconds, 60);
  assert.equal(s.endpoint_ip, '49.207.232.227');
  assert.equal(s.endpoint_port, 37309);
  assert.equal(s.bytes_received, 1234);
  assert.equal(s.bytes_sent, 5678);
  assert.deepEqual(s.allowed_ips, ['10.20.7.2/32']);
});

test('buildTunnelStatus: peer with stale handshake → not alive', () => {
  const parsed = require('./wireguardStatusParser').parseWgShowDump(REAL_DUMP_V7_STALE);
  const s = buildTunnelStatus(V7_TUNNEL, parsed, { nowFn: () => FIXED_NOW });
  assert.equal(s.alive, false);
  assert.equal(s.present_in_wg, true);
  assert.equal(s.handshake_age_seconds, 300);
});

test('buildTunnelStatus: peer never handshaken → not alive, latest_handshake_at null', () => {
  const parsed = require('./wireguardStatusParser').parseWgShowDump(REAL_DUMP_V7_NEVER_HANDSHAKEN);
  const s = buildTunnelStatus(V7_TUNNEL, parsed, { nowFn: () => FIXED_NOW });
  assert.equal(s.alive, false);
  assert.equal(s.present_in_wg, true);
  assert.equal(s.latest_handshake_at, null);
  assert.equal(s.handshake_age_seconds, null);
  assert.equal(s.endpoint_ip, null);
});

test('buildTunnelStatus: peer absent from wg → present_in_wg: false', () => {
  const parsed = require('./wireguardStatusParser').parseWgShowDump(REAL_DUMP_WITHOUT_V7);
  const s = buildTunnelStatus(V7_TUNNEL, parsed, { nowFn: () => FIXED_NOW });
  assert.equal(s.alive, false);
  assert.equal(s.present_in_wg, false);
  assert.equal(s.endpoint_ip, null);
  assert.equal(s.bytes_received, 0);
  assert.deepEqual(s.allowed_ips, []);
});

test('buildTunnelStatus: empty dump (no peers at all)', () => {
  const parsed = require('./wireguardStatusParser').parseWgShowDump(EMPTY_DUMP);
  const s = buildTunnelStatus(V7_TUNNEL, parsed, { nowFn: () => FIXED_NOW });
  assert.equal(s.present_in_wg, false);
  assert.equal(s.alive, false);
});

test('buildTunnelStatus: custom aliveWindowSeconds respected', () => {
  const parsed = require('./wireguardStatusParser').parseWgShowDump(REAL_DUMP_V7_STALE);
  // 300s old; window=400 → alive
  const sAlive = buildTunnelStatus(V7_TUNNEL, parsed, {
    nowFn: () => FIXED_NOW, aliveWindowSeconds: 400
  });
  assert.equal(sAlive.alive, true);
  // window=200 → not alive
  const sStale = buildTunnelStatus(V7_TUNNEL, parsed, {
    nowFn: () => FIXED_NOW, aliveWindowSeconds: 200
  });
  assert.equal(sStale.alive, false);
});

test('buildTunnelStatus: throws when tunnel.customer_pubkey missing', () => {
  const parsed = require('./wireguardStatusParser').parseWgShowDump(REAL_DUMP_V7_ALIVE);
  assert.throws(() => buildTunnelStatus({ id: 'x' }, parsed), /customer_pubkey is required/);
});

test('buildTunnelStatus: throws when tunnel is null', () => {
  const parsed = require('./wireguardStatusParser').parseWgShowDump(REAL_DUMP_V7_ALIVE);
  assert.throws(() => buildTunnelStatus(null, parsed), /customer_pubkey is required/);
});

// ─── getDumpedInterface (exec-based) ──────────────────────────────────────

test('getDumpedInterface invokes wg show with default interface and timeout', async () => {
  const io = makeMockIo(REAL_DUMP_V7_ALIVE);
  const parsed = await getDumpedInterface({ io });
  assert.equal(parsed.peer_count, 1);
  assert.equal(io.calls.length, 1);
  assert.equal(io.calls[0].cmd, 'wg show wg1 dump');
  assert.equal(io.calls[0].options.timeout, DEFAULT_EXEC_TIMEOUT_MS);
});

test('getDumpedInterface respects custom interfaceName + timeoutMs', async () => {
  const io = makeMockIo(REAL_DUMP_V7_ALIVE);
  await getDumpedInterface({ io, interfaceName: 'wg99', timeoutMs: 5000 });
  assert.equal(io.calls[0].cmd, 'wg show wg99 dump');
  assert.equal(io.calls[0].options.timeout, 5000);
});

test('getDumpedInterface rejects malicious interfaceName before exec', async () => {
  const io = makeMockIo(REAL_DUMP_V7_ALIVE);
  await assert.rejects(
    () => getDumpedInterface({ io, interfaceName: 'wg1; rm -rf /' }),
    /Invalid.*interface name/
  );
  assert.equal(io.calls.length, 0, 'must not exec when validation fails');
});

test('getDumpedInterface propagates exec errors', async () => {
  const io = makeMockIo('', { fail: 'wg interface does not exist' });
  await assert.rejects(
    () => getDumpedInterface({ io }),
    /wg interface does not exist/
  );
});

// ─── getTunnelStatus (orchestrator) ───────────────────────────────────────

test('getTunnelStatus: end-to-end via mock exec', async () => {
  const io = makeMockIo(REAL_DUMP_V7_ALIVE);
  const s = await getTunnelStatus({
    tunnel: V7_TUNNEL,
    io,
    statusOpts: { nowFn: () => FIXED_NOW }
  });
  assert.equal(s.tunnel_id, 'tunnel-v7-uuid');
  assert.equal(s.alive, true);
  assert.equal(s.present_in_wg, true);
});

test('getTunnelStatus: peer absent → present_in_wg false', async () => {
  const io = makeMockIo(REAL_DUMP_WITHOUT_V7);
  const s = await getTunnelStatus({
    tunnel: V7_TUNNEL,
    io,
    statusOpts: { nowFn: () => FIXED_NOW }
  });
  assert.equal(s.present_in_wg, false);
});

test('getTunnelStatus throws when tunnel missing', async () => {
  await assert.rejects(
    () => getTunnelStatus({ io: makeMockIo() }),
    /tunnel is required/
  );
});

// ─── getStatusForTunnels (batch) ──────────────────────────────────────────

test('getStatusForTunnels runs ONE wg-show call for many tunnels', async () => {
  const io = makeMockIo(REAL_DUMP_V7_ALIVE);
  const result = await getStatusForTunnels({
    tunnels: [V7_TUNNEL, { ...V7_TUNNEL, id: 'other', customer_pubkey: OTHER_PUBKEY }],
    io,
    statusOpts: { nowFn: () => FIXED_NOW }
  });
  assert.equal(result.statuses.length, 2);
  assert.equal(io.calls.length, 1, 'must use ONE exec call regardless of tunnel count');
  // First tunnel found, second not (different pubkey)
  assert.equal(result.statuses[0].present_in_wg, true);
  assert.equal(result.statuses[1].present_in_wg, false);
});

test('getStatusForTunnels with empty tunnels array', async () => {
  const io = makeMockIo(REAL_DUMP_V7_ALIVE);
  const result = await getStatusForTunnels({ tunnels: [], io });
  assert.deepEqual(result.statuses, []);
});

test('getStatusForTunnels throws on non-array', async () => {
  await assert.rejects(
    () => getStatusForTunnels({ tunnels: 'not array', io: makeMockIo() }),
    /must be an array/
  );
});

// ─── Run sequentially ─────────────────────────────────────────────────────

(async () => {
  for (const t of testQueue) await t();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
