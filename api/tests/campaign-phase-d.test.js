'use strict';

/**
 * Source-level invariant tests for Phase D of the campaign execution engine.
 *
 * Phase D replaced the single campaign-dispatch queue with two shared BullMQ
 * channel queues (campaign-calls, campaign-whatsapp) and introduced per-campaign
 * repeatable ticks arm/disarmed on launch/pause/complete.
 *
 * These tests read source files as text so they catch regressions without
 * requiring a running DB or Redis — the same approach used in campaign-pr5.test.js
 * and campaign-import.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = (...parts) => path.join(__dirname, '..', 'src', ...parts);

const SCHEDULER = fs.readFileSync(SRC('jobs', 'campaignSchedulerJob.js'), 'utf8');
const CALL_WORKER = fs.readFileSync(SRC('jobs', 'campaignCallWorker.js'), 'utf8');
const ADVANCE = fs.readFileSync(SRC('services', 'campaign-advance.js'), 'utf8');
const QUEUES = fs.readFileSync(SRC('jobs', 'campaignQueues.js'), 'utf8');
const ROUTES = fs.readFileSync(SRC('routes', 'campaigns.js'), 'utf8');

// ── D1: Per-campaign tick arm on launch ───────────────────────────────────────

test('D1: POST /:id/launch calls armCampaignTick with the campaign id', () => {
  // The launch route must arm the per-campaign repeatable tick so runs start
  // being picked up within 60 s of going live.

  // armCampaignTick must be imported from campaignSchedulerJob inside the launch handler.
  assert.match(
    ROUTES,
    /armCampaignTick.*=.*require.*campaignSchedulerJob/s,
    'launch route requires armCampaignTick from campaignSchedulerJob'
  );

  // armCampaignTick must be awaited with row.id (the campaign id).
  assert.match(
    ROUTES,
    /await armCampaignTick\(row\.id\)/,
    'launch route awaits armCampaignTick(row.id)'
  );

  // The tick arm must happen after status is set to 'running'.
  const runningPos = ROUTES.indexOf("status: 'running'");
  const armPos = ROUTES.indexOf('armCampaignTick(row.id)');
  assert.ok(runningPos > 0, "status 'running' assignment found");
  assert.ok(armPos > runningPos, 'armCampaignTick called after status set to running');
});

// ── D2: Per-campaign tick disarm on pause ─────────────────────────────────────

test('D2: POST /:id/pause calls disarmCampaignTick with the campaign id', () => {
  // The pause route must disarm the repeatable tick so the scheduler stops
  // firing for a paused campaign and doesn't waste Redis + DB resources.

  assert.match(
    ROUTES,
    /disarmCampaignTick.*=.*require.*campaignSchedulerJob/s,
    'pause route requires disarmCampaignTick from campaignSchedulerJob'
  );

  assert.match(
    ROUTES,
    /await disarmCampaignTick\(row\.id\)/,
    'pause route awaits disarmCampaignTick(row.id)'
  );

  // The tick disarm must happen after status is set to 'paused'.
  const pausedPos = ROUTES.indexOf("status: 'paused'");
  const disarmPos = ROUTES.indexOf('disarmCampaignTick(row.id)');
  assert.ok(pausedPos > 0, "status 'paused' assignment found");
  assert.ok(disarmPos > pausedPos, 'disarmCampaignTick called after status set to paused');
});

// ── D3: Scheduler enqueues to correct channel queue ───────────────────────────

test('D3: scheduler tick enqueues call actions to campaign-calls, WA actions to campaign-whatsapp', () => {
  // The channel routing logic must read action.type from the snapshot and
  // select the correct queue constant before calling queue.add().

  // Both queue name constants are imported.
  assert.match(SCHEDULER, /CALLS_QUEUE/, 'CALLS_QUEUE referenced in scheduler');
  assert.match(SCHEDULER, /WHATSAPP_QUEUE/, 'WHATSAPP_QUEUE referenced in scheduler');

  // The ternary (or equivalent) that maps action.type === 'call' to CALLS_QUEUE.
  assert.match(
    SCHEDULER,
    /action\.type.*===.*'call'.*CALLS_QUEUE.*WHATSAPP_QUEUE/s,
    "scheduler routes call actions to CALLS_QUEUE and others to WHATSAPP_QUEUE"
  );

  // Run status is updated to 'queued' before or after enqueue (mark-then-enqueue).
  assert.match(
    SCHEDULER,
    /status.*'queued'/,
    "scheduler marks run status as 'queued'"
  );
});

// ── D4: Call worker respects org concurrent limit ─────────────────────────────

test('D4: call worker reads org.settings.campaign_max_concurrent_calls for the concurrency cap', () => {
  // The cap must come from the org row, not a per-campaign field, so one
  // deployment-level knob controls all campaigns in the org simultaneously.

  assert.match(
    CALL_WORKER,
    /org\.settings\?\.campaign_max_concurrent_calls/,
    'cap read from org.settings.campaign_max_concurrent_calls'
  );

  // DEFAULT_MAX_CONCURRENT fallback must be defined (guards misconfigured orgs).
  assert.match(
    CALL_WORKER,
    /DEFAULT_MAX_CONCURRENT\s*=\s*30\b/,
    'DEFAULT_MAX_CONCURRENT = 30 is the fallback'
  );

  // The free-slots calculation: maxConcurrent − liveCount.
  assert.match(
    CALL_WORKER,
    /freeSlots\s*=.*maxConcurrent\s*-\s*liveCount/,
    'freeSlots = maxConcurrent - liveCount'
  );

  // The dequeue loop iterates freeSlots times, not unlimited.
  assert.match(
    CALL_WORKER,
    /for.*i\s*<\s*freeSlots/,
    'dequeue loop bounded by freeSlots'
  );
});

// ── D5: Sequential multi-action same day ─────────────────────────────────────

test('D5: advance() same-day next action enqueues directly to channel queue without tick wait', () => {
  // When the next action is in the same day, advance() must enqueue to the
  // channel queue immediately (no pending + next_run_at round-trip through
  // the scheduler tick) so actions fire back-to-back.

  // hasNextAction branch must enqueue via queue.add().
  assert.match(
    ADVANCE,
    /hasNextAction/,
    'hasNextAction flag computed in advance()'
  );

  // Same-day queue routing: nextAction.type === 'call' → CALLS_QUEUE.
  assert.match(
    ADVANCE,
    /nextAction\.type.*===.*'call'.*CALLS_QUEUE.*WHATSAPP_QUEUE/s,
    'same-day next action routed to CALLS_QUEUE or WHATSAPP_QUEUE'
  );

  // Run is marked 'queued' with current_action_index = nextActionIdx immediately.
  assert.match(
    ADVANCE,
    /status.*'queued'.*current_action_index.*nextActionIdx/s,
    'run updated to queued with incremented action index'
  );

  // queue.add() is called inside advance for the same-day case.
  assert.match(
    ADVANCE,
    /queue\.add\(/,
    'queue.add() called in advance for same-day next action'
  );

  // The jobId for the same-day enqueue encodes run id, day, and new action idx.
  assert.match(
    ADVANCE,
    /run-\$\{freshRun\.id\}-d\$\{dayIdx\}-a\$\{nextActionIdx\}/,
    'same-day jobId encodes runId, dayIdx, nextActionIdx'
  );
});

// ── D6: BullMQ exponential retry config ──────────────────────────────────────

test('D6: BullMQ jobs configured with attempts:5 and exponential backoff starting at 60 s', () => {
  // BullMQ exponential retry with delay=60_000: 1 m → 2 m → 4 m → 8 m → 16 m.
  // This config must be present on every queue.add() call that enqueues runs
  // (both in the scheduler and in advance()).

  // Scheduler uses attempts: 5.
  assert.match(
    SCHEDULER,
    /attempts:\s*5\b/,
    'scheduler sets attempts: 5 on enqueued jobs'
  );

  // Scheduler uses exponential backoff with 60 s base delay.
  assert.match(
    SCHEDULER,
    /backoff:\s*\{[^}]*type:\s*'exponential'[^}]*delay:\s*60[_,]?000/s,
    "scheduler sets backoff { type: 'exponential', delay: 60_000 }"
  );

  // advance() same-day enqueue also carries the same retry config.
  assert.match(
    ADVANCE,
    /attempts:\s*5\b/,
    'advance() sets attempts: 5 on same-day enqueued jobs'
  );

  assert.match(
    ADVANCE,
    /backoff:\s*\{[^}]*type:\s*'exponential'[^}]*delay:\s*60[_,]?000/s,
    "advance() sets backoff { type: 'exponential', delay: 60_000 }"
  );
});

// ── D7: advance() cross-day sets pending with correct next_run_at offset ──────

test('D7: advance() cross-day sets status pending with next_run_at = NOW() + gap_days * 86_400_000', () => {
  // Cross-day transition must NOT enqueue directly — it returns the run to
  // 'pending' with a future next_run_at so the 1-minute tick picks it up only
  // after the configured gap_days have elapsed.

  // hasNextDay branch (cross-day path exists).
  assert.match(
    ADVANCE,
    /hasNextDay/,
    'hasNextDay flag computed in advance()'
  );

  // gapMs = gap_days * 86_400_000.
  assert.match(
    ADVANCE,
    /gapMs\s*=.*gap_days.*\*\s*86[_,]?400[_,]?000/,
    'gapMs = gap_days * 86_400_000'
  );

  // next_run_at computed as Date.now() + gapMs.
  assert.match(
    ADVANCE,
    /next_run_at.*Date\.now\(\)\s*\+\s*gapMs/s,
    'next_run_at = Date.now() + gapMs'
  );

  // Status set to 'pending', current_day_index advances by 1, action resets to 0.
  assert.match(
    ADVANCE,
    /status.*'pending'.*current_day_index.*dayIdx\s*\+\s*1.*current_action_index.*0/s,
    "cross-day: status 'pending', day_index incremented, action_index reset to 0"
  );

  // No queue.add() call in the cross-day branch — advance returns to pending only.
  // We verify by checking the structure: hasNextDay block has no queue.add.
  // Approach: extract the hasNextDay branch text and confirm queue.add is absent.
  const crossDayBranch = ADVANCE.match(/} else if \(hasNextDay\) \{([\s\S]*?)\} else \{/);
  assert.ok(crossDayBranch, 'hasNextDay else-if branch found');
  assert.doesNotMatch(
    crossDayBranch[1],
    /queue\.add\(/,
    'cross-day branch does NOT call queue.add() (no direct enqueue on cross-day)'
  );
});
