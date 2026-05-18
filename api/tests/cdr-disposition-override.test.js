'use strict';

/**
 * Unit tests for the CDR disposition override (services/cdrDispositionOverride.js).
 *
 * The override pre-flips disposition=ANSWERED → NO ANSWER for inbound
 * CDR rows where Asterisk's Answer() ran (IVR / queue music) but no
 * member ever bridged. Critical that it does NOT flip a row that DID
 * bridge through our `Local/qm<hex>@…` queue helper — pre-flipping
 * that case bypasses the classifier's auto-close logic and creates
 * bogus "Queue Timeout" tickets on calls the customer had a real
 * conversation on. Reproduced 2026-05-16 on prod org 00000001 (V7).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { effectiveDisposition } = require('../src/services/cdrDispositionOverride');

// ─── Bridged calls keep ANSWERED ───

test('D1: ANSWERED + Local/qm bridge + billsec > 0 + lastapp=Queue → stays ANSWERED', () => {
  // Regression for 2026-05-16 V7 incident. The original override
  // treated any Local/qm dstchannel as "not bridged" and flipped these
  // to NO ANSWER, defeating the classifier's queue_answered path.
  const r = {
    disposition: 'ANSWERED',
    dstchannel: 'Local/qma4172958ff104bf685cfab212de227d8@org_demo__qmem-000000d2;1',
    lastapp: 'Queue',
    billsec: 172,
  };
  assert.equal(effectiveDisposition(r), 'ANSWERED');
});

test('D2: ANSWERED + Local/qm bridge + billsec > 0 + lastapp=Queue (uppercase exact) → stays ANSWERED', () => {
  const r = {
    disposition: 'ANSWERED',
    dstchannel: 'Local/qmabcd1234ef5678901234567890abcdef@org_test_qmem-00000001;1',
    lastapp: 'QUEUE',
    billsec: 45,
  };
  assert.equal(effectiveDisposition(r), 'ANSWERED');
});

test('D3: ANSWERED + direct PJSIP/<ext> bridge + billsec > 0 → stays ANSWERED', () => {
  const r = {
    disposition: 'ANSWERED',
    dstchannel: 'PJSIP/org_test_1001-00000abc',
    lastapp: 'Dial',
    billsec: 30,
  };
  assert.equal(effectiveDisposition(r), 'ANSWERED');
});

// ─── Not-bridged ANSWERED gets flipped ───

test('D4: ANSWERED + lastapp=WaitExten + no dstchannel (IVR-only) → flipped to NO ANSWER', () => {
  // IVR greeting played, caller hung up before pressing a digit.
  const r = {
    disposition: 'ANSWERED',
    dstchannel: '',
    lastapp: 'WaitExten',
    billsec: 0,
  };
  assert.equal(effectiveDisposition(r), 'NO ANSWER');
});

test('D5: ANSWERED + lastapp=Background (IVR prompt) + no dstchannel → flipped to NO ANSWER', () => {
  const r = {
    disposition: 'ANSWERED',
    dstchannel: '',
    lastapp: 'BackGround',
    billsec: 0,
  };
  assert.equal(effectiveDisposition(r), 'NO ANSWER');
});

test('D6: ANSWERED + lastapp=Queue + no dstchannel + billsec=0 → flipped (queue music only)', () => {
  // Caller hung up while on hold, no member ever rang.
  const r = {
    disposition: 'ANSWERED',
    dstchannel: '',
    lastapp: 'Queue',
    billsec: 0,
  };
  assert.equal(effectiveDisposition(r), 'NO ANSWER');
});

test('D7: ANSWERED + Local/qm dstchannel + billsec=0 + lastapp=Queue → flipped (no real bridge)', () => {
  // qm helper was dialed but the inner Dial never bridged.
  const r = {
    disposition: 'ANSWERED',
    dstchannel: 'Local/qmabcd1234ef5678901234567890abcdef@org_test_qmem-00000001;1',
    lastapp: 'Queue',
    billsec: 0,
  };
  assert.equal(effectiveDisposition(r), 'NO ANSWER');
});

// ─── Non-ANSWERED dispositions pass through untouched ───

test('D8: NO ANSWER passes through unchanged', () => {
  const r = { disposition: 'NO ANSWER', dstchannel: '', lastapp: 'Queue', billsec: 0 };
  assert.equal(effectiveDisposition(r), 'NO ANSWER');
});

test('D9: BUSY passes through unchanged', () => {
  const r = { disposition: 'BUSY', dstchannel: 'PJSIP/foo-001', lastapp: 'Dial', billsec: 0 };
  assert.equal(effectiveDisposition(r), 'BUSY');
});

test('D10: FAILED passes through unchanged', () => {
  const r = { disposition: 'FAILED', dstchannel: '', lastapp: 'Dial', billsec: 0 };
  assert.equal(effectiveDisposition(r), 'FAILED');
});

// ─── Defensive: missing/odd fields ───

test('D11: empty row → empty string', () => {
  assert.equal(effectiveDisposition({}), '');
});

test('D12: ANSWERED + lastapp=Dial (not in greeting list) + no bridge → stays ANSWERED', () => {
  // Defensive: an ANSWERED row whose channel ended outside any
  // greeting/queue-music app shouldn't be flipped — we only flip the
  // specific IVR/queue-abandoned pattern.
  const r = { disposition: 'ANSWERED', dstchannel: '', lastapp: 'Dial', billsec: 0 };
  assert.equal(effectiveDisposition(r), 'ANSWERED');
});

test('D13: ANSWERED + Local/qm with wrong-length hex (not 32 chars) + billsec > 0 → flipped', () => {
  // Belt-and-suspenders: a malformed qm channel name shouldn't be
  // treated as a real bridge. Mirrors the classifier's strict regex.
  const r = {
    disposition: 'ANSWERED',
    dstchannel: 'Local/qmabcd1234@org_test_qmem-00000001;1',
    lastapp: 'Queue',
    billsec: 30,
  };
  assert.equal(effectiveDisposition(r), 'NO ANSWER');
});
