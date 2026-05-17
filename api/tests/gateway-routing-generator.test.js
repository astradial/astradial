'use strict';

/**
 * Tests for ConfigDeploymentService.buildGatewayRoutingConfig — the pure
 * string builder behind ext_tata_gateway.conf.
 *
 * Regression context: 2026-05-16 V7 inbound outage. A new Tata DID range
 * (8065080700-29) was added to the pool and assigned to Demo Hotel, but
 * inbound calls 404'd with "extension not found in context 'tata-inbound'".
 * Root cause: the generator emitted only `_+9180659780XX` (the original Tata
 * range) as inbound patterns, so any new range required a code change to
 * route at all. Fix: tata-inbound now emits pure pass-through patterns
 * (`_+X.` / `_X.`) and trusts tata-did-route — which is already DB-driven —
 * to decide what's known.
 */

require('./fixtures/stub-models');
const test = require('node:test');
const assert = require('node:assert/strict');

const ConfigDeploymentService = require('../src/services/asterisk/configDeploymentService');

// ─── Fixtures ──────────────────────────────────────────────────────────

const ORG_V7 = { id: 'org-v7', name: 'Demo Hotel', context_prefix: 'org_demo_' };
const ORG_OM = { id: 'org-om',  name: 'Om Chamber',    context_prefix: 'org_mo8vbv60_' };

function did(number, org, env = 'prod') {
  return { number, organization: org, routing_environment: env };
}

// ─── tata-inbound pass-through ─────────────────────────────────────────

test('tata-inbound emits + and no-plus pass-through patterns', () => {
  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: [did('+918065978007', ORG_V7)],
    env: 'prod',
    generatedAt: new Date('2026-05-16T00:00:00Z'),
  });

  // The + form: strip leading + via ${EXTEN:1}, then Goto tata-did-route
  assert.match(conf, /\[tata-inbound\]/);
  assert.match(conf, /exten => _\+X\.,1,NoOp\(Tata Inbound: \$\{EXTEN\} from \$\{CALLERID\(all\)\}\)/);
  assert.match(conf, /same => n,Set\(DID_CLEAN=\$\{EXTEN:1\}\)/);
  assert.match(conf, /same => n,Goto\(tata-did-route,\$\{DID_CLEAN\},1\)/);

  // The no-plus form
  assert.match(conf, /exten => _X\.,1,NoOp\(Tata Inbound \(no plus\): \$\{EXTEN\}\)/);
  assert.match(conf, /same => n,Set\(DID_CLEAN=\$\{EXTEN\}\)/);
});

test('tata-inbound does NOT hardcode the old 91806597 range anymore', () => {
  // Regression guard: the old code emitted `_+9180659780XX`, which silently
  // dropped any other Tata range. Adding a new range had to be code change.
  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: [did('+918065978007', ORG_V7)],
    env: 'prod',
  });

  // The exact pattern lives in tata-did-route as an exact-match (this is
  // correct), but NOT as a wildcard inbound pattern.
  assert.doesNotMatch(
    conf,
    /exten => _\+9180659780XX/,
    'tata-inbound must be pass-through; remove the hardcoded old-range wildcard'
  );
  assert.doesNotMatch(
    conf,
    /exten => _9180659780XX/,
    'tata-inbound must be pass-through; remove the hardcoded old-range no-plus wildcard'
  );
});

// ─── New range support (the V7 incident) ───────────────────────────────

test('new Tata range +918065080700-29 routes via tata-inbound → tata-did-route → org', () => {
  // Mirrors the actual prod state on 2026-05-16: V7 owns the new range.
  const newRange = [];
  for (let n = 700; n <= 729; n++) newRange.push(did(`+91806508${String(n).padStart(4, '0')}`, ORG_V7));

  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: newRange,
    env: 'prod',
  });

  // tata-inbound _+X. should match the entire range without per-range patterns.
  // (We can't run the Asterisk pattern matcher in this test; instead we assert
  // the wildcard is the ONLY mechanism for inbound — see the test above.)

  // tata-did-route should have an exact-match Goto for every DID in the range,
  // in BOTH formats (the indianAliases helper emits 91... and 0... aliases).
  for (let n = 700; n <= 729; n++) {
    const intl = `91806508${String(n).padStart(4, '0')}`;     // 918065080708
    const local = `08065080${String(n).padStart(3, '0')}`;    // 08065080708 — wrong length, recompute

    // Re-derive correctly: 12-digit international -> 11-digit local with leading 0.
    const localCorrect = '0' + intl.substring(2);
    const intlMatch = new RegExp(`exten => ${intl},1,Goto\\(${ORG_V7.context_prefix}_incoming,${intl},1\\)`);
    const localMatch = new RegExp(`exten => ${localCorrect},1,Goto\\(${ORG_V7.context_prefix}_incoming,${localCorrect},1\\)`);
    assert.match(conf, intlMatch, `intl-form Goto missing for ${intl}`);
    assert.match(conf, localMatch, `local-form Goto missing for ${localCorrect}`);
  }
});

test('the exact DID from the 2026-05-16 V7 incident routes correctly', () => {
  // This is the test that would have caught my pattern bug on the cloud
  // hand-edit (`_+918065080[0-2]X` missing the `7`). The unit doesn't run
  // pattern matching, so the bug is on the runtime side — but it asserts
  // the dispatcher has the DID, which is the prerequisite.
  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: [did('+918065080708', ORG_V7)],
    env: 'prod',
  });

  assert.match(conf, /exten => 918065080708,1,Goto\(org_demo__incoming,918065080708,1\)/);
  assert.match(conf, /exten => 08065080708,1,Goto\(org_demo__incoming,08065080708,1\)/);
});

// ─── Multi-org, multi-DID sanity ───────────────────────────────────────

test('multiple orgs with multiple DIDs each are grouped under org headers', () => {
  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: [
      did('+918065978007', ORG_V7),
      did('+918065080708', ORG_V7),
      did('+918065978006', ORG_OM),
    ],
    env: 'prod',
  });

  assert.match(conf, /; === Demo Hotel \(org_demo__\) ===/);
  assert.match(conf, /; === Om Chamber \(org_mo8vbv60__\) ===/);
});

// ─── Routing environment behaviour ─────────────────────────────────────

test('staging-flagged DID on prod environment is forwarded to staging cloud', () => {
  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: [did('+918065978001', ORG_V7, 'staging')],
    env: 'prod',
  });

  assert.match(conf, /Dial\(PJSIP\/918065978001@cloud-endpoint-stage,120\)/);
  // And the no-plus alias gets the same treatment
  assert.match(conf, /Dial\(PJSIP\/08065978001@cloud-endpoint-stage,120\)/);
});

test('prod-flagged DID on staging environment falls back to local routing', () => {
  // Defensive fallback path — shouldn't normally trigger, but if a prod-only
  // DID ends up on staging the dispatcher routes locally and logs.
  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: [did('+918065978002', ORG_V7, 'prod')],
    env: 'staging',
  });

  assert.match(conf, /routing_environment=prod but we are staging; routing locally/);
  assert.match(conf, /Goto\(org_demo__incoming,918065978002,1\)/);
});

// ─── Unassigned catch-all ──────────────────────────────────────────────

test('tata-did-route always ends with an _X. unassigned catch-all', () => {
  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: [did('+918065978007', ORG_V7)],
    env: 'prod',
  });

  assert.match(conf, /; Catch-all for unassigned DIDs/);
  assert.match(conf, /exten => _X\.,1,NoOp\(Unassigned DID: \$\{EXTEN\}\)/);
  assert.match(conf, /Playback\(number-not-in-service\)/);
});

// ─── Header + idempotency basics ───────────────────────────────────────

test('generated header marks the file as auto-generated', () => {
  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: [],
    env: 'prod',
    generatedAt: new Date('2026-05-16T00:00:00Z'),
  });

  assert.match(conf, /; Auto-generated Tata Gateway Inbound Routing/);
  assert.match(conf, /; Generated at: 2026-05-16T00:00:00\.000Z/);
  assert.match(conf, /; DO NOT EDIT — regenerated on every config deploy/);
});

test('empty DID list still produces a valid tata-inbound + tata-did-route', () => {
  const conf = ConfigDeploymentService.buildGatewayRoutingConfig({
    assignedDids: [],
    env: 'prod',
  });

  // Both contexts exist even with no DIDs (so a fresh install can boot)
  assert.match(conf, /\[tata-inbound\]/);
  assert.match(conf, /\[tata-did-route\]/);
  assert.match(conf, /exten => _\+X\./);
  assert.match(conf, /exten => _X\./);
});
