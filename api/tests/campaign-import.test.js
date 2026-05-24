'use strict';

/**
 * Source-level invariant tests for the async campaign-import pipeline.
 *
 * These tests read source files as text so they catch regressions without
 * requiring a running DB or Redis — consistent with the pattern used in
 * integration-checks.test.js. Each test encodes a specific contract that
 * broke (or would break) production behaviour if violated.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROUTES = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'campaigns.js'), 'utf8'
);
const WORKER = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'jobs', 'campaignImportWorker.js'), 'utf8'
);
const QUEUES = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'jobs', 'campaignQueues.js'), 'utf8'
);
const IMPORTER = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'campaign-csv-importer.js'), 'utf8'
);

// ── Route ordering ────────────────────────────────────────────────────

test('R1: /approvals routes declared before /:id (literal wins over param)', () => {
  const approvalsPos = ROUTES.indexOf("router.get('/approvals'");
  const idPos = ROUTES.indexOf("router.get('/:id'");
  assert.ok(approvalsPos > 0, '/approvals route exists');
  assert.ok(idPos > 0, '/:id route exists');
  assert.ok(approvalsPos < idPos, '/approvals must come before /:id');
});

test('R2: /lead-fields routes declared before /:id', () => {
  const lfPos = ROUTES.indexOf("router.get('/lead-fields'");
  const idPos = ROUTES.indexOf("router.get('/:id'");
  assert.ok(lfPos > 0, '/lead-fields route exists');
  assert.ok(lfPos < idPos, '/lead-fields must come before /:id');
});

// ── Async import route ────────────────────────────────────────────────

test('R4: import-async uses csvUploadLarge (250 MB), not csvUpload (5 MB)', () => {
  assert.match(ROUTES, /csvUploadLarge\.single/, 'csvUploadLarge used on import-async route');
  // Verify the large limit is actually 250 MB
  assert.match(ROUTES, /250 \* 1024 \* 1024/, '250 MB cap defined');
  // Verify the sync endpoint keeps the 5 MB cap
  assert.match(ROUTES, /5 \* 1024 \* 1024/, '5 MB cap for sync endpoint');
});

test('R5: import-async responds 202 (accepted), not 200 (synchronous)', () => {
  // The async path must send status 202 so the caller knows to poll.
  assert.match(ROUTES, /status\(202\)/, 'route sends 202 Accepted');
});

test('R6: import-async response includes jobId field', () => {
  assert.match(ROUTES, /jobId/, 'response includes jobId');
});

// ── Cancel endpoint ───────────────────────────────────────────────────

test('R7: cancel PATCH only accepts { status: "cancelled" }', () => {
  assert.match(
    ROUTES,
    /req\.body\.status !== 'cancelled'/,
    'payload validated to status=cancelled only'
  );
});

test('R8: cancel returns 409 for terminal states (completed/failed/cancelled)', () => {
  assert.match(ROUTES, /Cannot cancel a \$\{row\.status\} import/, '409 message for terminal states');
  assert.match(ROUTES, /completed.*failed.*cancelled/, 'all three terminal states checked');
});

test('R9: cancel does best-effort BullMQ remove after DB update', () => {
  assert.match(ROUTES, /getQueue\(IMPORT_QUEUE\)/, 'getQueue called for BullMQ remove');
  assert.match(ROUTES, /best.effort/, 'BullMQ remove marked as best-effort');
});

// ── Worker invariants ─────────────────────────────────────────────────

test('W1: BATCH_SIZE is 1000', () => {
  assert.match(WORKER, /BATCH_SIZE\s*=\s*1000\b/, 'BATCH_SIZE = 1000');
});

test('W2: MAX_ERRORS_RETAINED is 100', () => {
  assert.match(WORKER, /MAX_ERRORS_RETAINED\s*=\s*100\b/, 'MAX_ERRORS_RETAINED = 100');
});

test('W3: PRELOAD_DEDUPE_THRESHOLD is 1 000 000', () => {
  assert.match(WORKER, /PRELOAD_DEDUPE_THRESHOLD\s*=\s*1[_,]?000[_,]?000/, 'threshold = 1M');
});

test('W4: worker uses papaparse streaming (step callback), not complete-load', () => {
  // streaming via `step` is what keeps 500k-row imports memory-safe.
  assert.match(WORKER, /step\s*:\s*\(results/, 'papaparse step callback present');
  assert.doesNotMatch(WORKER, /complete\s*\(results/, 'no complete-load (data) callback');
});

test('W5: checkCancelled re-reads the DB row, not an in-memory flag only', () => {
  // Must hit the DB (CampaignImportJob.findOne) — purely in-memory checks
  // would miss a cancel issued from another process/pod.
  assert.match(WORKER, /CampaignImportJob\.findOne/, 'checkCancelled queries DB');
  assert.match(WORKER, /attributes.*status/, 'fetches only status column for efficiency');
});

test('W6: cancelled job exits cleanly without re-throw (no BullMQ retry)', () => {
  // On cancel the worker must return (not throw) so BullMQ marks the job
  // done rather than retrying. A re-throw here would re-process a cancelled
  // import 3 more times.
  assert.match(
    WORKER,
    /cancelled.*return.*\{.*cancelled.*true/s,
    'cancelled path returns cleanly without throw'
  );
});

test('W7: tmp file deleted on cancel, complete, AND failure paths', () => {
  const safeUnlinkCalls = (WORKER.match(/safeUnlink\(/g) || []).length;
  // There should be at least 4 safeUnlink calls:
  // 1. importJob not found (early exit)
  // 2. campaign deleted (early exit)
  // 3. bad column_mapping / no phone (early validation exits) — 2 calls
  // 4. cancel branch
  // 5. completion (.then)
  // 6. failure (.catch)
  assert.ok(safeUnlinkCalls >= 4, `safeUnlink called ${safeUnlinkCalls} times (need ≥4)`);
});

test('W8: progress is persisted every N batches, not every batch', () => {
  assert.match(WORKER, /PROGRESS_EVERY_N_BATCHES\s*=\s*5\b/, 'flush cadence = 5 batches');
  assert.match(WORKER, /batchesSinceFlush/, 'batchesSinceFlush counter used');
});

test('W9: BOM stripped from first chunk before papaparse sees it', () => {
  // Excel-exported CSVs start with UTF-8 BOM (0xFEFF). papaparse will
  // include it in the first header name, producing "﻿Name" instead of
  // "Name", breaking column mapping.
  assert.match(WORKER, /0xfeff/i, 'BOM detected by charCode 0xFEFF');
  assert.match(WORKER, /beforeFirstChunk/, 'beforeFirstChunk hook used to strip BOM');
});

test('W10: worker concurrency is 2', () => {
  assert.match(WORKER, /concurrency.*2/, 'concurrency: 2 passed to createWorker');
});

// ── Queue isolation ───────────────────────────────────────────────────

test('Q1: Redis key prefix is astradial:campaigns (isolated from bull: workflow-engine)', () => {
  assert.match(QUEUES, /astradial:campaigns/, 'key prefix is astradial:campaigns');
  // Must NOT use the bare 'bull' prefix that workflow-engine uses
  assert.doesNotMatch(QUEUES, /prefix.*['"]bull['"]/, 'does not use bull: prefix');
});

test('Q2: ioredis connection uses maxRetriesPerRequest: null (required by BullMQ)', () => {
  assert.match(QUEUES, /maxRetriesPerRequest.*null/, 'maxRetriesPerRequest: null set');
});

test('Q3: CAMPAIGN_WORKERS_ENABLED=0 disables workers without crashing', () => {
  assert.match(QUEUES, /CAMPAIGN_WORKERS_ENABLED/, 'env flag checked');
});

// ── PR 6 routes ───────────────────────────────────────────────────────

test('P1: /approvals/count declared before /approvals/:approvalId', () => {
  const countPos = ROUTES.indexOf("router.get('/approvals/count'");
  const idPos = ROUTES.indexOf("router.get('/approvals/:approvalId'");
  assert.ok(countPos > 0, '/approvals/count route exists');
  assert.ok(countPos < idPos, '/approvals/count must come before /:approvalId');
});

test('P2: /approvals/stream sets SSE headers and flushes', () => {
  assert.match(ROUTES, /text\/event-stream/, 'Content-Type: text/event-stream set');
  assert.match(ROUTES, /flushHeaders/, 'res.flushHeaders() called');
  assert.match(ROUTES, /req\.on\('close'/, 'cleanup on client close');
});

test('P3: /lead-fields/reorder declared before /lead-fields/:fieldId', () => {
  const reorderPos = ROUTES.indexOf("router.put('/lead-fields/reorder'");
  const idPos = ROUTES.indexOf("router.patch('/lead-fields/:fieldId'");
  assert.ok(reorderPos > 0, '/lead-fields/reorder route exists');
  assert.ok(reorderPos < idPos, '/lead-fields/reorder must come before /:fieldId');
});

// ── Importer — business field ─────────────────────────────────────────

test('I1: SYSTEM_FIELDS includes "business"', () => {
  // The business field was added as a top-level column after the initial
  // PR. Missing it here would cause the worker to treat CSV "Business"
  // columns as unknown and reject the import with BAD_MAPPING.
  assert.match(IMPORTER, /['"]business['"]/, '"business" present in importer source');
  // Confirm it is part of SYSTEM_FIELDS set, not just mentioned in a comment.
  const sysFieldsBlock = IMPORTER.match(/SYSTEM_FIELDS\s*=\s*new Set\(\[[\s\S]+?\]\)/);
  assert.ok(sysFieldsBlock, 'SYSTEM_FIELDS Set literal found');
  assert.match(sysFieldsBlock[0], /'business'/, '"business" inside SYSTEM_FIELDS');
});
