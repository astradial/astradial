/**
 * Tests for pjsipRegistrationsService.
 *
 * Run with: `node api/src/services/asterisk/pjsipRegistrationsService.test.js`
 *
 * Uses dependency-injected `io` to mock Asterisk CLI calls + a fake clock
 * for TTL cache testing. No real `asterisk -rx` is invoked.
 */

'use strict';

const assert = require('node:assert/strict');
const {
  parseContactLine,
  parseAllContacts,
  getAllUserRegistrations,
  clearCache,
  inspectCache,
  CONTACT_LINE_REGEX,
  CONTACT_URI_HOST_PORT_REGEX,
  DEFAULT_CACHE_TTL_MS
} = require('./pjsipRegistrationsService');

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

// ─── parseContactLine ─────────────────────────────────────────────────────

test('parseContactLine parses a real V7 Reception line (Avail with RTT)', () => {
  const line = '  Contact:  org_demo__09/sip:09@192.168.0.76:40314 fcd699215a Avail   171.789';
  const r = parseContactLine(line);
  assert.equal(r.aor, 'org_demo__09');
  assert.equal(r.contact_uri, 'sip:09@192.168.0.76:40314');
  assert.equal(r.contact_ip, '192.168.0.76');
  assert.equal(r.contact_port, 40314);
  assert.equal(r.status, 'reachable');
  assert.equal(r.rtt_ms, 171.789);
});

test('parseContactLine parses Unavail status', () => {
  const line = '  Contact:  org_X__102/sip:102@1.2.3.4:5060 abcdef1234 Unavail -1.000';
  const r = parseContactLine(line);
  assert.equal(r.status, 'unreachable');
  assert.equal(r.rtt_ms, -1);
});

test('parseContactLine parses NonQual status with -nan RTT', () => {
  // -nan happens when qualify hasn't completed (NAT keepalive missing)
  const line = '  Contact:  org_X__01/sip:org_X__01@49.207.232.227:37567;ob abc Avail  -nan';
  const r = parseContactLine(line);
  assert.equal(r.status, 'reachable');
  // -nan should yield null (NaN is not finite)
  assert.equal(r.rtt_ms, null, '-nan must be normalized to null');
});

test('parseContactLine treats NonQual as nonqual', () => {
  const line = '  Contact:  org_X__09/sip:9@10.0.0.5:5060 abc NonQual  -nan';
  const r = parseContactLine(line);
  assert.equal(r.status, 'nonqual');
});

test('parseContactLine handles port-less contact URI (default 5060)', () => {
  const line = '  Contact:  org_X__09/sip:9@10.0.0.5 abc Avail  10.0';
  const r = parseContactLine(line);
  assert.equal(r.contact_ip, '10.0.0.5');
  assert.equal(r.contact_port, 5060);
});

test('parseContactLine extracts IP correctly when URI has trailing params', () => {
  const line = '  Contact:  org_X__09/sip:9@10.0.0.5:5060;transport=udp;rinstance=abc abc Avail 12';
  const r = parseContactLine(line);
  assert.equal(r.contact_ip, '10.0.0.5');
  assert.equal(r.contact_port, 5060);
});

test('parseContactLine returns null for non-Contact lines', () => {
  assert.equal(parseContactLine('Endpoint:  org_X__09'), null);
  assert.equal(parseContactLine(''), null);
  assert.equal(parseContactLine('===================='), null);
  assert.equal(parseContactLine('Total Contacts: 5'), null);
});

test('parseContactLine returns null for malformed Contact (missing slash)', () => {
  assert.equal(parseContactLine('  Contact:  malformed_no_slash abc Avail 10'), null);
});

test('CONTACT_LINE_REGEX is exposed for regression testing', () => {
  assert.ok(CONTACT_LINE_REGEX instanceof RegExp);
  assert.ok(CONTACT_URI_HOST_PORT_REGEX instanceof RegExp);
});

// ─── parseAllContacts ─────────────────────────────────────────────────────

test('parseAllContacts handles realistic multi-line output', () => {
  const stdout = [
    'Aor:  <Aor............................................>  <MaxContact>',
    '  Contact:  <Aor/ContactUri..........................> <Hash....> <Status> <RTT(ms)..>',
    '',
    'Aor:  org_demo__09                                  3',
    '  Contact:  org_demo__09/sip:09@192.168.0.76:40314 fcd699215a Avail   171.789',
    'Aor:  org_demo__01                                  3',
    '  Contact:  org_demo__01/sip:org_demo__01@49.207.232.227:37567;ob abcdef NonQual  -nan',
    'Aor:  org_demo__1003                                3',
    '  Contact:  org_demo__1003/sip:org_demo__1003@49.207.232.227:37567;ob xyz Avail  120.5',
    '',
    'Objects found: 3'
  ].join('\n');
  const map = parseAllContacts(stdout);
  assert.equal(map.size, 3);
  assert.equal(map.get('org_demo__09').status, 'reachable');
  assert.equal(map.get('org_demo__09').contact_ip, '192.168.0.76');
  assert.equal(map.get('org_demo__01').status, 'nonqual');
  assert.equal(map.get('org_demo__01').contact_ip, '49.207.232.227');
  assert.equal(map.get('org_demo__1003').status, 'reachable');
});

test('parseAllContacts handles empty input', () => {
  assert.equal(parseAllContacts('').size, 0);
  assert.equal(parseAllContacts(null).size, 0);
  assert.equal(parseAllContacts(undefined).size, 0);
});

test('parseAllContacts keeps the reachable contact when an AOR has multiple', () => {
  // Phone registered from both LAN (reachable) and WAN (nonqual after NAT timeout)
  const stdout = [
    '  Contact:  org_X__09/sip:9@10.0.0.5:5060 abc NonQual -nan',
    '  Contact:  org_X__09/sip:9@192.168.0.76:5060 abc Avail 100'
  ].join('\n');
  const map = parseAllContacts(stdout);
  assert.equal(map.size, 1);
  const r = map.get('org_X__09');
  assert.equal(r.status, 'reachable', 'reachable contact must win');
  assert.equal(r.contact_ip, '192.168.0.76');
});

test('parseAllContacts keeps the first contact if all have the same non-reachable status', () => {
  const stdout = [
    '  Contact:  org_X__09/sip:9@1.1.1.1:5060 abc Unavail -1',
    '  Contact:  org_X__09/sip:9@2.2.2.2:5060 abc Unavail -1'
  ].join('\n');
  const map = parseAllContacts(stdout);
  assert.equal(map.size, 1);
  assert.equal(map.get('org_X__09').contact_ip, '1.1.1.1');
});

test('parseAllContacts ignores garbage lines between Contact entries', () => {
  const stdout = [
    'random header line',
    '',
    '------------------',
    '  Contact:  org_X__09/sip:9@1.1.1.1:5060 abc Avail 10',
    'Aor:  blah',
    '  Contact:  org_X__08/sip:8@2.2.2.2:5060 abc Avail 20',
    'trailer'
  ].join('\n');
  const map = parseAllContacts(stdout);
  assert.equal(map.size, 2);
});

// ─── getAllUserRegistrations (cache + IO) ─────────────────────────────────

function makeMockIo(stdout, nowFn = () => 1000) {
  const calls = [];
  return {
    calls,
    exec: async (cmd, opts) => {
      calls.push({ cmd, opts });
      return { stdout, stderr: '' };
    },
    now: nowFn
  };
}

test('getAllUserRegistrations executes pjsip show contacts and returns parsed map', async () => {
  clearCache();
  const stdout = '  Contact:  org_X__09/sip:9@10.0.0.5:5060 abc Avail 10\n';
  const io = makeMockIo(stdout);
  const r = await getAllUserRegistrations({ io });
  assert.equal(io.calls.length, 1);
  assert.match(io.calls[0].cmd, /asterisk -rx "pjsip show contacts"/);
  assert.equal(r.map.size, 1);
  assert.equal(r.fromCache, false);
});

test('getAllUserRegistrations returns cached result within TTL', async () => {
  clearCache();
  let clock = 1000;
  const stdout = '  Contact:  org_X__09/sip:9@10.0.0.5:5060 abc Avail 10\n';
  const io = makeMockIo(stdout, () => clock);
  await getAllUserRegistrations({ io });          // fetch 1
  clock = 1000 + 5000;                            // 5s later — within default 30s TTL
  const r = await getAllUserRegistrations({ io });
  assert.equal(io.calls.length, 1, 'must NOT re-fetch within TTL');
  assert.equal(r.fromCache, true);
});

test('getAllUserRegistrations re-fetches after TTL expires', async () => {
  clearCache();
  let clock = 1000;
  const stdout = '  Contact:  org_X__09/sip:9@10.0.0.5:5060 abc Avail 10\n';
  const io = makeMockIo(stdout, () => clock);
  await getAllUserRegistrations({ io, cacheTtlMs: 5000 });
  clock = 1000 + 5001;
  await getAllUserRegistrations({ io, cacheTtlMs: 5000 });
  assert.equal(io.calls.length, 2, 'must re-fetch after TTL');
});

test('getAllUserRegistrations with force=true bypasses cache', async () => {
  clearCache();
  const stdout = '  Contact:  org_X__09/sip:9@10.0.0.5:5060 abc Avail 10\n';
  const io = makeMockIo(stdout);
  await getAllUserRegistrations({ io });
  await getAllUserRegistrations({ io, force: true });
  assert.equal(io.calls.length, 2);
});

test('getAllUserRegistrations passes execTimeoutMs through to io.exec', async () => {
  clearCache();
  const io = makeMockIo('');
  await getAllUserRegistrations({ io, execTimeoutMs: 5000 });
  assert.equal(io.calls[0].opts.timeout, 5000);
});

test('DEFAULT_CACHE_TTL_MS is a reasonable interval', () => {
  assert.ok(DEFAULT_CACHE_TTL_MS >= 5_000, 'too aggressive ≤5s would shell-storm Asterisk');
  assert.ok(DEFAULT_CACHE_TTL_MS <= 120_000, 'too lax >120s would show stale registration state');
});

test('clearCache resets the module-scoped cache', async () => {
  clearCache();
  const io = makeMockIo('');
  await getAllUserRegistrations({ io });
  assert.equal(inspectCache().hasMap, true);
  clearCache();
  assert.equal(inspectCache().hasMap, false);
});

test('inspectCache returns size correctly', async () => {
  clearCache();
  const stdout = [
    '  Contact:  org_X__09/sip:9@10.0.0.5:5060 abc Avail 10',
    '  Contact:  org_X__08/sip:8@10.0.0.6:5060 abc Avail 12'
  ].join('\n');
  const io = makeMockIo(stdout);
  await getAllUserRegistrations({ io });
  assert.equal(inspectCache().size, 2);
});

// ─── Run sequentially ─────────────────────────────────────────────────────

(async () => {
  for (const t of testQueue) await t();
  clearCache();  // clean up after test run so other test files see fresh state
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
