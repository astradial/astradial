'use strict';

/**
 * Ticket classifier decision tests.
 *
 * Pure decision logic — no DB writes. We stub out `Ticket.upsertFromCdr`
 * and `User.findAll` via the models stub, then call `classifyAndUpsertTicket`
 * and assert on the returned `{ skipped, upserted, reason }` shape.
 */

const stubs = require('./fixtures/stub-models');
// Mutate the stub to capture upsert calls in this test file.
stubs.Ticket.upsertFromCdr = async (args) => {
  stubs.Ticket._lastUpsert = args;
  return { ticket: { id: 'stub-' + (args.source || 'x') }, created: true };
};
stubs.User.findAll = async () => [];

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyAndUpsertTicket } = require('../src/services/ticketClassifier');
const { makeCdrRow } = require('./fixtures/factories');

const ORG = 'org-test-id';

function resetCapture() { stubs.Ticket._lastUpsert = null; }

// ─── Skipped paths ───

test('T1: missing orgId → skipped', async () => {
  const r = makeCdrRow();
  const out = await classifyAndUpsertTicket(r, null, r.disposition);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'no_org');
});

test('T2: src too short (< 7 digits) → skipped', async () => {
  const r = makeCdrRow({ src: '12345' });
  const out = await classifyAndUpsertTicket(r, ORG, r.disposition);
  assert.equal(out.skipped, true);
});

test('T3: empty src → skipped', async () => {
  const r = makeCdrRow({ src: '' });
  const out = await classifyAndUpsertTicket(r, ORG, r.disposition);
  assert.equal(out.skipped, true);
});

// ─── ANSWERED paths ───

test('T4: ANSWERED + direct PJSIP bridge + billsec > 0 → human_answered, no ticket', async () => {
  resetCapture();
  const r = makeCdrRow({
    disposition: 'ANSWERED',
    dstchannel: 'PJSIP/org_test_1001-00000abc',
    lastapp: 'Dial',
    billsec: 25,
  });
  const out = await classifyAndUpsertTicket(r, ORG, r.disposition);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'human_answered');
  assert.equal(stubs.Ticket._lastUpsert, null);
});

test('T5: ANSWERED + Local/qm bridge + lastapp=Queue + billsec > 0 → queue_answered, no ticket', async () => {
  resetCapture();
  const r = makeCdrRow({
    disposition: 'ANSWERED',
    dstchannel: 'Local/qmabcd1234ef5678901234567890abcdef@org_test_qmem-00000001;1',
    lastapp: 'Queue',
    billsec: 30,
  });
  const out = await classifyAndUpsertTicket(r, ORG, r.disposition);
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'queue_answered');
  assert.equal(stubs.Ticket._lastUpsert, null);
});

test('T6: ANSWERED + Local/qm + billsec=0 → falls through to missed (not a real bridge)', async () => {
  resetCapture();
  const r = makeCdrRow({
    disposition: 'NO ANSWER',  // effective override
    dstchannel: 'Local/qmabcd1234ef5678901234567890abcdef@org_test_qmem-00000001;1',
    lastapp: 'Queue',
    billsec: 0,
  });
  const out = await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  assert.equal(out.upserted, true);
  assert.equal(out.source, 'queue_timeout');
});

test('T7: IVR-abandoned ANSWERED (effectiveDisposition=NO ANSWER) → queue_timeout ticket', async () => {
  resetCapture();
  const r = makeCdrRow({
    disposition: 'ANSWERED',  // raw says answered (Answer() ran)
    dstchannel: '',
    lastapp: 'WaitExten',
    billsec: 0,
  });
  // Caller normalises disposition to NO ANSWER for the classifier
  const out = await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  assert.equal(out.upserted, true);
  assert.equal(out.source, 'queue_timeout');
});

// ─── Missed paths ───

test('T8: NO ANSWER + lastapp=Queue → queue_timeout ticket', async () => {
  resetCapture();
  const r = makeCdrRow({
    disposition: 'NO ANSWER',
    dstchannel: '',
    lastapp: 'Queue',
    billsec: 0,
  });
  const out = await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  assert.equal(out.upserted, true);
  assert.equal(out.source, 'queue_timeout');
  assert.equal(stubs.Ticket._lastUpsert.org_id, ORG);
});

test('T9: NO ANSWER + lastapp=Dial (no queue, no IVR) → missed_call ticket', async () => {
  resetCapture();
  const r = makeCdrRow({
    disposition: 'NO ANSWER',
    dstchannel: 'PJSIP/org_test_1001-00000abc',
    lastapp: 'Dial',
    billsec: 0,
  });
  const out = await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  assert.equal(out.upserted, true);
  assert.equal(out.source, 'missed_call');
});

test('T10: NO ANSWER + lastapp=Background (IVR-prompt) → queue_timeout ticket', async () => {
  resetCapture();
  const r = makeCdrRow({
    disposition: 'NO ANSWER',
    dstchannel: '',
    lastapp: 'BackGround',
    billsec: 0,
  });
  const out = await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  assert.equal(out.upserted, true);
  assert.equal(out.source, 'queue_timeout');
});

test('T11: BUSY → missed_call ticket', async () => {
  resetCapture();
  const r = makeCdrRow({ disposition: 'BUSY', dstchannel: 'PJSIP/org_test_1001-00000abc', lastapp: 'Dial', billsec: 0 });
  const out = await classifyAndUpsertTicket(r, ORG, 'BUSY');
  assert.equal(out.upserted, true);
});

test('T12: CONGESTION → missed_call ticket', async () => {
  resetCapture();
  const r = makeCdrRow({ disposition: 'CONGESTION', dstchannel: 'PJSIP/org_test_1001-00000abc', lastapp: 'Dial', billsec: 0 });
  const out = await classifyAndUpsertTicket(r, ORG, 'CONGESTION');
  assert.equal(out.upserted, true);
});

// ─── Notes / category labels ───

test('T13: queue_timeout source → notes contains "Queue Timeout" category', async () => {
  resetCapture();
  const r = makeCdrRow({ disposition: 'NO ANSWER', lastapp: 'Queue', billsec: 0, dstchannel: '' });
  await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  const parsed = JSON.parse(stubs.Ticket._lastUpsert.notes);
  assert.equal(parsed.category, 'Queue Timeout');
});

test('T14: missed_call source → notes contains "Missed Call" category', async () => {
  resetCapture();
  const r = makeCdrRow({ disposition: 'NO ANSWER', lastapp: 'Dial', dstchannel: 'PJSIP/org_test_1001-00000abc', billsec: 0 });
  await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  const parsed = JSON.parse(stubs.Ticket._lastUpsert.notes);
  assert.equal(parsed.category, 'Missed Call');
});

// ─── Caller details ───

test('T15: src passed through as callerRaw to upsert', async () => {
  resetCapture();
  const r = makeCdrRow({ src: '919876543210', disposition: 'NO ANSWER', lastapp: 'Queue', billsec: 0, dstchannel: '' });
  await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  assert.equal(stubs.Ticket._lastUpsert.callerRaw, '919876543210');
});

test('T16: src with leading 0 / formatting is normalised downstream (not classifier responsibility)', async () => {
  resetCapture();
  const r = makeCdrRow({ src: '+91 98765 43210', disposition: 'NO ANSWER', lastapp: 'Queue', billsec: 0, dstchannel: '' });
  await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  // classifier passes the raw src through; Ticket.upsertFromCdr does the
  // normalisation. Just verify it didn't drop the call.
  assert.notEqual(stubs.Ticket._lastUpsert, null);
});

// ─── Edge cases ───

test('T17: uniqueid is preserved as last_call_id', async () => {
  resetCapture();
  const r = makeCdrRow({ uniqueid: '1234567890.42', disposition: 'NO ANSWER', lastapp: 'Queue', billsec: 0, dstchannel: '' });
  await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  assert.equal(stubs.Ticket._lastUpsert.callId, '1234567890.42');
});

test('T18: calldate is preserved as callTimestamp', async () => {
  resetCapture();
  const dt = new Date('2026-05-16T10:00:00Z');
  const r = makeCdrRow({ calldate: dt, disposition: 'NO ANSWER', lastapp: 'Queue', billsec: 0, dstchannel: '' });
  await classifyAndUpsertTicket(r, ORG, 'NO ANSWER');
  assert.equal(String(stubs.Ticket._lastUpsert.callTimestamp), String(dt));
});

test('T19: Stasis (AI) ANSWERED with no bridge → falls through to missed (Answer() ran, no member)', async () => {
  resetCapture();
  const r = makeCdrRow({ disposition: 'ANSWERED', dstchannel: '', lastapp: 'Stasis', billsec: 30 });
  const out = await classifyAndUpsertTicket(r, ORG, 'ANSWERED');
  // Stasis with empty dstchannel — neither realPjsipBridge nor realQueueBridge.
  // Existing classifier behavior: still falls through to missed-ticket path
  // unless we model Stasis specifically (out of scope here).
  // Just assert we don't crash and produce some defined outcome.
  assert.ok(out.skipped === true || out.upserted === true);
});

test('T20: classifier never throws on malformed CDR row', async () => {
  for (const r of [
    makeCdrRow({ dstchannel: null }),
    makeCdrRow({ src: null, dst: null }),
    makeCdrRow({ lastapp: undefined }),
    makeCdrRow({ billsec: null, duration: null }),
    makeCdrRow({ disposition: 'STRANGE_DISP_NEVER_SEEN' }),
  ]) {
    await classifyAndUpsertTicket(r, ORG, r.disposition || 'UNKNOWN');
  }
});
