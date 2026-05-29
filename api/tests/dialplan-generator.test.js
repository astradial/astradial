'use strict';

/**
 * dialplanGenerator unit tests.
 *
 * Invariants are derived from the 2026-05-15/16 Thangavelu Hospital
 * incident. Every GotoIf condition MUST be wrapped in `$[...]` (Asterisk's
 * truthiness check makes the raw form always-true) and every Goto label
 * referenced MUST have a corresponding `n(label)` entry.
 */

require('./fixtures/stub-models');
const test = require('node:test');
const assert = require('node:assert/strict');

const DialplanGenerator = require('../src/services/asterisk/dialplanGenerator');
const {
  makeOrg,
  makeQueue,
  makeQueueMember,
  makeSoftphoneUser,
  makePhoneTargetUser,
  makeAiAgentUser,
  makeUser,
} = require('./fixtures/factories');

const gen = new DialplanGenerator();
const org = makeOrg();

// ─── Helpers ────────────────────────────────────────────────────────────

// Extract every `GotoIf(...)` invocation from a dialplan block.
function getGotoIfs(block) {
  const out = [];
  const re = /GotoIf\(([^)]+)\?([^)]+)\)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const cond = m[1];
    const branches = m[2].split(':');
    out.push({ cond, trueLabel: branches[0], falseLabel: branches[1] || null });
  }
  return out;
}

// Extract every n(label) declaration in a block.
function getLabels(block) {
  const out = new Set();
  const re = /n\(([a-zA-Z_][a-zA-Z0-9_]*)\)/g;
  let m;
  while ((m = re.exec(block)) !== null) out.add(m[1]);
  return out;
}

// Every Goto(label_only) reference (single-arg form jumps to a label in
// the same extension).
function getLocalLabelReferences(block) {
  const out = new Set();
  // Goto(name) — single-arg form (no comma)
  const re = /Goto\(([a-zA-Z_][a-zA-Z0-9_]*)\)/g;
  let m;
  while ((m = re.exec(block)) !== null) out.add(m[1]);
  return out;
}

// ─── GotoIf must use $[...] ─────────────────────────────────────────────

test('D1: Queue post-Queue() GotoIf conditions are all wrapped in $[...]', () => {
  const q = makeQueue({
    members: [makeQueueMember(makeSoftphoneUser())],
    timeout_destination: '1008',
    timeout_destination_type: 'extension',
  });
  const block = gen.generateQueueExtension(q, org);
  const gotos = getGotoIfs(block);
  assert.ok(gotos.length > 0, 'expected at least one GotoIf in queue ext');
  for (const g of gotos) {
    assert.ok(g.cond.startsWith('${') ? false : g.cond.startsWith('$['),
      `GotoIf condition not wrapped in $[...]: ${g.cond}`);
  }
});

test('D2: User-extension dialplan GotoIf conditions are all wrapped in $[...]', () => {
  // Spec: a user with both PJSIP endpoint and a failover dest → expect
  // GotoIf($[${DEVSTATE}=NOT_INUSE]?...) and similar.
  const u = makeUser({
    ring_target: 'ext',
    routing_type: 'sip',
    asterisk_endpoint: 'org_test_1001',
    failover_phone_number: '+919876543210',
  });
  const block = gen.generateUserExtension(u, org);
  const gotos = getGotoIfs(block);
  assert.ok(gotos.length > 0, 'expected GotoIfs in user ext (failover path)');
  for (const g of gotos) {
    assert.ok(g.cond.startsWith('$['),
      `user-ext GotoIf condition not wrapped in $[...]: ${g.cond}`);
  }
});

test('D3: every Goto(label) target has a corresponding n(label) declaration', () => {
  const cases = [
    { name: 'queue with timeout dest', block: gen.generateQueueExtension(makeQueue({ timeout_destination: '1008', members: [makeQueueMember(makeSoftphoneUser())] }), org) },
    { name: 'queue no timeout dest', block: gen.generateQueueExtension(makeQueue({ members: [makeQueueMember(makeSoftphoneUser())] }), org) },
    { name: 'user with failover', block: gen.generateUserExtension(makeUser({ asterisk_endpoint: 'org_test_1001', failover_phone_number: '+919876543210' }), org) },
    { name: 'user no failover', block: gen.generateUserExtension(makeUser({ asterisk_endpoint: 'org_test_1001' }), org) },
  ];
  for (const c of cases) {
    const labels = getLabels(c.block);
    const refs = getLocalLabelReferences(c.block);
    for (const ref of refs) {
      assert.ok(labels.has(ref),
        `[${c.name}] Goto(${ref}) has no matching n(${ref}) — orphan label causes Asterisk runtime warning and dropped calls`);
    }
  }
});

// ─── Queue ext must NOT have the old broken structure ──────────────────

test('D4: queue ext has [normal_end] label (so ANSWERED bypasses timeout dest)', () => {
  const block = gen.generateQueueExtension(makeQueue({ timeout_destination: '1008', members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /n\(normal_end\)/);
});

test('D5: queue ext has [timeout] label', () => {
  const block = gen.generateQueueExtension(makeQueue({ timeout_destination: '1008', members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /n\(timeout\)/);
});

test('D6: queue ext has [unavail] label (avoids orphan Goto for empty queue states)', () => {
  const block = gen.generateQueueExtension(makeQueue({ members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /n\(unavail\)/);
});

test('D7: queue ext explicitly checks QUEUESTATUS=TIMEOUT before routing to timeout dest', () => {
  const block = gen.generateQueueExtension(makeQueue({ timeout_destination: '1008', members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /GotoIf\(\$\[\$\{QUEUESTATUS\}=TIMEOUT\]\?timeout\)/);
});

test('D8: queue ext routes ANSWERED to normal_end (not timeout dest)', () => {
  const block = gen.generateQueueExtension(makeQueue({ timeout_destination: '1008', members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /GotoIf\(\$\[\$\{QUEUESTATUS\}=ANSWERED\]\?normal_end\)/);
});

test('D9: queue ext routes CONTINUE to normal_end', () => {
  const block = gen.generateQueueExtension(makeQueue({ timeout_destination: '1008', members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /GotoIf\(\$\[\$\{QUEUESTATUS\}=CONTINUE\]\?normal_end\)/);
});

test('D10: queue ext Queue() options include "c" (continue on member hangup) and "t" (transfer)', () => {
  const block = gen.generateQueueExtension(makeQueue({ members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /Queue\(org_test_5001,ct,/);
});

test('D11: queue ext sets max_wait_time as Queue() 5th arg (operator-configured)', () => {
  const block = gen.generateQueueExtension(makeQueue({ max_wait_time: 420, members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /Queue\(org_test_5001,ct,,,420\)/);
});

test('D12: queue ext default max_wait_time = 45 when not set', () => {
  const block = gen.generateQueueExtension(makeQueue({ max_wait_time: undefined, members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /Queue\(org_test_5001,ct,,,45\)/);
});

test('D13: queue ext sets CDR(queue_name) for ticket classifier visibility', () => {
  const block = gen.generateQueueExtension(makeQueue({ name: 'Reception', members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /Set\(CDR\(queue_name\)=Reception\)/);
});

test('D14: queue ext sets hangup_handler_push so h-extension runs', () => {
  const block = gen.generateQueueExtension(makeQueue({ members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /Set\(CHANNEL\(hangup_handler_push\)=org_test_hangup,h,1\)/);
});

test('D15: queue ext Answer() before Queue() so MOH is audible', () => {
  const block = gen.generateQueueExtension(makeQueue({ members: [makeQueueMember(makeSoftphoneUser())] }), org);
  // Answer must appear BEFORE Queue
  const ansIdx = block.indexOf('Answer()');
  const qIdx = block.indexOf('Queue(');
  assert.ok(ansIdx >= 0 && qIdx >= 0, 'both Answer and Queue present');
  assert.ok(ansIdx < qIdx, 'Answer must precede Queue');
});

// ─── Queue ext: timeout destination routing variants ────────────────────

test('D16: timeout_destination_type=extension → Goto(<org>_internal,<ext>,1)', () => {
  const block = gen.generateQueueExtension(makeQueue({ timeout_destination: '1008', timeout_destination_type: 'extension', members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /n\(timeout\),Goto\(org_test_internal,1008,1\)/);
});

test('D17: timeout_destination_type=queue → Goto(<org>_queue,<num>,1)', () => {
  const block = gen.generateQueueExtension(makeQueue({ timeout_destination: '5009', timeout_destination_type: 'queue', members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /n\(timeout\),Goto\(org_test_queue,5009,1\)/);
});

test('D18: timeout_destination_type=phone → Dial via trunk with 10-digit normalisation', () => {
  const block = gen.generateQueueExtension(makeQueue({ timeout_destination: '+91 99444 21125', timeout_destination_type: 'phone', members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /n\(timeout\),Dial\(PJSIP\/9876543210@org_test_trunk,30,tT\)/);
});

test('D19: no timeout_destination → playback queue-no-agents-available then Hangup', () => {
  const block = gen.generateQueueExtension(makeQueue({ timeout_destination: null, members: [makeQueueMember(makeSoftphoneUser())] }), org);
  assert.match(block, /n\(timeout\),Playback\(queue-no-agents-available\)/);
});

// ─── Failover / user-ext GotoIf bug (P0 #1 from audit) ──────────────────

test('D20: user-ext DEVSTATE check uses $[...] for proper string equality (was broken pre-PR-200)', () => {
  const u = makeUser({ asterisk_endpoint: 'org_test_1001', failover_phone_number: '+919999999999' });
  const block = gen.generateUserExtension(u, org);
  // The OLD broken form was `GotoIf(${DEVSTATE}=NOT_INUSE?available:check_busy)`
  // which is always truthy. New form must be `GotoIf($[${DEVSTATE}=NOT_INUSE]?...)`.
  assert.match(block, /GotoIf\(\$\[\$\{DEVSTATE\}=NOT_INUSE\]/);
});

test('D21: user-ext DIALSTATUS check uses $[...]', () => {
  const u = makeUser({ asterisk_endpoint: 'org_test_1001', failover_phone_number: '+919999999999' });
  const block = gen.generateUserExtension(u, org);
  assert.match(block, /GotoIf\(\$\[\$\{DIALSTATUS\}=NOANSWER\]/);
});

test('D22: user-ext routes (busy) and (unreachable) labels exist and are referenced', () => {
  const u = makeUser({ asterisk_endpoint: 'org_test_1001' });
  const block = gen.generateUserExtension(u, org);
  const labels = getLabels(block);
  const refs = getLocalLabelReferences(block);
  // Any reference to (busy) or (unreachable) MUST have a corresponding label
  for (const target of ['busy', 'unreachable']) {
    if (refs.has(target)) {
      assert.ok(labels.has(target), `Goto(${target}) referenced but no n(${target}) defined`);
    }
  }
});

test('D23: user-ext failover destination dials the configured failover number', () => {
  const u = makeUser({ asterisk_endpoint: 'org_test_1001', failover_phone_number: '+91 9888888888' });
  const block = gen.generateUserExtension(u, org);
  // After 10-digit normalisation
  assert.match(block, /Dial\(PJSIP\/9888888888@/);
});

test('D24: user-ext without failover plays "is not available" announce', () => {
  const u = makeUser({ asterisk_endpoint: 'org_test_1001', failover_phone_number: null, failover_destination_user_id: null });
  const block = gen.generateUserExtension(u, org);
  assert.match(block, /Playback\(the-person-at-exten\)/);
});

// ─── IVR / hangup / other generators ────────────────────────────────────

test('D25: hangup handler does not contain GotoIf (no conditional routing)', () => {
  const block = gen.generateHangupHandlerContext(org);
  assert.equal(getGotoIfs(block).length, 0);
});

test('D26: hangup handler sets CDR fields and Return()s', () => {
  const block = gen.generateHangupHandlerContext(org);
  assert.match(block, /Set\(CDR\(organization_id\)/);
  assert.match(block, /Set\(CDR\(hangup_reason\)/);
  assert.match(block, /Return\(\)/);
});

// ─── IVR timeout — max_retries applies to ALL actions ──────────────────────

// Minimal inline IVR fixture (no makeIvr factory yet). All numeric fields
// set so validateIvrNumeric in the route wouldn't choke; the generator
// only reads timeout_action, timeout_destination, max_retries, extension.
function makeIvr(overrides = {}) {
  return Object.assign({
    id: 'ivr-test-id',
    extension: '7001',
    name: 'Test IVR',
    timeout: 8,
    max_retries: 2,
    greeting_prompt: 'greeting_test',
    timeout_action: 'retry',
    timeout_destination: null,
    timeout_prompt: null,
    invalid_prompt: null,
  }, overrides);
}

test('D27: IVR t-extension always increments IVR_RETRIES + GotoIf before terminal action', () => {
  // Regression for 2026-05-16 Thangavelu: operator set max_retries=2 +
  // action=queue and expected 2 greeting plays before queue routing,
  // but the OLD generator emitted Goto(queue,...) on FIRST timeout
  // ignoring max_retries entirely.
  for (const action of ['queue', 'extension', 'hangup', 'retry']) {
    const block = gen.generateIvrExtension(
      makeIvr({ timeout_action: action, timeout_destination: '5002', max_retries: 2 }),
      org
    );
    // Increment must precede any Goto/Playback inside the `t` extension.
    const tBlock = block.match(/(exten => t,[\s\S]+?)\n\n/)[1];
    assert.match(tBlock, /Set\(IVR_RETRIES=\$\[\$\{IVR_RETRIES\} \+ 1\]\)/,
      `[${action}] t-extension must increment IVR_RETRIES`);
    assert.match(tBlock, /GotoIf\(\$\[\$\{IVR_RETRIES\} < 2\]\?7001,start\)/,
      `[${action}] t-extension must retry to (start) when retries < max`);
  }
});

test('D28: IVR timeout_action=queue routes to queue context AFTER max_retries exhausted', () => {
  const block = gen.generateIvrExtension(
    makeIvr({ timeout_action: 'queue', timeout_destination: '5002', max_retries: 2 }),
    org
  );
  const tBlock = block.match(/(exten => t,[\s\S]+?)\n\n/)[1];
  // Sequence inside t: NoOp → Set retries → GotoIf retry → Goto queue
  const lines = tBlock.split('\n').filter(Boolean);
  const gotoIfIdx = lines.findIndex((l) => l.includes('GotoIf'));
  const queueGotoIdx = lines.findIndex((l) => l.includes('Goto(') && l.includes('_queue,5002,1'));
  assert.ok(gotoIfIdx > 0 && queueGotoIdx > gotoIfIdx,
    'queue Goto must appear AFTER the retry GotoIf');
});

test('D29: IVR timeout_action=extension routes to internal context after max_retries', () => {
  const block = gen.generateIvrExtension(
    makeIvr({ timeout_action: 'extension', timeout_destination: '1008', max_retries: 3 }),
    org
  );
  assert.match(block, /GotoIf\(\$\[\$\{IVR_RETRIES\} < 3\]\?7001,start\)/);
  assert.match(block, /Goto\(org_test_internal,1008,1\)/);
});

test('D30: IVR timeout_action=hangup plays prompt then hangs up AFTER max_retries', () => {
  const block = gen.generateIvrExtension(
    makeIvr({ timeout_action: 'hangup', max_retries: 2, timeout_prompt: null }),
    org
  );
  const tBlock = block.match(/(exten => t,[\s\S]+?)\n\n/)[1];
  // Retry GotoIf precedes the Playback+Hangup terminal sequence.
  assert.match(tBlock, /GotoIf\(\$\[\$\{IVR_RETRIES\} < 2\]\?7001,start\)/);
  assert.match(tBlock, /Playback\(pm-invalid-option\)/);
  assert.match(tBlock, /Hangup\(\)/);
});

test('D31: max_retries=1 fires terminal action on first timeout (no retry)', () => {
  // Operator-controllable knob to preserve the old "fire immediately"
  // behavior for orgs that explicitly want it. GotoIf($[1 < 1]) is
  // false on first hit so control falls straight through to Goto.
  const block = gen.generateIvrExtension(
    makeIvr({ timeout_action: 'queue', timeout_destination: '5002', max_retries: 1 }),
    org
  );
  assert.match(block, /GotoIf\(\$\[\$\{IVR_RETRIES\} < 1\]\?7001,start\)/);
});

test('D32: IVR timeout_action defaults to retry+hangup when missing destination', () => {
  // Defensive: action=queue with no destination should not emit a
  // broken Goto. Falls through to the safe Playback+Hangup terminal.
  const block = gen.generateIvrExtension(
    makeIvr({ timeout_action: 'queue', timeout_destination: null, max_retries: 2 }),
    org
  );
  assert.doesNotMatch(block, /Goto\(org_test_queue,/);
  assert.match(block, /Hangup\(\)/);
});
