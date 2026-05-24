'use strict';

/**
 * Source-level invariant tests for PR 5: execution engine, concurrency cap,
 * dispatcher, and webhooks.
 *
 * No DB or Redis required — each test reads source files as text and asserts
 * the presence of the specific patterns that encode critical production
 * contracts. The pattern matches the approach used in campaign-import.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = (...parts) => path.join(__dirname, '..', 'src', ...parts);

const SCHEDULER = fs.readFileSync(SRC('jobs', 'campaignSchedulerJob.js'), 'utf8');
const DISPATCH  = fs.readFileSync(SRC('jobs', 'campaignDispatchWorker.js'), 'utf8');
const CONCUR    = fs.readFileSync(SRC('services', 'campaign-concurrency.js'), 'utf8');
const ROUTES    = fs.readFileSync(SRC('routes', 'campaigns.js'), 'utf8');

// ── S1: Scheduler claim race ──────────────────────────────────────────────────

test('S1: scheduler claim uses FOR UPDATE SKIP LOCKED (prevents double-dispatch)', () => {
  // Without SKIP LOCKED, two concurrent scheduler replicas would both read
  // the same pending rows, causing the same lead to be called twice.
  assert.match(SCHEDULER, /FOR UPDATE SKIP LOCKED/, 'SKIP LOCKED present in claim SQL');

  // The claim + status update to "waiting" must happen inside a single
  // transaction so rows cannot be re-claimed between the SELECT and the UPDATE.
  assert.match(SCHEDULER, /sequelize\.transaction\(\)/, 'claim wrapped in a transaction');
  assert.match(SCHEDULER, /status.*waiting.*locked_at.*locked_by/s, 'rows marked waiting inside tx');
  assert.match(SCHEDULER, /tx\.commit\(\)/, 'transaction is committed');
});

// ── S2: DNC enforcement in scheduler tick ────────────────────────────────────

test('S2: scheduler halts DNC leads with a halted event (reason: dnc)', () => {
  // A lead whose status is "dnc" must not receive any outbound action.
  // The scheduler sets run.status = "halted" and creates a "halted" event
  // so the campaign dashboard shows the correct terminal state.
  assert.match(SCHEDULER, /lead\.status === 'dnc'/, "scheduler checks lead.status === 'dnc'");
  assert.match(SCHEDULER, /status.*'halted'.*halted_at/s, 'run updated to halted with halted_at');
  assert.match(SCHEDULER, /kind.*'halted'.*payload.*reason.*'dnc'/s, 'halted event records dnc reason');
});

// ── S3: Idempotency — duplicate event key causes no-op re-enqueue ────────────

test('S3: ER_DUP_ENTRY on dispatch event reverts run to pending (no double-dispatch on restart)', () => {
  // The scheduler inserts a CampaignEvent with idempotency_key before
  // enqueueing to BullMQ. If the process crashes between the two steps
  // and retries, the duplicate key causes a caught error that reverts the
  // run to pending rather than re-throwing and failing the tick.
  assert.match(SCHEDULER, /SequelizeUniqueConstraintError/, 'UniqueConstraintError caught');
  assert.match(SCHEDULER, /ER_DUP_ENTRY/, 'MariaDB duplicate entry code caught');
  assert.match(
    SCHEDULER,
    /status.*'pending'.*locked_at.*null.*locked_by.*null/s,
    'run reverted to pending on duplicate key (no re-throw)'
  );
});

// ── S4: Idempotency key includes run attempts ─────────────────────────────────

test('S4: dispatch event idempotency key encodes run.id + day + action + attempts', () => {
  // The key must include attempts so each retry generates a new unique key
  // (allowing the same run to be dispatched again after a previous failure)
  // while still deduplicating within a single attempt.
  assert.match(
    SCHEDULER,
    /dispatch-\$\{run\.id\}-\$\{dayIdx\}-\$\{actionIdx\}-\$\{run\.attempts\}/,
    'idempotency key includes run.id, dayIdx, actionIdx, and run.attempts'
  );
});

// ── S5: Retry backoff schedule ────────────────────────────────────────────────

test('S5: transient failure retry — 1st attempt +5 min, 2nd attempt +30 min, 3rd → failed', () => {
  // The dispatcher uses exponential backoff for transient errors (network
  // blips, provider timeouts) up to 3 total attempts. On the 3rd failure
  // (attempts >= 3) the run is permanently failed so it does not loop forever.
  assert.match(DISPATCH, /attempts < 3/, 'retry guard: attempts < 3');
  assert.match(DISPATCH, /5 \* 60_000/, '1st retry delay is 5 minutes');
  assert.match(DISPATCH, /30 \* 60_000/, '2nd retry delay is 30 minutes');
  assert.match(DISPATCH, /status.*'failed'/s, "status set to 'failed' on final attempt");
});

// ── S6: Concurrency cap defers with DEFER_MS ─────────────────────────────────

test('S6: DEFER_MS is 30 000 ms — capped runs deferred 30 s, not immediately re-queued', () => {
  // When a call slot is not available the run is deferred by DEFER_MS so the
  // scheduler does not spin in a tight loop consuming DB connections.
  assert.match(SCHEDULER, /DEFER_MS\s*=\s*30_?000\b/, 'DEFER_MS = 30 000');
  assert.match(
    SCHEDULER,
    /Date\.now\(\) \+ DEFER_MS/,
    'deferred next_run_at uses DEFER_MS offset'
  );
});

// ── S7: releaseCallSlot called on both success and failure ───────────────────

test('S7: dispatcher calls releaseCallSlot on both success and failure paths (no slot leak)', () => {
  // If a call slot is not released on failure, the org's live-call counter
  // will drift upward until the 30-minute TTL expires, blocking further calls.
  const releaseMatches = (DISPATCH.match(/releaseCallSlot/g) || []).length;
  assert.ok(
    releaseMatches >= 2,
    `releaseCallSlot called ${releaseMatches} times (need ≥2 — once on success, once on failure)`
  );
});

// ── S8: Orphan-call TTL ───────────────────────────────────────────────────────

test('S8: SLOT_TTL_SECONDS is 1800 s and expire() is set on INCR (guards orphaned call counters)', () => {
  // If the call-completed webhook never fires (e.g. Asterisk crash), the Redis
  // counter would stay at max forever. The 30-minute TTL bounds the drift.
  assert.match(CONCUR, /SLOT_TTL_SECONDS\s*=\s*1800\b/, 'SLOT_TTL_SECONDS = 1800');
  assert.match(CONCUR, /expire\(ck,\s*SLOT_TTL_SECONDS\)/, 'expire() called after INCR');
});

// ── S9: Concurrency cap — DECR rollback when exceeded ────────────────────────

test('S9: tryAcquireCallSlot DECRements counter and returns false when cap exceeded', () => {
  // tryAcquireCallSlot does INCR first, then checks the cap. If it exceeded
  // the cap it must DECR to restore the counter before returning false —
  // otherwise each rejected call still inflates the live count.
  assert.match(CONCUR, /newCount > maxConcurrent/, 'cap check after INCR');
  assert.match(CONCUR, /client\.decr\(ck\)/, 'DECR called on rollback');
  assert.match(CONCUR, /return false/, 'returns false when cap exceeded');
});

// ── S10: PATCH cap decrease blocked when live calls exceed new cap ────────────

test('S10: PATCH /campaigns/:id returns 409 when new cap < current live_calls', () => {
  // Without this guard a user could set max_concurrent_calls to 0 while
  // calls are in flight, causing releaseCallSlot to underflow the counter.
  assert.match(
    ROUTES,
    /live > req\.body\.max_concurrent_calls/,
    'routes check live > new cap'
  );
  assert.match(
    ROUTES,
    /status\(409\).*Cannot set cap to/s,
    'returns 409 with descriptive message'
  );
});
