'use strict';

/**
 * Endpoint SQL invariant tests.
 *
 * We don't run the SQL — we assert text-level invariants on the SQL
 * being built inside each endpoint. This catches things like:
 *  - The /api/v1/calls (primary) endpoint having an org filter
 *  - Cross-org data leak in /journey, /recording
 *  - Wrong tiebreaker (longest-duration vs ANSWERED-preference)
 *  - qm<hex> not resolved
 *
 * Tests pin findings from the 2026-05-16 audit so future refactors
 * don't silently regress the same bugs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SERVER_JS = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

// Extract a single endpoint handler's full body by route definition.
// Returns the text between the matching app.get/post/put/delete call and
// the next blank-line top-level boundary (heuristic but works for our codebase).
function findEndpoint(verb, route) {
  // Find the start
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRe = new RegExp(`app\\.${verb}\\(['"\`]${escapedRoute}['"\`],`);
  const m = startRe.exec(SERVER_JS);
  if (!m) throw new Error(`Endpoint not found: app.${verb}('${route}')`);
  // Find the next "app." at the start of a line (next endpoint definition)
  const after = SERVER_JS.slice(m.index);
  const nextRe = /\napp\.(get|post|put|delete|patch|use)\(/;
  const nx = nextRe.exec(after.slice(50));
  return after.slice(0, nx ? nx.index + 50 : after.length);
}

// ─── /api/v1/calls (primary, editor-facing) ─────────────────────────────

test('S1: /api/v1/calls SQL filters by accountcode/peeraccount/channel-prefix', () => {
  const body = findEndpoint('get', '/api/v1/calls');
  assert.match(body, /accountcode\s*=\s*\?\s*OR\s*t?\.?peeraccount\s*=\s*\?/i,
    'primary calls endpoint must filter by org');
});

test('S2: /api/v1/calls uses ANSWERED-preferring tiebreaker (not just longest duration)', () => {
  const body = findEndpoint('get', '/api/v1/calls');
  // Must contain CASE WHEN ... ANSWERED ... ELSE 1 END in the ORDER BY of ROW_NUMBER
  assert.match(
    body,
    /ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION\s+BY\s+linkedid\s+ORDER\s+BY[\s\S]+?CASE\s+WHEN[\s\S]+?disposition\s*=\s*['"]ANSWERED['"][\s\S]+?billsec\s*>\s*0[\s\S]+?THEN\s+0\s+ELSE\s+1\s+END/i,
    'primary calls partition order MUST prefer ANSWERED+billsec>0 to avoid showing Missed on retry-and-answered calls'
  );
});

test('S3: /api/v1/calls to_number resolves qm<hex> via JOIN to queue_members', () => {
  const body = findEndpoint('get', '/api/v1/calls');
  assert.match(body, /LEFT\s+JOIN\s+queue_members/i,
    'primary calls endpoint must JOIN queue_members to resolve qm<hex>');
  assert.match(body, /qm_token/,
    'primary calls endpoint must compute qm_token for resolution');
});

test('S4: /api/v1/calls to_number does NOT emit raw qm<hex> in brackets for the operator UI', () => {
  const body = findEndpoint('get', '/api/v1/calls');
  // The OLD broken form: `' [', SUBSTRING_INDEX(SUBSTRING_INDEX(t.dstchannel, '/', -1), '@', 1), ']'`
  // would put the raw `qm<hex>` token into the brackets.
  // After the fix we resolve via the JOIN to u.extension, NOT to_number
  // is allowed to fall back to "queue member" / numeric extension only.
  const matches = body.match(/' \[', SUBSTRING_INDEX\(SUBSTRING_INDEX\(t\.dstchannel/);
  assert.equal(matches, null,
    'primary calls endpoint must NOT pull the raw qm<hex> token straight from dstchannel into brackets');
});

// ─── /api/v1/calls/:linkedId/journey ────────────────────────────────────

test('S5: /api/v1/calls/:linkedId/journey filters CDR rows by org (accountcode)', () => {
  const body = findEndpoint('get', '/api/v1/calls/:linkedId/journey');
  // The primary SELECT of CDR rows must have accountcode = req.orgId
  // (P0: cross-org data leak otherwise — operator can query any linkedid).
  assert.match(
    body,
    /FROM\s+asterisk_cdr[\s\S]+?WHERE[\s\S]+?(accountcode\s*=\s*\?|accountcode\s*=\s*'?\${?req\.orgId)/i,
    'journey endpoint must scope the CDR SELECT to req.orgId — otherwise any org can read any call'
  );
});

// ─── /api/v1/calls/:callId/recording ────────────────────────────────────

test('S6: /api/v1/calls/:callId/recording fallback CDR lookup filters by org', () => {
  const body = findEndpoint('get', '/api/v1/calls/:callId/recording');
  // Find every standalone SELECT from asterisk_cdr (not the secondary
  // "fetch all legs" one) and verify it's org-scoped.
  // The fallback path at /api/v1/calls/:callId/recording line ~25 of
  // the handler does `SELECT id, linkedid, accountcode, recordingfile
  // FROM asterisk_cdr WHERE id = ?` with NO accountcode check (P0 leak).
  const anchorFetch = body.match(/SELECT\s+[^;]+FROM\s+asterisk_cdr\s+WHERE\s+id\s*=\s*\?[^"`]*/i);
  assert.ok(anchorFetch, 'expected the anchor fetch SELECT FROM asterisk_cdr WHERE id=?');
  assert.match(anchorFetch[0], /accountcode\s*=\s*\?/i,
    'recording fallback anchor lookup must scope by accountcode');
});

// ─── /api/v1/calls/live ─────────────────────────────────────────────────

test('S7: /api/v1/calls/live resolves qm<hex> in caller_id field', () => {
  const body = findEndpoint('get', '/api/v1/calls/live');
  // Expect post-dedup resolution via queue_members JOIN
  assert.match(body, /qm[\s\S]+?queue_members/i,
    'live calls endpoint must batch-resolve qm<hex> tokens');
});

test('S8: /api/v1/calls/live disconnects AMI on error path with the live connection', () => {
  const body = findEndpoint('get', '/api/v1/calls/live');
  // Look for AsteriskManager usage. There should NOT be a NEW
  // AsteriskManager() instantiation inside the catch block — that
  // creates a fresh connection and disconnects THAT, leaking the
  // original.
  const catchBlock = body.match(/}\s*catch\s*\([^)]+\)\s*{[\s\S]+?}\s*}\s*\)/);
  if (catchBlock) {
    assert.doesNotMatch(catchBlock[0], /new\s+AsteriskManager\s*\(/,
      'catch block must reuse the outer AsteriskManager instance, not create a new one');
  }
});

// ─── ticket-related SQL ─────────────────────────────────────────────────

test('S9: pollCdr dedup prefers ANSWERED+billsec>0 (not longest duration)', () => {
  // pollCdr is inside server.js — find the function
  const pollCdr = SERVER_JS.match(/async function pollCdr\([\s\S]+?(?=async function|setInterval\(pollCdr)/);
  assert.ok(pollCdr, 'pollCdr function should exist');
  assert.match(
    pollCdr[0],
    /score[\s\S]+?ANSWERED[\s\S]+?billsec\s*>\s*0|disposition[\s\S]+?ANSWERED[\s\S]+?billsec\s*>\s*0[\s\S]+?byLinked/i,
    'pollCdr dedup must score by ANSWERED+billsec>0 first'
  );
});

test('S10: pollCdr only processes CDR rows whose call has SETTLED (grace window)', () => {
  const pollCdr = SERVER_JS.match(/async function pollCdr\([\s\S]+?(?=async function|setInterval\(pollCdr)/);
  assert.ok(pollCdr);
  // Should have a `calldate + duration < NOW() - 30s` style guard
  assert.match(
    pollCdr[0],
    /DATE_ADD\s*\(\s*calldate\s*,\s*INTERVAL\s+duration\s+SECOND\s*\)\s*<\s*\(\s*NOW\(\)\s*-\s*INTERVAL\s+\d+\s+SECOND\s*\)/i,
    'pollCdr should defer classification until the call has been settled (calldate+duration < now-30s)'
  );
});

// ─── general hygiene ────────────────────────────────────────────────────

test('S11: no GotoIf in dialplanGenerator.js uses the unwrapped truthy form', () => {
  const dg = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'asterisk', 'dialplanGenerator.js'), 'utf8');
  // Scan only lines that actually emit dialplan (template literals with
  // `extension +=` or `dialplan +=`). Skip comment lines.
  const violations = [];
  const lines = dg.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue; // skip comments
    // Look for the bug pattern in template literal output:
    // `GotoIf(${VAR}=VALUE?...` with NO `$[` wrapper.
    if (/GotoIf\(\\?\$\{[^}]+\}=[^?[$]+\?/.test(line)) {
      violations.push(`line ${i + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(violations, [], `dialplanGenerator has unwrapped GotoIf truthy-bug instances:\n${violations.join('\n')}`);
});

test('S12: ticketClassifier recognises Local/qm<hex> as a valid queue bridge', () => {
  const tc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ticketClassifier.js'), 'utf8');
  assert.match(tc, /realQueueBridge[\s\S]+?Local\\?\/qm[\s\S]+?billsec\s*>\s*0/i,
    'classifier must treat Local/qm<hex> + billsec>0 as a real bridge');
});

test('S13: ticketClassifier has a cross-batch auto-close safety net for answered queue calls', () => {
  const tc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'ticketClassifier.js'), 'utf8');
  assert.match(tc, /UPDATE\s+tickets[\s\S]+?status\s*=\s*['"]closed['"]/i,
    'classifier should auto-close prior tickets when a later ANSWERED queue row arrives');
});
