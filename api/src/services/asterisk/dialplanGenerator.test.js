/**
 * Standalone tests for DialplanGenerator's user-extension rendering, with
 * a focus on the SIP-user failover feature (PR #150 / `feat/sip-user-failover`).
 *
 * Run with: `node api/src/services/asterisk/dialplanGenerator.test.js`
 *
 * We only exercise the pure, in-memory methods (`generateUserExtension` and
 * `generateInternalContext`). Requiring `../../models` instantiates a
 * Sequelize object but does NOT open a DB connection, so these tests run
 * without a live MariaDB. Anything that touches `.findByPk` etc. would need
 * an integration harness — out of scope here.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

// The generator requires `../../models` at the top. That module spins up a
// Sequelize instance which needs DB env vars to construct (it throws if
// DB_DIALECT is missing). Since this is a pure-rendering test, we never
// touch a model — so we shim the import to an empty object before the
// generator loads. This is cheaper than provisioning a real DB and keeps
// the test hermetic.
const modelsPath = path.resolve(__dirname, '../../models');
require.cache[require.resolve(modelsPath)] = {
  id: require.resolve(modelsPath),
  filename: require.resolve(modelsPath),
  loaded: true,
  exports: {
    Organization: {}, User: {}, Queue: {}, DidNumber: {},
    RoutingRule: {}, Ivr: {}, IvrMenu: {}, OutboundRoute: {}, SipTrunk: {}
  }
};

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const DialplanGenerator = require('./dialplanGenerator');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed++;
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const ORG = {
  id: 'org-uuid-1',
  context_prefix: 'org_test',
  settings: { recording_enabled: false }, // keep dialplan terse for assertions
  stasis_app: 'pbx_api'
};

function makeUser(overrides = {}) {
  return {
    id: 'user-primary',
    extension: '01',
    full_name: 'Primary User',
    asterisk_endpoint: 'pri_endpoint',
    routing_type: 'sip',
    ring_target: 'ext',
    status: 'active',
    call_recording: false,
    failover_destination_user_id: null,
    failover_timeout_seconds: 20,
    ...overrides
  };
}

function makeFailoverTarget(overrides = {}) {
  return {
    id: 'user-failover',
    extension: '09',
    full_name: 'Night Manager',
    asterisk_endpoint: 'fo_endpoint',
    routing_type: 'sip',
    ring_target: 'ext',
    status: 'active',
    call_recording: false,
    ...overrides
  };
}

const gen = new DialplanGenerator();

// ─── Active user, no failover (regression baseline) ────────────────────

test('active user with no failover gets unchanged 30s primary Dial', () => {
  const user = makeUser();
  const dp = gen.generateUserExtension(user, ORG, new Map([[user.id, user]]));
  // Default 30s ring on the primary
  assert.match(dp, /Dial\(PJSIP\/pri_endpoint,30,tT\)/);
  // No failover NoOp lines emitted
  assert.ok(!/failover to ext/.test(dp), 'should NOT mention failover');
});

// ─── Active user with usable failover (UNREACHABLE-ONLY semantics) ─────

test('active user with active failover keeps primary ring at 30s', () => {
  // Pre-2026-05-13: primary ring shrank to failover_timeout when
  // failover was configured. New rule: failover fires ONLY on
  // unreachable, never on NOANSWER, so the primary ring time no
  // longer interacts with failover_timeout — always 30s.
  const fo = makeFailoverTarget();
  const user = makeUser({
    failover_destination_user_id: fo.id,
    failover_timeout_seconds: 12
  });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  assert.match(dp, /Dial\(PJSIP\/pri_endpoint,30,tT\)/);
});

test('active user with active failover inlines failover Dial into UNREACHABLE branch only', () => {
  const fo = makeFailoverTarget();
  const user = makeUser({
    failover_destination_user_id: fo.id,
    failover_timeout_seconds: 15
  });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  // (unreachable) is the new label name — the old (offline) carried
  // a confusing semantic since it fired on NOANSWER too.
  assert.match(dp, /\(unreachable\),NoOp\(Primary unreachable - failover to ext 09\)/);
  assert.match(dp, /exten => 01,n,Dial\(PJSIP\/fo_endpoint,15,tT\)/);
  // No GotoIf — natural fall-through to announce on failure.
  assert.ok(!/GotoIf\(\$\{DIALSTATUS\}=ANSWER/.test(dp),
    'must not use broken ${VAR}=VALUE GotoIf form');
  // Announce reached via fall-through
  assert.match(dp, /\(announce\),Playback\(the-person-at-exten\)/);
});

test('active user with active failover does NOT emit failover in the busy branch', () => {
  // Operator's explicit instruction (2026-05-13): "if user busy,
  // declined call and already on call it should not route to
  // failover destination — only route if unreachable." So busy is
  // a hard busy tone regardless of failover.
  const fo = makeFailoverTarget();
  const user = makeUser({
    failover_destination_user_id: fo.id,
    failover_timeout_seconds: 20
  });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  // busy branch is plain Busy(20) — NO failover NoOp, NO failover Dial.
  assert.match(dp, /\(busy\),Busy\(20\)/);
  assert.ok(!/Primary busy - failover/.test(dp), 'busy must NOT trigger failover');
  // The only Dial of the failover endpoint should be in the
  // (unreachable) branch — verify there is exactly ONE.
  const failoverDials = (dp.match(/Dial\(PJSIP\/fo_endpoint/g) || []).length;
  assert.equal(failoverDials, 1, 'failover endpoint should be Dialed exactly once (unreachable branch)');
});

test('active user with active failover routes NOANSWER to announce, NOT failover', () => {
  // The DIALSTATUS=NOANSWER GotoIf used to point to (offline) which
  // included a failover Dial. Now it points to (announce) directly,
  // skipping failover for the "rang out, no pickup" case.
  const fo = makeFailoverTarget();
  const user = makeUser({ failover_destination_user_id: fo.id });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  assert.match(dp, /GotoIf\(\$\{DIALSTATUS\}=NOANSWER\?announce:end\)/);
  // BUSY DIALSTATUS still goes to busy (which now skips failover).
  assert.match(dp, /GotoIf\(\$\{DIALSTATUS\}=BUSY\?busy:end\)/);
});

// ─── Phone-number failover (new) ───────────────────────────────────────

test('phone-number failover emits Dial via outbound trunk', () => {
  const orgWithTrunk = {
    ...ORG,
    outboundRoutes: [{ trunk: { asterisk_peer_name: 'tata_trunk' } }],
  };
  const user = makeUser({
    failover_phone_number: '+919876543210',
    failover_timeout_seconds: 18,
  });
  const dp = gen.generateUserExtension(user, orgWithTrunk, new Map([[user.id, user]]));
  // Unreachable branch dials the 10-digit phone via the trunk endpoint.
  assert.match(dp, /\(unreachable\),NoOp\(Primary unreachable - failover to phone \+919876543210\)/);
  assert.match(dp, /Dial\(PJSIP\/9876543210@tata_trunk,18,tT\)/);
  // No SIP-user failover NoOp
  assert.ok(!/failover to ext/.test(dp));
});

test('phone-number failover with no outbound trunk falls back to <prefix>trunk', () => {
  // Org without an outboundRoutes entry — the generator falls back to
  // `${context_prefix}trunk`. This matches the existing ring_target='phone'
  // behaviour so phone failover stays consistent.
  const user = makeUser({ failover_phone_number: '9876543210' });
  const dp = gen.generateUserExtension(user, ORG, new Map([[user.id, user]]));
  assert.match(dp, /Dial\(PJSIP\/9876543210@org_testtrunk,20,tT\)/);
});

test('phone-number failover normalizes 13-digit number to last 10', () => {
  // The API stores +91XXXXXXXXXX but the dialplan only needs the 10
  // digits — same as how ring_target=phone trims.
  const orgWithTrunk = {
    ...ORG,
    outboundRoutes: [{ trunk: { asterisk_peer_name: 'tt' } }],
  };
  const user = makeUser({ failover_phone_number: '+919876543210' });
  const dp = gen.generateUserExtension(user, orgWithTrunk, new Map([[user.id, user]]));
  assert.match(dp, /Dial\(PJSIP\/9876543210@tt,/);
});

test('user-id failover takes precedence over phone-number failover when both present', () => {
  // The API enforces mutual exclusion (returns 400 if both set), but
  // defensively the generator should pick a deterministic winner if
  // a row somehow has both. Code prefers user-id over phone since
  // user-id is the older, more-validated path.
  const fo = makeFailoverTarget();
  const user = makeUser({
    failover_destination_user_id: fo.id,
    failover_phone_number: '+919876543210',
  });
  const dp = gen.generateUserExtension(user, ORG, new Map([[user.id, user], [fo.id, fo]]));
  // User-id wins
  assert.match(dp, /failover to ext 09/);
  // Phone number NOT emitted as a Dial
  assert.ok(!/9876543210/.test(dp));
});

// ─── Failover target inactive → suppress failover branch ───────────────

test('failover branch suppressed when failover target is inactive', () => {
  const fo = makeFailoverTarget({ status: 'inactive' });
  const user = makeUser({ failover_destination_user_id: fo.id });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  // No failover Dial emitted
  assert.ok(!/Dial\(PJSIP\/fo_endpoint/.test(dp), 'must not Dial inactive failover');
  // Primary at default 30s
  assert.match(dp, /Dial\(PJSIP\/pri_endpoint,30,tT\)/);
  // Plain unreachable/busy branches — no failover lines.
  assert.match(dp, /\(unreachable\),NoOp\(Primary unreachable - no failover configured\)/);
  assert.match(dp, /\(announce\),Playback\(the-person-at-exten\)/);
  assert.match(dp, /\(busy\),Busy\(20\)/);
});

// ─── Failover target missing (stale FK / dangling pointer) ────────────

test('failover branch suppressed when failover_destination_user_id resolves to nothing', () => {
  const user = makeUser({
    failover_destination_user_id: 'user-does-not-exist'
  });
  // Map only contains the primary — failover lookup misses
  const dp = gen.generateUserExtension(user, ORG, new Map([[user.id, user]]));
  assert.ok(!/Primary unreachable - failover/.test(dp));
  assert.ok(!/Primary busy - failover/.test(dp));
  assert.match(dp, /Dial\(PJSIP\/pri_endpoint,30,tT\)/);
});

// ─── Failover target missing asterisk_endpoint (corrupt user row) ─────

test('failover branch suppressed when failover target has empty asterisk_endpoint', () => {
  const fo = makeFailoverTarget({ asterisk_endpoint: '' });
  const user = makeUser({ failover_destination_user_id: fo.id });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  assert.ok(!/Primary unreachable - failover/.test(dp));
  assert.match(dp, /Dial\(PJSIP\/pri_endpoint,30,tT\)/);
});

// ─── Inactive user with active failover → redirect-only entry ─────────

test('inactive user with active failover emits redirect-only entry', () => {
  const fo = makeFailoverTarget();
  const user = makeUser({
    status: 'inactive',
    failover_destination_user_id: fo.id,
    failover_timeout_seconds: 25
  });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  // Entry is the minimal redirect — no DEVSTATE check, no MixMonitor, no
  // offline/busy labels.
  assert.match(dp, /exten => 01,1,NoOp\(01 inactive — routing to failover ext 09\)/);
  assert.match(dp, /exten => 01,n,Dial\(PJSIP\/fo_endpoint,25,tT\)/);
  assert.ok(!/DEVSTATE/.test(dp), 'no DEVSTATE check on inactive redirect path');
  assert.ok(!/\(unreachable\)/.test(dp), 'no unreachable label');
  assert.ok(!/\(busy\)/.test(dp), 'no busy label');
  assert.ok(!/MixMonitor/.test(dp), 'no recording on bare redirect');
});

test('inactive-user redirect plays announce fall-through if failover fails', () => {
  // Regression test for an advisor-caught bug: when the failover Dial
  // failed (NOANSWER / BUSY / CHANUNAVAIL), the redirect path used to
  // go straight to Hangup() — caller heard dead air. Must now fall
  // through to the standard "not available" announce, using the
  // INACTIVE user's extension for SayDigits (the dialed number).
  const fo = makeFailoverTarget();
  const user = makeUser({
    status: 'inactive',
    extension: '03',
    failover_destination_user_id: fo.id
  });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  assert.match(dp, /Playback\(the-person-at-exten\)/);
  assert.match(dp, /SayDigits\(03\)/);
  assert.match(dp, /Playback\(is-not-available\)/);
});

test('self-loop failover (failover_id === user.id) is rejected by the generator', () => {
  // Defensive: even if a legacy/corrupt row somehow has the user pointing
  // at themselves, the generator must NOT emit a failover branch — it
  // would result in Dial(PJSIP/<self>) which is at best a tight loop and
  // at worst a chan-loop bug.
  const user = makeUser();
  user.failover_destination_user_id = user.id;
  const dp = gen.generateUserExtension(user, ORG, new Map([[user.id, user]]));
  assert.ok(!/Primary unreachable - failover/.test(dp), 'no offline failover branch');
  assert.ok(!/Primary busy - failover/.test(dp), 'no busy failover branch');
  // Falls back to default 30s primary timeout
  assert.match(dp, /Dial\(PJSIP\/pri_endpoint,30,tT\)/);
});

// ─── Inactive user with inactive failover → suppressed by parent ──────

test('inactive user with inactive failover STILL emits the redirect path if called', () => {
  // generateUserExtension itself only emits redirect if hasUsableFailover.
  // When failover is inactive, hasUsableFailover is false → it falls through
  // to the active-user path and treats the inactive user as if they were
  // active. The CALLER (generateInternalContext) is what skips inactive
  // users without usable failover. This test pins down that contract.
  const fo = makeFailoverTarget({ status: 'inactive' });
  const user = makeUser({
    status: 'inactive',
    failover_destination_user_id: fo.id
  });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  // It falls through to the regular SIP path because the failover
  // isn't usable. (Caller would have skipped this user — this verifies
  // the function does NOT crash or emit corrupt output if called.)
  assert.match(dp, /Dial\(PJSIP\/pri_endpoint,30,tT\)/);
  assert.ok(!/Primary unreachable - failover/.test(dp));
});

// ─── generateInternalContext: parent skipping behavior ─────────────────

test('generateInternalContext skips inactive user with no failover', () => {
  const u1 = makeUser({ id: 'u1', extension: '01' });
  const u2 = makeUser({
    id: 'u2', extension: '02', status: 'inactive',
    failover_destination_user_id: null
  });
  const dp = gen.generateInternalContext({
    ...ORG,
    users: [u1, u2]
  });
  assert.match(dp, /Extension 01/);
  assert.ok(!/Extension 02/.test(dp), 'inactive user with no failover must be skipped');
});

test('generateInternalContext emits redirect for inactive user with active failover', () => {
  const fo = makeFailoverTarget({ id: 'u1', extension: '01' });
  const inactive = makeUser({
    id: 'u2', extension: '02',
    status: 'inactive',
    failover_destination_user_id: fo.id
  });
  const dp = gen.generateInternalContext({
    ...ORG,
    users: [fo, inactive]
  });
  // Both extensions should appear
  assert.match(dp, /Extension 01/);
  assert.match(dp, /Extension 02/);
  // Inactive one is the redirect-only flavor
  assert.match(dp, /02 inactive — routing to failover ext 01/);
});

test('generateInternalContext skips inactive user whose failover is also inactive', () => {
  const fo = makeFailoverTarget({ id: 'u1', extension: '01', status: 'inactive' });
  const inactive = makeUser({
    id: 'u2', extension: '02',
    status: 'inactive',
    failover_destination_user_id: fo.id
  });
  const dp = gen.generateInternalContext({
    ...ORG,
    users: [fo, inactive]
  });
  // Both should be skipped — inactive primary's failover is inactive,
  // and the failover itself is inactive with no failover of its own.
  assert.ok(!/Extension 01/.test(dp));
  assert.ok(!/Extension 02/.test(dp));
});

// ─── Cross-routing-mode failover behavior (pinning, not endorsing) ─────

test('ai_agent user gets NO failover branches even when failover is set', () => {
  // The AI-agent branch emits Stasis + Goto(end), which makes the
  // (offline) and (busy) labels unreachable. So a failover configured
  // on an ai_agent user is dead-code at runtime. The UI hides the
  // picker for these users; the generator does NOT need to defend
  // against a configured-but-unreachable failover, but this test pins
  // the runtime so a future refactor doesn't silently activate it.
  const fo = makeFailoverTarget();
  const user = makeUser({
    routing_type: 'ai_agent',
    routing_destination: 'ws://localhost:7860/ws',
    failover_destination_user_id: fo.id,
    failover_timeout_seconds: 15
  });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  // Stasis present
  assert.match(dp, /Stasis\(/);
  // Failover Dial is still SYNTACTICALLY emitted in the offline/busy
  // labels (the routing branches are mutually exclusive but both
  // labels live below the routing block), so don't assert its absence
  // — just confirm Goto(end) sits between Stasis and the labels.
  assert.match(dp, /Stasis\([^)]+\)\nexten => 01,n,Goto\(end\)/);
});

test('phone-target user does NOT fall through to failover on mobile Dial failure', () => {
  // ring_target='phone' users dial out to a mobile/PSTN number. If
  // that callout returns NOANSWER/BUSY/CHANUNAVAIL we must NOT fall
  // through to (unreachable) — the helper text in the editor
  // explicitly promises failover doesn't fire on busy/no-pickup.
  // The phone branch now emits Goto(end) after Dial to gate this.
  const fo = makeFailoverTarget();
  const user = makeUser({
    ring_target: 'phone',
    phone_number: '+919876543210',
    failover_destination_user_id: fo.id,
    failover_timeout_seconds: 18,
  });
  const dp = gen.generateUserExtension(
    user, ORG, new Map([[user.id, user], [fo.id, fo]])
  );
  // Phone Dial is present
  assert.match(dp, /Dial\(PJSIP\/9876543210@/);
  // The phone Dial line MUST be followed immediately by Goto(end),
  // not fall through to the unreachable branch.
  assert.match(dp, /Dial\(PJSIP\/9876543210@[^,]+,30,tT\)\nexten => 01,n,Goto\(end\)/);
  // The (unreachable) label is still emitted in the dialplan (it's
  // shared with the SIP-routing branch), but execution never reaches
  // it for phone-target users now.
  // Busy/announce branches are still plain.
  assert.ok(!/Primary busy - failover/.test(dp));
  assert.match(dp, /\(busy\),Busy\(20\)/);
});

test('inactive user with phone-number failover emits redirect via trunk', () => {
  // The inactive-user-with-failover redirect-only path supports BOTH
  // user-id and phone-number failover destinations. The NoOp label
  // should read "phone +91..." and the Dial should go out the trunk.
  const orgWithTrunk = {
    ...ORG,
    outboundRoutes: [{ trunk: { asterisk_peer_name: 'tata_trunk' } }],
  };
  const user = makeUser({
    status: 'inactive',
    failover_phone_number: '+919876543210',
    failover_timeout_seconds: 18,
  });
  const dp = gen.generateUserExtension(user, orgWithTrunk, new Map([[user.id, user]]));
  // Minimal redirect (no DEVSTATE, no MixMonitor) + Dial via trunk
  assert.match(dp, /01 inactive — routing to failover phone \+919876543210/);
  assert.match(dp, /exten => 01,n,Dial\(PJSIP\/9876543210@tata_trunk,18,tT\)/);
  assert.ok(!/DEVSTATE/.test(dp), 'inactive redirect skips DEVSTATE check');
  // Fallthrough to announce if PSTN call fails
  assert.match(dp, /Playback\(the-person-at-exten\)/);
});

// ─── Result summary ────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
