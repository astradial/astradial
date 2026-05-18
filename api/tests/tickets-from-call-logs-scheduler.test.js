'use strict';

/**
 * Behavioural tests for the call-logs-driven ticket scheduler.
 *
 * Stubs out models + ticketStream so we can drive `runOnce()`
 * deterministically and assert on the side-effects: which upserts
 * fired, which events were recorded, and that the SSE broadcast
 * happens once-per-org-per-tick (not per row).
 */

const stubs = require('./fixtures/stub-models');

// Capture mode for ticket upserts + event records.
const captured = { upserts: [], events: [], broadcasts: [] };
stubs.Ticket.upsertFromCdr = async (args) => {
  captured.upserts.push(args);
  // Deterministic ticket id keyed by caller so events tie back correctly.
  return { ticket: { id: 'tkt-' + (args.callerRaw || '').replace(/\D/g, '').slice(-10) }, created: true };
};
stubs.TicketCallEvent.recordSafe = async (args) => {
  captured.events.push(args);
  return { event: { id: 'evt-' + captured.events.length, ...args }, created: true };
};

// Stub the ticketStream module so broadcast() captures rather than
// dispatching. Module path must match what the scheduler requires.
const path = require('path');
const streamPath = path.resolve(__dirname, '../src/services/ticketStream.js');
require.cache[streamPath] = {
  id: streamPath,
  filename: streamPath,
  loaded: true,
  exports: {
    broadcast: (orgId, payload) => { captured.broadcasts.push({ orgId, payload }); },
    subscribe: () => () => {},
  },
};

// Stub the sequelize.query call the scheduler issues. We pretend the
// SQL builder produced rows so the scheduler's row loop runs against
// our fixtures.
let _fakeRows = [];
stubs.sequelize.query = async () => _fakeRows;

const test = require('node:test');
const assert = require('node:assert/strict');

const scheduler = require('../src/jobs/ticketsFromCallLogsScheduler');

function reset(rows) {
  captured.upserts.length = 0;
  captured.events.length = 0;
  captured.broadcasts.length = 0;
  _fakeRows = rows || [];
}

function row(overrides) {
  return Object.assign({
    linkedid: 'lid-' + Math.random().toString(36).slice(2, 8),
    uniqueid: 'uid-1',
    org_id: 'org-a',
    src: '919791948451',
    dst: '918065978012',
    dstchannel: '',
    lastapp: 'Queue',
    duration: 30,
    billsec: 30,
    disposition: 'NO ANSWER',
    calldate: new Date('2026-05-16T13:00:00Z'),
    end_time: new Date('2026-05-16T13:00:30Z'),
  }, overrides);
}

// ─── No-op cases ───

test('S1: no enabled orgs → runOnce returns skipped', async () => {
  reset();
  delete process.env.TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS;
  const out = await scheduler.runOnce();
  assert.equal(out.skipped, 'no_enabled_orgs');
  assert.equal(captured.upserts.length, 0);
});

test('S2: enabled orgs, empty query result → no side-effects', async () => {
  reset([]);
  process.env.TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS = 'org-a';
  const out = await scheduler.runOnce();
  assert.equal(out.rowsScanned, 0);
  assert.equal(captured.upserts.length, 0);
  assert.equal(captured.events.length, 0);
  assert.equal(captured.broadcasts.length, 0);
});

// ─── Happy paths ───

test('S3: one missed Queue row → one upsert + one event + one broadcast', async () => {
  reset([row({ lastapp: 'Queue', disposition: 'NO ANSWER' })]);
  process.env.TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS = 'org-a';
  const out = await scheduler.runOnce();
  assert.equal(out.rowsScanned, 1);
  assert.equal(out.ticketsTouched, 1);
  assert.equal(out.eventsRecorded, 1);
  assert.equal(captured.upserts.length, 1);
  assert.equal(captured.upserts[0].source, 'queue_timeout');
  assert.equal(captured.events.length, 1);
  assert.equal(captured.events[0].kind, 'missed');
  assert.equal(captured.broadcasts.length, 1, 'one broadcast per org per tick');
});

test('S4: lastapp=Dial direct miss → source=missed_call', async () => {
  reset([row({ lastapp: 'Dial', disposition: 'NO ANSWER' })]);
  process.env.TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS = 'org-a';
  await scheduler.runOnce();
  assert.equal(captured.upserts[0].source, 'missed_call');
});

test('S5: three rows across two orgs → 2 broadcasts (one per org), not 3', async () => {
  reset([
    row({ org_id: 'org-a', linkedid: 'l1' }),
    row({ org_id: 'org-a', linkedid: 'l2', src: '919994144647' }),
    row({ org_id: 'org-b', linkedid: 'l3', src: '917092865834' }),
  ]);
  process.env.TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS = 'org-a,org-b';
  await scheduler.runOnce();
  assert.equal(captured.upserts.length, 3);
  assert.equal(captured.events.length, 3);
  const orgsBroadcastedFor = new Set(captured.broadcasts.map(b => b.orgId));
  assert.deepEqual([...orgsBroadcastedFor].sort(), ['org-a', 'org-b']);
});

// ─── Idempotency / re-entry ───

test('S6: overlapping tick is skipped (re-entry guard)', async () => {
  reset([row()]);
  process.env.TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS = 'org-a';
  // Hold the first tick mid-flight by making the query return a Promise
  // that resolves on next microtask, then fire a second runOnce() while
  // the first is awaiting. The second should bail with overlapping_tick.
  let resolveFirst;
  stubs.sequelize.query = () => new Promise((resolve) => {
    resolveFirst = () => resolve([row()]);
  });
  const p1 = scheduler.runOnce();
  const p2Result = await scheduler.runOnce();
  assert.equal(p2Result.skipped, 'overlapping_tick');
  resolveFirst();
  await p1;
  // restore baseline
  stubs.sequelize.query = async () => _fakeRows;
});

// ─── Event metadata snapshot ───

test('S7: event meta carries duration/billsec/disposition/lastapp/dstchannel snapshot', async () => {
  reset([row({
    duration: 172, billsec: 172, disposition: 'NO ANSWER',
    lastapp: 'Queue', dstchannel: 'Local/qmabc@org_x_qmem;1',
  })]);
  process.env.TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS = 'org-a';
  await scheduler.runOnce();
  assert.equal(captured.events.length, 1);
  const m = captured.events[0].meta;
  assert.equal(m.duration, 172);
  assert.equal(m.billsec, 172);
  assert.equal(m.disposition, 'NO ANSWER');
  assert.equal(m.lastapp, 'Queue');
  assert.equal(m.dstchannel, 'Local/qmabc@org_x_qmem;1');
});

// ─── Stats accumulator ───

test('S8: getStats accumulates across ticks', async () => {
  reset([row()]);
  process.env.TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS = 'org-a';
  const before = scheduler.getStats();
  await scheduler.runOnce();
  await scheduler.runOnce();
  const after = scheduler.getStats();
  assert.equal(after.ticks >= before.ticks + 2, true);
  assert.equal(after.rowsScanned >= before.rowsScanned + 2, true);
});
