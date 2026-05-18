'use strict';

/**
 * queueService unit tests — validates emitted queues.conf content
 * against the invariants we care about for hospital-grade call routing.
 *
 * Each test maps to a real production scenario. The dialplan generator
 * is exercised in dialplan-generator.test.js separately so failures
 * here are localized to the queues.conf surface.
 */

require('./fixtures/stub-models');
const test = require('node:test');
const assert = require('node:assert/strict');

const QueueService = require('../src/services/asterisk/queueService');
const {
  makeOrg,
  makeQueue,
  makeQueueMember,
  makeSoftphoneUser,
  makePhoneTargetUser,
  makeAiAgentUser,
  makeInactiveUser,
} = require('./fixtures/factories');

const svc = new QueueService();
const org = makeOrg();

// Helper — pull the value of a `key=value` line from a config block.
function configValue(cfg, key) {
  const re = new RegExp('^' + key + '=(.+)$', 'm');
  const m = cfg.match(re);
  return m ? m[1].trim() : null;
}

function memberLines(cfg) {
  return cfg.split('\n').filter((l) => l.startsWith('member =>'));
}

// ─── ringinuse forcing ───

test('Q1: queue with single softphone member → ringinuse=no honors operator', () => {
  const m = makeQueueMember(makeSoftphoneUser());
  const q = makeQueue({ ring_inuse: false, members: [m] });
  const out = svc.generateSingleQueueConfig(q, org);
  assert.equal(configValue(out, 'ringinuse'), 'no');
});

test('Q2: same queue with ring_inuse=true → ringinuse=yes', () => {
  const m = makeQueueMember(makeSoftphoneUser());
  const q = makeQueue({ ring_inuse: true, members: [m] });
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'ringinuse'), 'yes');
});

test('Q3: queue with phone-target member → ringinuse forced to yes', () => {
  const m = makeQueueMember(makePhoneTargetUser());
  const q = makeQueue({ ring_inuse: false, members: [m] });
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'ringinuse'), 'yes');
});

test('Q4: queue with ai_agent member → ringinuse forced to yes', () => {
  const m = makeQueueMember(makeAiAgentUser());
  const q = makeQueue({ ring_inuse: false, members: [m] });
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'ringinuse'), 'yes');
});

test('Q5: queue with user missing asterisk_endpoint → ringinuse forced to yes', () => {
  const u = makeSoftphoneUser({ asterisk_endpoint: null });
  const q = makeQueue({ ring_inuse: false, members: [makeQueueMember(u)] });
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'ringinuse'), 'yes');
});

test('Q6: mixed softphone + phone-target → ringinuse=yes', () => {
  const q = makeQueue({
    ring_inuse: false,
    members: [
      makeQueueMember(makeSoftphoneUser({ id: 'u1' })),
      makeQueueMember(makePhoneTargetUser({ id: 'u2' })),
    ],
  });
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'ringinuse'), 'yes');
});

test('Q7: queue with INACTIVE phone-target member only → ringinuse follows operator (member skipped)', () => {
  const m = makeQueueMember(makePhoneTargetUser({ status: 'inactive' }));
  const q = makeQueue({ ring_inuse: false, members: [m] });
  // inactive members don't count toward Custom: forcing
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'ringinuse'), 'no');
});

test('Q8: empty members array → ringinuse follows operator', () => {
  const q = makeQueue({ ring_inuse: false, members: [] });
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'ringinuse'), 'no');
});

// ─── timeout (round budget) ───

test('Q9: timeout = sum of ring times + 10 (Thangavelu shape)', () => {
  const q = makeQueue({
    timeout: 20,
    members: [
      makeQueueMember(makePhoneTargetUser({ id: 'u1' }), { ring_timeout_seconds: 60 }),
      makeQueueMember(makePhoneTargetUser({ id: 'u2' }), { ring_timeout_seconds: 20 }),
    ],
  });
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'timeout'), '90');
});

test('Q10: timeout = sum + 10 (3 members)', () => {
  const q = makeQueue({
    timeout: 20,
    members: [1, 2, 3].map((i) =>
      makeQueueMember(makeSoftphoneUser({ id: `u${i}` }), { ring_timeout_seconds: 20 })
    ),
  });
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'timeout'), '70');
});

test('Q11: operator queue.timeout (large) beats sum+10', () => {
  const q = makeQueue({
    timeout: 600,
    members: [makeQueueMember(makeSoftphoneUser(), { ring_timeout_seconds: 20 })],
  });
  // sum+10 = 30, operator says 600 → use 600
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'timeout'), '600');
});

test('Q12: empty queue → timeout falls back to operator value', () => {
  const q = makeQueue({ timeout: 30, members: [] });
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'timeout'), '30');
});

test('Q13: ring_timeout_seconds default (20) when not set', () => {
  const m = makeQueueMember(makeSoftphoneUser(), { ring_timeout_seconds: undefined });
  const q = makeQueue({ timeout: 5, members: [m] });
  // 20 (default) + 10 = 30
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'timeout'), '30');
});

test('Q14: inactive members do NOT count in sum', () => {
  const q = makeQueue({
    timeout: 5,
    members: [
      makeQueueMember(makeSoftphoneUser({ id: 'a' }), { ring_timeout_seconds: 20 }),
      makeQueueMember(makeInactiveUser({ id: 'b' }), { ring_timeout_seconds: 200 }),
    ],
  });
  // only the active member counts; sum = 20 + 10 = 30
  assert.equal(configValue(svc.generateSingleQueueConfig(q, org), 'timeout'), '30');
});

// ─── member ordering + emission ───

test('Q15: members emitted in penalty-ascending order', () => {
  const q = makeQueue({
    members: [
      makeQueueMember(makeSoftphoneUser({ id: 'high' }), { penalty: 5 }),
      makeQueueMember(makeSoftphoneUser({ id: 'low' }), { penalty: 0 }),
      makeQueueMember(makeSoftphoneUser({ id: 'mid' }), { penalty: 2 }),
    ],
  });
  const lines = memberLines(svc.generateSingleQueueConfig(q, org));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /,0,/);
  assert.match(lines[1], /,2,/);
  assert.match(lines[2], /,5,/);
});

test('Q16: inactive member is NOT emitted as member', () => {
  const q = makeQueue({
    members: [
      makeQueueMember(makeSoftphoneUser({ id: 'a' })),
      makeQueueMember(makeInactiveUser({ id: 'b' })),
    ],
  });
  assert.equal(memberLines(svc.generateSingleQueueConfig(q, org)).length, 1);
});

// ─── generateQueueMemberString state_interface logic ───

test('Q17: softphone member → state_interface = PJSIP/<endpoint>', () => {
  const m = makeQueueMember(makeSoftphoneUser({ asterisk_endpoint: 'org_test_1001' }));
  const s = svc.generateQueueMemberString(m, org);
  assert.match(s, /,PJSIP\/org_test_1001$/);
});

test('Q18: phone-target member → state_interface = Custom:qm<id>', () => {
  const m = makeQueueMember(makePhoneTargetUser(), { id: 'aabb1122-cc33-dd44-ee55-ff6677889900' });
  const s = svc.generateQueueMemberString(m, org);
  assert.match(s, /,Custom:qmaabb1122cc33dd44ee55ff6677889900$/);
});

test('Q19: ai_agent member → state_interface = Custom:qm<id>', () => {
  const m = makeQueueMember(makeAiAgentUser(), { id: '11223344-5566-7788-99aa-bbccddeeff00' });
  const s = svc.generateQueueMemberString(m, org);
  // id with hyphens stripped → length 32 hex
  assert.match(s, /,Custom:qm[a-f0-9]{32}$/);
  assert.equal(s.split(',Custom:qm')[1], '112233445566778899aabbccddeeff00');
});

test('Q20: member with no endpoint AND ext target → Custom:qm<id>', () => {
  const u = makeSoftphoneUser({ asterisk_endpoint: null });
  const s = svc.generateQueueMemberString(makeQueueMember(u, { id: 'deadbeef-cafe-babe-feed-1234567890ab' }), org);
  assert.match(s, /,Custom:qm[a-f0-9]{32}$/);
  assert.equal(s.split(',Custom:qm')[1], 'deadbeefcafebabefeed1234567890ab');
});

test('Q21: member full_name with quote+comma is sanitised in the emitted line', () => {
  const u = makeSoftphoneUser({ full_name: 'O"Brien, Pat' });
  const s = svc.generateQueueMemberString(makeQueueMember(u), org);
  // Splits cleanly into 4 comma-separated parts (interface, penalty, name, state)
  const parts = s.split(',');
  assert.equal(parts.length, 4);
  // The name part must start and end with a single double-quote and contain
  // no inner commas or quotes that would break Asterisk's parser.
  const name = parts[2];
  assert.ok(name.startsWith('"') && name.endsWith('"'), 'name field quoted: ' + name);
  // Internal characters must not be `"` or `,`
  assert.doesNotMatch(name.slice(1, -1), /[",]/);
});

// ─── invariants on the emitted queues.conf ───

test('Q22: emitted config contains strategy', () => {
  const q = makeQueue({ strategy: 'linear' });
  assert.match(svc.generateSingleQueueConfig(q, org), /^strategy=linear$/m);
});

test('Q23: context= refers to org-prefix __queue context', () => {
  const cfg = svc.generateSingleQueueConfig(makeQueue(), org);
  assert.match(cfg, /^context=org_test_queue$/m);
});

test('Q24: musicclass + musiconhold both set to queue.music_on_hold', () => {
  const cfg = svc.generateSingleQueueConfig(makeQueue({ music_on_hold: 'classical' }), org);
  assert.match(cfg, /^musicclass=classical$/m);
  assert.match(cfg, /^musiconhold=classical$/m);
});

test('Q25: leavewhenempty respects queue.leave_when_empty', () => {
  assert.match(svc.generateSingleQueueConfig(makeQueue({ leave_when_empty: true }), org), /^leavewhenempty=yes$/m);
  assert.match(svc.generateSingleQueueConfig(makeQueue({ leave_when_empty: false }), org), /^leavewhenempty=no$/m);
});
