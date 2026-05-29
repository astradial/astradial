'use strict';

/**
 * Edge-case scenarios — each test maps to a real failure mode we either
 * already saw in production or could plausibly see in the next 12 months
 * of running this in 100 hospitals. Bias toward defensive checks.
 */

require('./fixtures/stub-models');
const test = require('node:test');
const assert = require('node:assert/strict');

const QueueService = require('../src/services/asterisk/queueService');
const DialplanGenerator = require('../src/services/asterisk/dialplanGenerator');
const {
  makeOrg,
  makeQueue,
  makeQueueMember,
  makeSoftphoneUser,
  makePhoneTargetUser,
  makeAiAgentUser,
  makeInactiveUser,
  makeUser,
} = require('./fixtures/factories');

const svc = new QueueService();
const gen = new DialplanGenerator();
const org = makeOrg();

// ─── Hospital-realistic queue topologies ────────────────────────────────

test('E1: Thangavelu Br1 shape (Landline phone-target + 2 softphones) → ringinuse=yes', () => {
  const q = makeQueue({
    members: [
      makeQueueMember(makePhoneTargetUser({ id: 'u1', full_name: 'Landline' }), { ring_timeout_seconds: 60, penalty: 0 }),
      makeQueueMember(makeSoftphoneUser({ id: 'u2', full_name: 'Raman' }), { ring_timeout_seconds: 20, penalty: 1 }),
      makeQueueMember(makeSoftphoneUser({ id: 'u3', full_name: 'Punitha' }), { ring_timeout_seconds: 20, penalty: 2 }),
    ],
  });
  const cfg = svc.generateSingleQueueConfig(q, org);
  assert.match(cfg, /^ringinuse=yes$/m);
  assert.match(cfg, /^timeout=110$/m); // 60+20+20+10
});

test('E2: all-softphone queue (typical IT desk) preserves ringinuse=no', () => {
  const q = makeQueue({
    members: [1, 2, 3].map((i) => makeQueueMember(makeSoftphoneUser({ id: `u${i}` }))),
  });
  const cfg = svc.generateSingleQueueConfig(q, org);
  assert.match(cfg, /^ringinuse=no$/m);
});

test('E3: 100-member queue (load test shape)', () => {
  const members = [];
  for (let i = 0; i < 100; i++) {
    members.push(makeQueueMember(makeSoftphoneUser({ id: `u${i}` }), { ring_timeout_seconds: 5, penalty: i }));
  }
  const q = makeQueue({ members });
  const cfg = svc.generateSingleQueueConfig(q, org);
  // 100 × 5s = 500s + 10 buffer = 510s
  assert.match(cfg, /^timeout=510$/m);
});

test('E4: queue with mixed inactive + active → only active counted', () => {
  const q = makeQueue({
    members: [
      makeQueueMember(makeSoftphoneUser({ id: 'a' }), { ring_timeout_seconds: 30 }),
      makeQueueMember(makeInactiveUser({ id: 'b' }), { ring_timeout_seconds: 999 }),
      makeQueueMember(makeSoftphoneUser({ id: 'c' }), { ring_timeout_seconds: 10 }),
    ],
  });
  const cfg = svc.generateSingleQueueConfig(q, org);
  assert.match(cfg, /^timeout=50$/m); // 30+10+10
});

test('E5: single AI agent + 2 humans → ringinuse=yes (forced by AI Custom: state_interface)', () => {
  const q = makeQueue({
    members: [
      makeQueueMember(makeSoftphoneUser({ id: 'a' })),
      makeQueueMember(makeAiAgentUser({ id: 'b' })),
      makeQueueMember(makeSoftphoneUser({ id: 'c' })),
    ],
  });
  assert.match(svc.generateSingleQueueConfig(q, org), /^ringinuse=yes$/m);
});

// ─── Dialplan stress / variant scenarios ────────────────────────────────

test('E6: queue ext with timeout dest type=phone normalises 12-digit input to 10 digits', () => {
  const block = gen.generateQueueExtension(makeQueue({
    timeout_destination: '919876543210',
    timeout_destination_type: 'phone',
    members: [makeQueueMember(makeSoftphoneUser())],
  }), org);
  assert.match(block, /Dial\(PJSIP\/9876543210@org_test_trunk,/);
});

test('E7: queue ext with timeout dest type=phone strips formatting', () => {
  const block = gen.generateQueueExtension(makeQueue({
    timeout_destination: '+91 (994) 442-1125',
    timeout_destination_type: 'phone',
    members: [makeQueueMember(makeSoftphoneUser())],
  }), org);
  assert.match(block, /Dial\(PJSIP\/9876543210@org_test_trunk,/);
});

test('E8: queue ext greeting_id wires Playback BEFORE Queue', () => {
  const block = gen.generateQueueExtension(makeQueue({
    greeting_id: 'g1234',
    members: [makeQueueMember(makeSoftphoneUser())],
  }), org);
  const pbIdx = block.indexOf('Playback(/var/lib/asterisk/sounds/greetings/greeting_g1234)');
  const qIdx = block.indexOf('Queue(');
  assert.ok(pbIdx >= 0 && qIdx >= 0 && pbIdx < qIdx, 'greeting playback must precede Queue()');
});

test('E9: queue ext recording defaults ON when org-level enabled', () => {
  const block = gen.generateQueueExtension(makeQueue({
    recording_enabled: true,
    members: [makeQueueMember(makeSoftphoneUser())],
  }), org);
  assert.match(block, /MixMonitor\(\/var\/spool\/asterisk\/monitor/);
});

test('E10: queue ext recording skipped when org-level disabled', () => {
  const noRecOrg = makeOrg({ settings: { recording_enabled: false } });
  const block = gen.generateQueueExtension(makeQueue({
    recording_enabled: true,
    members: [makeQueueMember(makeSoftphoneUser())],
  }), noRecOrg);
  assert.doesNotMatch(block, /MixMonitor/);
});

test('E11: queue ext queue-level recording_enabled=false overrides org-on', () => {
  const block = gen.generateQueueExtension(makeQueue({
    recording_enabled: false,
    members: [makeQueueMember(makeSoftphoneUser())],
  }), org);
  assert.doesNotMatch(block, /MixMonitor/);
});

// ─── User extension dialplan variants ──────────────────────────────────

test('E12: user ext ai_agent routing → Stasis(...) call', () => {
  const u = makeUser({ routing_type: 'ai_agent', routing_destination: 'agent-uuid-here', asterisk_endpoint: null });
  const block = gen.generateUserExtension(u, org);
  assert.match(block, /Stasis\(pbx_api,ai_agent,agent-uuid-here\)/);
});

test('E13: user ext phone-target routing → Dial via trunk', () => {
  const u = makeUser({
    ring_target: 'phone',
    routing_type: 'sip',
    phone_number: '+91 9999900000',
    asterisk_endpoint: null,
  });
  const block = gen.generateUserExtension(u, org);
  // 10-digit normalisation
  assert.match(block, /Dial\(PJSIP\/9999900000@/);
});

test('E14: user with no endpoint AND no failover plays "not available" announce', () => {
  const u = makeUser({ asterisk_endpoint: null, ring_target: 'phone', routing_destination: null, failover_phone_number: null });
  const block = gen.generateUserExtension(u, org);
  // No routing destination → falls through to announce
  assert.match(block, /Playback\(the-person-at-exten\)/);
});

// ─── Queue member helper context ───────────────────────────────────────

test('E15: phone-target member helper dials trunk with member ring_timeout', () => {
  const m = makeQueueMember(makePhoneTargetUser({ id: 'u1', phone_number: '+91 8765432100' }), { ring_timeout_seconds: 45 });
  const q = makeQueue({ members: [m] });
  const ctx = gen.generateQueueMemberContext({ ...org, queues: [{ ...q, status: 'active' }] });
  assert.match(ctx, /Dial\(PJSIP\/8765432100@org_test_trunk,45,tT\)/);
});

test('E16: softphone member helper dials PJSIP endpoint with member ring_timeout', () => {
  const m = makeQueueMember(makeSoftphoneUser({ asterisk_endpoint: 'org_test_1001' }), { ring_timeout_seconds: 25 });
  const q = makeQueue({ members: [m] });
  const ctx = gen.generateQueueMemberContext({ ...org, queues: [{ ...q, status: 'active' }] });
  assert.match(ctx, /Dial\(PJSIP\/org_test_1001,25,tT\)/);
});

test('E17: ai_agent member helper invokes Stasis(...)', () => {
  const m = makeQueueMember(makeAiAgentUser({ routing_destination: 'agent-ai-1' }));
  const q = makeQueue({ members: [m] });
  const ctx = gen.generateQueueMemberContext({ ...org, queues: [{ ...q, status: 'active' }] });
  assert.match(ctx, /Stasis\(pbx_api,ai_agent,agent-ai-1\)/);
});

test('E18: qm helper context never emits GotoIf without $[...]', () => {
  const q = makeQueue({
    members: [
      makeQueueMember(makeSoftphoneUser({ id: 'a' })),
      makeQueueMember(makePhoneTargetUser({ id: 'b' })),
    ],
  });
  const ctx = gen.generateQueueMemberContext({ ...org, queues: [{ ...q, status: 'active' }] });
  const bad = ctx.match(/GotoIf\(\$\{[^}]+\}=[^?[$]+\?/g);
  assert.equal(bad, null, 'qm helper context has unwrapped GotoIf truthy bug instances');
});

// ─── Phone normalisation edge cases ────────────────────────────────────

test('E19: queue timeout dest "phone" handles 13-digit (with country code dropped)', () => {
  const block = gen.generateQueueExtension(makeQueue({
    timeout_destination: '0091 9994421125',
    timeout_destination_type: 'phone',
    members: [makeQueueMember(makeSoftphoneUser())],
  }), org);
  assert.match(block, /Dial\(PJSIP\/9994421125@org_test_trunk/);
});

// ─── Member name sanitisation ──────────────────────────────────────────

test('E20: member with quote and comma in full_name still emits one valid line', () => {
  const u = makeSoftphoneUser({ full_name: 'O"Brien, "The Boss" Pat' });
  const s = svc.generateQueueMemberString(makeQueueMember(u), org);
  const parts = s.split(',');
  assert.equal(parts.length, 4, 'must split into exactly 4 comma-separated fields');
});

// ─── Outbound CallerID leak on phone-target queue members ──────────────

test('E21: phone-target qm helper sets CallerID to org DID BEFORE Dial (prevents trunk-default leak)', () => {
  // Reproduced 2026-05-16: a call to Om Chambers' DID 918065978006 rang
  // a phone-target member but the member's phone displayed 918065978001
  // (a STAGING-routed DID with no org assignment) instead of 918065978006.
  // Root cause: qm helper emitted Dial(PJSIP/<phone>@trunk) without a
  // preceding Set(CALLERID(num)), so the From header inherited the parent
  // channel's CallerID (the external caller's number). Tata's SBC rejected
  // that and substituted the trunk's global default DID.
  const orgWithDids = makeOrg({
    dids: [
      { number: '918065978006', is_default: true, org_id: 'org-test-1' },
      { number: '918065978099', is_default: false, org_id: 'org-test-1' },
    ],
  });
  const m = makeQueueMember(makePhoneTargetUser({ id: 'u-phone-1', phone_number: '9876543210' }), { ring_timeout_seconds: 20 });
  const q = { ...makeQueue({ members: [m] }), status: 'active' };
  const ctx = gen.generateQueueMemberContext({ ...orgWithDids, queues: [q] });

  // The Set(CALLERID) line MUST appear before the Dial for this helper extension
  const helperBlock = ctx.match(/exten => qmu-phone-1[^\n]+\n([\s\S]+?)(?=\n; Queue|$)/);
  assert.ok(helperBlock || /qm[a-f0-9-]+/.test(ctx), 'helper block found');

  // Two assertions:
  // 1. The Set CallerID is emitted with the org's default DID
  assert.match(ctx, /Set\(CALLERID\(num\)=918065978006\)/,
    'phone-target qm helper must Set CallerID to org default DID');
  // 2. The Set MUST come before the Dial in the same extension
  const setIdx = ctx.indexOf('Set(CALLERID(num)=918065978006)');
  const dialIdx = ctx.indexOf('Dial(PJSIP/9876543210@');
  assert.ok(setIdx > 0 && dialIdx > setIdx,
    'Set(CALLERID) must come before Dial(PJSIP/...@trunk) in the qm helper');
});

test('E22: phone-target qm helper uses per-user outbound_did override when set', () => {
  const orgWithDids = makeOrg({
    dids: [
      { number: '918065978006', is_default: true, org_id: 'org-test-1' },
      { number: '918065978099', is_default: false, org_id: 'org-test-1' },
    ],
  });
  const u = makePhoneTargetUser({ id: 'u-phone-2', phone_number: '9876543210' });
  u.outbound_did = '918065978099';  // explicit per-user override
  const m = makeQueueMember(u, { ring_timeout_seconds: 20 });
  const q = { ...makeQueue({ members: [m] }), status: 'active' };
  const ctx = gen.generateQueueMemberContext({ ...orgWithDids, queues: [q] });
  // outbound_did takes priority over org default
  assert.match(ctx, /Set\(CALLERID\(num\)=918065978099\)/);
});

test('E23: phone-target qm helper falls back to first DID if no is_default', () => {
  const orgWithDids = makeOrg({
    dids: [
      { number: '918065978006', is_default: false, org_id: 'org-test-1' },
    ],
  });
  const m = makeQueueMember(makePhoneTargetUser({ id: 'u-phone-3', phone_number: '9876543210' }), { ring_timeout_seconds: 20 });
  const q = { ...makeQueue({ members: [m] }), status: 'active' };
  const ctx = gen.generateQueueMemberContext({ ...orgWithDids, queues: [q] });
  assert.match(ctx, /Set\(CALLERID\(num\)=918065978006\)/);
});

// ─── Decline behaviour: queue must advance immediately, no ride-out ────

test('E25: phone-target qm helper has NO QM_RING_START / Wait — decline must advance immediately', () => {
  // Hospital feedback 2026-05-16: an earlier ride-out implementation
  // (PR #204) padded the helper to full ring timeout on decline. That
  // made the next member wait the full window even when member 1 had
  // already declined — exactly the opposite of what was needed. Reverted.
  // Asterisk's app_queue advances on natural Dial exit (decline/busy/
  // no-answer) when no padding is present.
  const orgWithDids = makeOrg({ dids: [{ number: '918065978006', is_default: true }] });
  const m = makeQueueMember(makePhoneTargetUser({ id: 'u-p', phone_number: '9876543210' }), { ring_timeout_seconds: 30 });
  const q = { ...makeQueue({ members: [m] }), status: 'active' };
  const ctx = gen.generateQueueMemberContext({ ...orgWithDids, queues: [q] });
  // Dial line present
  assert.match(ctx, /Dial\(PJSIP\/9876543210@org_test_trunk,30,tT\)/);
  // No ride-out machinery
  assert.doesNotMatch(ctx, /QM_RING_START/);
  assert.doesNotMatch(ctx, /QM_REMAINING/);
  assert.doesNotMatch(ctx, /Wait\(\$\{QM_REMAINING\}\)/);
});

test('E26: softphone qm helper also has no ride-out — immediate advance on decline', () => {
  const m = makeQueueMember(makeSoftphoneUser({ id: 'u-s', asterisk_endpoint: 'org_test_1001' }), { ring_timeout_seconds: 25 });
  const q = { ...makeQueue({ members: [m] }), status: 'active' };
  const ctx = gen.generateQueueMemberContext({ ...makeOrg(), queues: [q] });
  assert.match(ctx, /Dial\(PJSIP\/org_test_1001,25,tT\)/);
  assert.doesNotMatch(ctx, /QM_RING_START|QM_REMAINING/);
});

test('E24: softphone qm helper does NOT need Set(CALLERID) (no trunk SBC validation)', () => {
  // Softphones dial PJSIP/<endpoint> directly — Asterisk doesn't go
  // through Tata's SBC for these, so the CallerID inheritance is fine.
  // Make sure we don't EMIT Set(CALLERID) for softphone members where
  // it's harmless but adds noise.
  const m = makeQueueMember(makeSoftphoneUser({ id: 'u-soft-1', asterisk_endpoint: 'org_test_1001' }));
  const q = { ...makeQueue({ members: [m] }), status: 'active' };
  const ctx = gen.generateQueueMemberContext({ ...makeOrg(), queues: [q] });
  // Find this helper's block
  const start = ctx.indexOf('qmu-soft-1');
  const end = ctx.indexOf('\n; Queue', start);
  const block = end > 0 ? ctx.slice(start, end) : ctx.slice(start);
  assert.doesNotMatch(block, /Set\(CALLERID/);
});
