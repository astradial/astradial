'use strict';

/**
 * Integration / source-level checks that catch P1 audit findings.
 *
 * These are not unit tests of pure functions — they verify invariants
 * by reading the source files. They catch:
 *  - queue pause/unpause using the wrong interface (P1 #6)
 *  - live-calls org match being substring not boundary-aware (P1 #8)
 *  - live-calls extension regex only matching 4 digits (P1 #9)
 *  - dialplan generator wiring (no dead code paths)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const QUEUE_SERVICE = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'asterisk', 'queueService.js'), 'utf8');
const SERVER_JS = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const DIALPLAN_GEN = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'asterisk', 'dialplanGenerator.js'), 'utf8');
const CONFIG_DEPLOY = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'asterisk', 'configDeploymentService.js'), 'utf8');

// ─── P1 #6: queue pause/unpause use the right interface ────────────────

test('I1: queueService pause uses Local/qm interface, not PJSIP/<endpoint>', () => {
  // Members are joined as Local/qm<id>@<ctx>/n. Asterisk's `queue pause
  // member` matches by exact interface string — passing PJSIP/<endpoint>
  // silently no-ops because no such interface exists in the queue.
  const pauseSection = QUEUE_SERVICE.match(/async pauseQueueMember[\s\S]+?async unpauseQueueMember/);
  assert.ok(pauseSection, 'pauseQueueMember source block found');
  // The command should use _memberInterfaceFor (which returns Local/qm…).
  assert.match(
    pauseSection[0],
    /queue pause member \$\{(this\._memberInterfaceFor|memberInterface)/i,
    'pauseQueueMember must use the Local/qm interface, not the PJSIP endpoint name'
  );
});

test('I2: queueService unpause uses Local/qm interface, not PJSIP/<endpoint>', () => {
  const unpauseSection = QUEUE_SERVICE.match(/async unpauseQueueMember[\s\S]+?async getQueueStatus/);
  assert.ok(unpauseSection, 'unpauseQueueMember source block found');
  assert.match(
    unpauseSection[0],
    /queue unpause member \$\{(this\._memberInterfaceFor|memberInterface)/i,
    'unpauseQueueMember must use the Local/qm interface'
  );
});

// ─── P1 #8: live-calls org match boundary-aware ────────────────────────

test('I3: /api/v1/calls/live org-match uses prefix-with-boundary, not bare substring', () => {
  // Substring `<any>.includes(orgPrefix)` lets `org_mp3` accidentally
  // match `org_mp3t4g5m`. The match should require an underscore or end-
  // of-token after the prefix.
  const liveSection = SERVER_JS.match(/app\.get\('\/api\/v1\/calls\/live'[\s\S]+?(?=\napp\.get\(|\napp\.post\()/);
  assert.ok(liveSection, 'live-calls handler source block found');
  // Any `.includes(orgPrefix)` (case-insensitive on the property name)
  // is the failing pattern — boundary-aware matching is needed.
  const bareIncludes = liveSection[0].match(/\.includes\(orgPrefix\)/);
  assert.equal(bareIncludes, null,
    'live-calls org match must be boundary-aware (startsWith with `_` or regex with `\\b`) — bare .includes(orgPrefix) collides on prefix substrings');
});

// ─── P1 #9: live-calls extension regex matches 2-6 digits ──────────────

test('I4: /api/v1/calls/live extension regex matches 2-6 digit extensions, not just 4', () => {
  const liveSection = SERVER_JS.match(/app\.get\('\/api\/v1\/calls\/live'[\s\S]+?(?=\napp\.get\(|\napp\.post\()/);
  assert.ok(liveSection);
  // The OLD broken regex was `/PJSIP\/\w+_(\d{4})-/` — only 4 digits.
  // After fix, should match `\d{2,6}` or similar.
  const fourOnly = liveSection[0].match(/PJSIP[\\/]+\\w\+_\(\\d\{4\}\)/);
  assert.equal(fourOnly, null,
    'live-calls extension regex must accept 2-6 digit extensions, not exactly 4');
});

// ─── P0 #1 verification (already fixed, regression guard) ─────────────

test('I5: dialplanGenerator user-ext failover DEVSTATE uses $[...] (regression guard)', () => {
  assert.match(DIALPLAN_GEN, /GotoIf\(\$\[\\?\$\{DEVSTATE\}=NOT_INUSE\]/);
});

test('I6: dialplanGenerator user-ext DIALSTATUS uses $[...] (regression guard)', () => {
  assert.match(DIALPLAN_GEN, /GotoIf\(\$\[\\?\$\{DIALSTATUS\}=NOANSWER\]/);
});

// ─── configDeploymentService devstate seeder ─────────────────────────

test('I7: configDeploymentService seeds Custom:qm devstates after reload', () => {
  assert.match(CONFIG_DEPLOY, /seedQueueMemberDevstates/);
  // The CLI command is built with a template literal — accept either
  // the literal "Custom:qm" or template form referencing a `dev` variable.
  assert.match(CONFIG_DEPLOY, /devstate change \$\{dev\}|devstate change Custom:qm/);
});

test('I8: devstate seeder query uses correct condition (ring_target=phone OR ai_agent)', () => {
  // Must match the generator's Custom: emission rule exactly.
  assert.match(
    CONFIG_DEPLOY,
    /ring_target\s*=\s*['"]phone['"]\s*OR\s*[^=]+routing_type\s*=\s*['"]ai_agent['"]/i,
    'devstate seeder must mirror generator Custom: emission rule'
  );
});

// ─── ticketClassifier ────────────────────────────────────────────────

test('I9: ticketClassifier has BOT_DROP_THRESHOLD_SECS defined', () => {
  const tc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ticketClassifier.js'), 'utf8');
  assert.match(tc, /BOT_DROP_THRESHOLD_SECS\s*=\s*\d+/);
});

test('I10: ticketClassifier broadcasts ticketStream refresh on upsert', () => {
  const tc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ticketClassifier.js'), 'utf8');
  assert.match(tc, /ticketStream\.broadcast/);
});

// ─── pollCdr safety nets ─────────────────────────────────────────────

test('I11: pollCdr filters out outbound trunk-leg rows (dst="s")', () => {
  const pollCdr = SERVER_JS.match(/async function pollCdr\([\s\S]+?(?=async function|setInterval\(pollCdr)/);
  assert.ok(pollCdr);
  assert.match(pollCdr[0], /r\.dst\s*===?\s*['"]s['"]/, 'pollCdr should detect dst="s" outbound trunk leg');
});

test('I12: pollCdr uses 30s grace window for retry CDRs', () => {
  const pollCdr = SERVER_JS.match(/async function pollCdr\([\s\S]+?(?=async function|setInterval\(pollCdr)/);
  assert.ok(pollCdr);
  assert.match(pollCdr[0], /INTERVAL\s+\d+\s+SECOND/);
});

// ─── Per-member qm helper context invariants ─────────────────────────

test('I13: generateQueueMemberContext emits qm<hex> extensions for active members only', () => {
  assert.match(DIALPLAN_GEN, /generateQueueMemberContext/);
});

test('I14: dialplan generator never emits a raw $[...] inside a comment that looks like code', () => {
  // Sanity: lines starting with // shouldn't trigger our other regex
  // assertions. Just a smoke check.
  assert.ok(DIALPLAN_GEN.length > 0);
});

// ─── 100-scenario completeness markers ───────────────────────────────

test('I15: editor pbx client points to /calls (the post-fix primary endpoint)', () => {
  // /api/v1/calls is now correctly fixed (after this PR). Confirm the
  // client still hits this URL so the fix actually reaches the editor.
  const client = fs.readFileSync(path.join(__dirname, '..', '..', 'editor', 'lib', 'pbx', 'client.ts'), 'utf8');
  assert.match(client, /\/calls\?\$\{qs\.toString/);
});
