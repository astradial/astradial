'use strict';

/**
 * Unit tests for the call-logs ticket SQL query builder + helpers.
 * Pure functions — no DB, no models, no I/O.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMissedCallsQuery,
  decideSourceAndKind,
  parseEnabledOrgs,
  isOrgEnabled,
  ENABLED_WILDCARD,
} = require('../src/services/callLogsTicketQuery');

// ─── buildMissedCallsQuery ───

test('CL1: empty orgIds → never-matching query, no replacements', () => {
  const q = buildMissedCallsQuery({ orgIds: [] });
  assert.equal(q.sql.includes('WHERE 1=0'), true);
  assert.deepEqual(q.replacements, []);
});

test('CL2: single org → placeholders + scan/window/settle params bound in order', () => {
  const q = buildMissedCallsQuery({ orgIds: ['org-a'], windowSecs: 300, settleSecs: 60 });
  assert.match(q.sql, /c\.accountcode IN \(\?\)/);
  // [orgIds..., prefilterSecs, windowSecs, settleSecs]
  // prefilterSecs = windowSecs + 3600 = 3900
  assert.deepEqual(q.replacements, ['org-a', 3900, 300, 60]);
});

test('CL3: multiple orgs → matching placeholder count', () => {
  const q = buildMissedCallsQuery({ orgIds: ['a', 'b', 'c'] });
  const placeholderMatch = q.sql.match(/c\.accountcode IN \(([^)]+)\)/);
  assert.ok(placeholderMatch, 'IN clause present');
  assert.equal(placeholderMatch[1].replace(/\s/g, ''), '?,?,?');
  assert.deepEqual(q.replacements.slice(0, 3), ['a', 'b', 'c']);
});

test('CL4: query filters out Local/* parent channels (member-leg rows)', () => {
  const q = buildMissedCallsQuery({ orgIds: ['a'] });
  assert.match(q.sql, /channel NOT LIKE 'Local\/%'/);
});

test('CL5: query restricts to _incoming dcontexts (excludes outbound + internal)', () => {
  const q = buildMissedCallsQuery({ orgIds: ['a'] });
  assert.match(q.sql, /dcontext LIKE '%\\_incoming'/);
});

test('CL6: dedup partitions by linkedid preferring ANSWERED+billsec>0', () => {
  const q = buildMissedCallsQuery({ orgIds: ['a'] });
  assert.match(q.sql, /PARTITION BY c\.linkedid/);
  assert.match(q.sql, /WHEN c\.disposition = 'ANSWERED' AND c\.billsec > 0 THEN 1 ELSE 0/);
});

test('CL7: outer filter excludes real PJSIP bridge AND qm bridge with talk time', () => {
  const q = buildMissedCallsQuery({ orgIds: ['a'] });
  // Both regexes must be present in the NOT-bridged exclusion clause.
  assert.match(q.sql, /dstchannel REGEXP '\^PJSIP\/\[a-zA-Z0-9_-\]\+-'/);
  assert.match(q.sql, /dstchannel REGEXP '\^Local\/qm\[a-f0-9\]\{32\}@'/);
});

test('CL8: ORDER BY session_end_time ASC (oldest session first → events recorded in time order)', () => {
  const q = buildMissedCallsQuery({ orgIds: ['a'] });
  assert.match(q.sql, /ORDER BY session_end_time ASC/);
});

test('CL8b: window filter is gated by session_end_time, not per-row end_time', () => {
  // Regression for 2026-05-16 prod incident, linkedid 1778930693.2604:
  // a NO_ANSWER row (T=0) and a sibling ANSWERED row (T+35s) for the
  // same linkedid landed in different settle windows under the old
  // per-row gate, so a ticket was created from the NO_ANSWER row
  // before the ANSWERED row arrived. Session-level settle keeps a
  // linkedid waiting until MAX(end_time) of its rows is in the window.
  const q = buildMissedCallsQuery({ orgIds: ['a'] });
  // Outer WHERE must compare session_end_time, not end_time, to the
  // window bounds.
  assert.match(q.sql, /session_end_time\s*\n?\s*BETWEEN/);
  // Inner SELECT must compute session_end_time as MAX(end_time) over
  // the linkedid partition.
  assert.match(q.sql, /MAX\(DATE_ADD\(c\.calldate, INTERVAL c\.duration SECOND\)\)\s*\n?\s*OVER\s*\(PARTITION BY c\.linkedid\)\s*AS session_end_time/);
});

// ─── decideSourceAndKind ───

test('CL9: lastapp=Queue → source=queue_timeout, kind=missed', () => {
  assert.deepEqual(
    decideSourceAndKind({ lastapp: 'Queue' }),
    { source: 'queue_timeout', kind: 'missed' }
  );
});

test('CL10: lastapp=WaitExten / Background / Playback → queue_timeout (IVR-abandoned)', () => {
  for (const la of ['WaitExten', 'BackGround', 'Playback']) {
    assert.equal(decideSourceAndKind({ lastapp: la }).source, 'queue_timeout');
  }
});

test('CL11: lastapp=Dial (direct extension dial) → source=missed_call', () => {
  assert.equal(decideSourceAndKind({ lastapp: 'Dial' }).source, 'missed_call');
});

test('CL12: lastapp empty or unknown → falls back to missed_call', () => {
  assert.equal(decideSourceAndKind({}).source, 'missed_call');
  assert.equal(decideSourceAndKind({ lastapp: '' }).source, 'missed_call');
  assert.equal(decideSourceAndKind({ lastapp: 'Stasis' }).source, 'missed_call');
});

// ─── parseEnabledOrgs ───

test('CL13: empty / undefined env → empty Set', () => {
  assert.equal(parseEnabledOrgs(undefined).size, 0);
  assert.equal(parseEnabledOrgs('').size, 0);
  assert.equal(parseEnabledOrgs('  ').size, 0);
});

test('CL14: single org id → Set of size 1', () => {
  const s = parseEnabledOrgs('875c0285-6355-4336-b21e-9aac67070b52');
  assert.equal(s.size, 1);
  assert.equal(s.has('875c0285-6355-4336-b21e-9aac67070b52'), true);
});

test('CL15: comma-separated with whitespace → trimmed entries', () => {
  const s = parseEnabledOrgs(' a , b , , c ');
  assert.deepEqual([...s].sort(), ['a', 'b', 'c']);
});

// ─── Wildcard ───

test('CL16: orgIds containing wildcard → no accountcode IN clause', () => {
  const q = buildMissedCallsQuery({ orgIds: ['*'], windowSecs: 300, settleSecs: 60 });
  assert.doesNotMatch(q.sql, /c\.accountcode IN \(/);
  assert.match(q.sql, /c\.accountcode IS NOT NULL/);
  // No accountcode binds in wildcard mode — only [prefilter, window, settle]
  assert.deepEqual(q.replacements, [3900, 300, 60]);
});

test('CL17: wildcard mixed with explicit orgs → still wildcard (explicit ids ignored)', () => {
  const q = buildMissedCallsQuery({ orgIds: ['*', 'org-a', 'org-b'], windowSecs: 300, settleSecs: 60 });
  assert.doesNotMatch(q.sql, /c\.accountcode IN \(/);
  assert.deepEqual(q.replacements, [3900, 300, 60]);
});

test('CL18: parseEnabledOrgs preserves the literal "*" token', () => {
  const s = parseEnabledOrgs('*');
  assert.equal(s.has('*'), true);
  assert.equal(s.size, 1);
});

test('CL19: isOrgEnabled returns true for any org when wildcard is set', () => {
  const s = parseEnabledOrgs('*');
  assert.equal(isOrgEnabled('any-uuid', s), true);
  assert.equal(isOrgEnabled('another-uuid', s), true);
});

test('CL20: isOrgEnabled returns true only for listed orgs when no wildcard', () => {
  const s = parseEnabledOrgs('org-a,org-b');
  assert.equal(isOrgEnabled('org-a', s), true);
  assert.equal(isOrgEnabled('org-b', s), true);
  assert.equal(isOrgEnabled('org-c', s), false);
});

test('CL21: isOrgEnabled returns false for empty set', () => {
  assert.equal(isOrgEnabled('org-a', new Set()), false);
  assert.equal(isOrgEnabled('org-a', null), false);
});

test('CL22: ENABLED_WILDCARD exported constant equals "*"', () => {
  assert.equal(ENABLED_WILDCARD, '*');
});
