'use strict';

/**
 * Call-logs-driven ticket creation scheduler.
 *
 * Polls every POLL_INTERVAL_MS (default 60s). For each "missed" call
 * shape produced by `buildMissedCallsQuery`, upserts a ticket (via
 * existing `Ticket.upsertFromCdr`) and records one row in
 * `ticket_call_events` for the timeline UI.
 *
 * Replaces (for allow-listed orgs only) the per-row classifier in
 * pollCdr that has produced two false-ticket incidents in two days:
 *   - 2026-05-15 disposition override treated Local/qm bridges as
 *     "not bridged" → flipped ANSWERED→NO ANSWER → false tickets
 *   - 2026-05-16 `lastCdrId` race: sibling CDR rows for one linkedid
 *     settle at different times, the later-settling ANSWERED row
 *     gets skipped because `id > lastCdrId` advances past it
 *
 * Both bugs disappear here because:
 *   1. The query reads the SAME dedup the call-logs UI uses
 *      (ANSWERED+billsec>0 preferring), so app code and operator UI
 *      agree on what was missed.
 *   2. Time-window scans (not id watermarks) tolerate out-of-order
 *      settle without dropping rows.
 *   3. `(ticket_id, linkedid) UNIQUE` on ticket_call_events makes the
 *      overlap region safe — re-emitting the same event is a no-op.
 *
 * Scope: feature-flag gated by env `TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS`
 * (comma-separated). Non-allow-listed orgs continue to use the legacy
 * pollCdr classifier exactly as before. Empty env var = scheduler
 * arms but loops idle (logged at start).
 *
 * Not handled here (future work):
 *   - bot_dropped detection — requires extending the call-logs SQL to
 *     surface AI bridges. Today the query simply categorises any
 *     missed shape as `missed_call` or `queue_timeout`.
 *   - outbound-attempt recording — when the hospital calls a
 *     ticketed number, we'd insert an event with kind='outbound_attempt'.
 *     Schema supports it; wiring deferred.
 */

const cron = require('node-cron');
const { QueryTypes } = require('sequelize');

const {
  sequelize, Ticket, TicketCallEvent,
} = require('../models');
const ticketStream = require('../services/ticketStream');
const {
  buildMissedCallsQuery,
  decideSourceAndKind,
  parseEnabledOrgs,
  ORG_IDS_ENV,
  ENABLED_WILDCARD,
} = require('../services/callLogsTicketQuery');

const POLL_INTERVAL_MS = Number(process.env.TICKETS_FROM_CALLLOGS_POLL_MS) || 60_000;
// Defaults tuned for SESSION-level settle (see callLogsTicketQuery):
// 60s settle past the last CDR row of the session, 300s look-back so
// any session whose last row landed in the past 5 minutes is caught
// — even if a previous poll skipped it due to the session not yet
// being quiet.
const WINDOW_SECS      = Number(process.env.TICKETS_FROM_CALLLOGS_WINDOW_SECS) || 300;
const SETTLE_SECS      = Number(process.env.TICKETS_FROM_CALLLOGS_SETTLE_SECS) || 60;

let _timer = null;
let _running = false;        // re-entry guard for overlapping ticks
let _lastTickAt = null;      // for /health visibility (future)
let _stats = { ticks: 0, rowsScanned: 0, ticketsTouched: 0, eventsRecorded: 0, errors: 0 };

/**
 * One poll cycle. Public for tests + manual REPL invocation.
 * Returns the stats delta for this cycle.
 */
async function runOnce() {
  if (_running) return { skipped: 'overlapping_tick' };
  _running = true;
  const tickStart = Date.now();
  const delta = { rowsScanned: 0, ticketsTouched: 0, eventsRecorded: 0, errors: 0 };
  try {
    const enabled = parseEnabledOrgs(process.env[ORG_IDS_ENV]);
    if (enabled.size === 0) return { skipped: 'no_enabled_orgs' };

    const { sql, replacements } = buildMissedCallsQuery({
      orgIds: Array.from(enabled),
      windowSecs: WINDOW_SECS,
      settleSecs: SETTLE_SECS,
    });
    const rows = await sequelize.query(sql, {
      replacements,
      type: QueryTypes.SELECT,
    });
    delta.rowsScanned = rows.length;
    if (rows.length === 0) return { ...delta, scanned_only: true };

    const orgsTouched = new Set();
    for (const r of rows) {
      try {
        const { source, kind } = decideSourceAndKind(r);
        // upsertFromCdr: row-locked find-or-increment per (org, caller).
        // Same API the legacy classifier uses, so dual-write during the
        // rollout window doesn't create competing rows.
        // `notes` is consumed by upsertFromCdr ONLY on first INSERT
        // (existing tickets keep their original notes), so passing
        // it unconditionally is safe — no clobber risk.
        const { ticket } = await Ticket.upsertFromCdr({
          org_id: r.org_id,
          callerRaw: r.src,
          source,
          callId: r.linkedid || r.uniqueid || null,
          callTimestamp: r.end_time || r.calldate || null,
          notes: JSON.stringify({
            category: source === 'queue_timeout' ? 'Queue Timeout' : 'Missed Call',
          }),
        });
        delta.ticketsTouched++;

        // Record one timeline event per linkedid. Duplicate-key (same
        // linkedid already recorded for this ticket) is silently
        // absorbed by recordSafe — that's the hot path on the 30s
        // window overlap between consecutive polls.
        const { created: eventCreated } = await TicketCallEvent.recordSafe({
          ticket_id:   ticket.id,
          org_id:      r.org_id,
          linkedid:    r.linkedid || r.uniqueid,
          occurred_at: r.end_time || r.calldate || new Date(),
          kind,
          meta: {
            duration: Number(r.duration || 0),
            billsec:  Number(r.billsec || 0),
            disposition: r.disposition || null,
            lastapp:  r.lastapp || null,
            dstchannel: r.dstchannel || null,
          },
        });
        if (eventCreated) delta.eventsRecorded++;
        orgsTouched.add(r.org_id);
      } catch (rowErr) {
        delta.errors++;
        console.error('ticketsFromCallLogs row error:',
          rowErr && rowErr.message, 'linkedid=', r && r.linkedid);
      }
    }
    // Single SSE broadcast per org per tick — operators see one refresh
    // after a batch, not N refreshes per row.
    for (const orgId of orgsTouched) {
      try { ticketStream.broadcast(orgId, { type: 'refresh' }); }
      catch (broadcastErr) {
        console.error('ticketsFromCallLogs SSE broadcast failed:',
          broadcastErr && broadcastErr.message);
      }
    }
    return delta;
  } catch (err) {
    delta.errors++;
    console.error('ticketsFromCallLogs tick error:', err && err.message);
    return delta;
  } finally {
    _running = false;
    _lastTickAt = Date.now();
    _stats.ticks++;
    _stats.rowsScanned    += delta.rowsScanned;
    _stats.ticketsTouched += delta.ticketsTouched;
    _stats.eventsRecorded += delta.eventsRecorded;
    _stats.errors         += delta.errors;
    const ms = Date.now() - tickStart;
    if (delta.rowsScanned > 0) {
      console.log(`ticketsFromCallLogs tick: scanned=${delta.rowsScanned} ` +
        `tickets=${delta.ticketsTouched} events=${delta.eventsRecorded} ` +
        `errors=${delta.errors} ${ms}ms`);
    }
  }
}

function start() {
  if (_timer) return _timer;
  const enabled = parseEnabledOrgs(process.env[ORG_IDS_ENV]);
  if (enabled.size === 0) {
    console.log(`ticketsFromCallLogs: ${ORG_IDS_ENV} is empty — scheduler idle.`);
    // Still arm the interval so flipping the env later + restart picks it up.
  } else if (enabled.has(ENABLED_WILDCARD)) {
    console.log(`ticketsFromCallLogs: armed for ALL ORGS (wildcard '${ENABLED_WILDCARD}') ` +
      `every ${POLL_INTERVAL_MS / 1000}s, window=${WINDOW_SECS}s settle=${SETTLE_SECS}s`);
  } else {
    console.log(`ticketsFromCallLogs: armed for ${enabled.size} org(s) ` +
      `[${Array.from(enabled).join(', ')}] every ${POLL_INTERVAL_MS / 1000}s, ` +
      `window=${WINDOW_SECS}s settle=${SETTLE_SECS}s`);
  }
  _timer = setInterval(() => { runOnce().catch(() => {}); }, POLL_INTERVAL_MS);
  return _timer;
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

function getStats() {
  return { ..._stats, lastTickAt: _lastTickAt };
}

module.exports = { start, stop, runOnce, getStats };
