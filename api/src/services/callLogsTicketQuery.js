'use strict';

/**
 * SQL contract for the call-logs-driven ticket scheduler.
 *
 * Returns one row per linkedid where the call ended inside the
 * settle window and the *winning* CDR row for that linkedid was a
 * "missed" shape — i.e. NOT a real human bridge (PJSIP/<ep>-… with
 * billsec>0) and NOT a real queue bridge (Local/qm<32hex>@… with
 * billsec>0).
 *
 * Mirrors `/api/v1/calls` semantics (test S2: ANSWERED+billsec>0
 * preferring dedup) so the operator-visible Status column and the
 * tickets table never disagree about whether a call was missed.
 *
 * Settle at SESSION level (not per-row):
 *   Asterisk app_queue retries within a single call session emit one
 *   parent CDR row per attempt, written incrementally as each retry
 *   ends. A 52s NO_ANSWER attempt lands first, then a 44s ANSWERED
 *   attempt seconds later (linkedid 1778930693.2604 on prod
 *   2026-05-16: caller 9840415527). If we settled at the ROW level,
 *   the NO_ANSWER row's settle window (T1+settle) is hit and a
 *   ticket is created before the ANSWERED row even arrives — even
 *   though they share a linkedid and the dedup would have picked the
 *   ANSWERED row had it been present.
 *
 *   Fix: gate the WINDOW filter on the LATEST end_time across all
 *   rows of a linkedid (`MAX(end_time) OVER PARTITION BY linkedid`).
 *   We only consider a linkedid for classification once its WHOLE
 *   session has been quiet for `settleSecs` seconds — by then every
 *   retry row has landed and the dedup correctly picks the winning
 *   representative.
 *
 * Why we use a time window (not lastCdrId): a per-row id watermark
 * forces processing in id order, which breaks when sibling CDR rows
 * for the same linkedid settle at different times — `lastCdrId`
 * advances past the lower-id row that hasn't settled yet, losing it
 * forever. Pure time-window scans don't have this failure mode.
 *
 * Window overlap + idempotency: consecutive polls overlap by
 * `windowSecs - poll_interval` seconds. Repeat events on the overlap
 * are absorbed by the `ticket_call_events (ticket_id, linkedid)
 * UNIQUE` index, and `Ticket.upsertFromCdr` finds the existing open
 * ticket and no-ops on second sight.
 */

const ORG_IDS_ENV = 'TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS';
// Special token in TICKETS_FROM_CALLLOGS_ENABLED_ORG_IDS that means
// "every org goes through the new scheduler". The org filter in the
// SQL query is dropped and the legacy classifier gate in pollCdr
// short-circuits to skip-for-everyone. Mix-and-match is fine —
// `*,75dd1c…` is functionally equivalent to `*` (the explicit IDs are
// no-ops once the wildcard is present).
const ENABLED_WILDCARD = '*';

/**
 * Build the parameterised SQL + bind values for one poll cycle.
 *
 * Two modes:
 *   - Allow-list mode: `orgIds` is an array of specific org UUIDs.
 *     Query scopes the scan to `accountcode IN (...)`.
 *   - Wildcard mode: `orgIds` contains the special `'*'` token (or
 *     `opts.wildcard === true`). The accountcode filter is dropped so
 *     every org with an incoming-context CDR is classified — used
 *     once the scheduler is the canonical pipeline for all tenants.
 *
 * The window filter operates on `session_end_time` — the MAX
 * `end_time` across all CDR rows sharing the same linkedid. A
 * linkedid is considered for classification only once its LATEST
 * row's end has been quiet for `settleSecs` seconds — by then every
 * retry round has landed in the DB.
 *
 * The pre-filter on `calldate` keeps the scan area bounded (otherwise
 * the window function would scan the whole asterisk_cdr table).
 * Set wide enough to capture any session whose final row could fall
 * inside the window: `(windowSecs + max_call_duration)`.
 *
 * @param {object} opts
 * @param {string[]} opts.orgIds        - allow-list of org_ids to scan, OR contains '*' for all
 * @param {number}   opts.windowSecs    - back-window length (over session_end_time), default 300
 * @param {number}   opts.settleSecs    - settle margin past session end, default 60
 * @returns {{ sql: string, replacements: any[] }}
 */
function buildMissedCallsQuery({ orgIds, windowSecs = 300, settleSecs = 60 }) {
  if (!Array.isArray(orgIds) || orgIds.length === 0) {
    // Caller is expected to short-circuit before reaching here. Returning
    // a never-matching query is the conservative fallback.
    return { sql: 'SELECT NULL WHERE 1=0', replacements: [] };
  }
  const wildcard = orgIds.includes(ENABLED_WILDCARD);
  // Pre-filter look-back to bound the scan. Allow `windowSecs + 1h`
  // for unusually long calls so the partition's MAX(end_time) still
  // sees every sibling row.
  const prefilterSecs = windowSecs + 3600;
  // Org gate: in wildcard mode we drop the IN(…) clause entirely.
  // accountcode is still ALWAYS present on inbound CDR rows (set by
  // the dialplan in the `*_incoming_sub` extension), so we don't
  // need a NOT NULL filter — but we DO require non-empty since the
  // upstream classifier hash-routes by accountcode and we follow.
  const orgClause = wildcard
    ? `AND c.accountcode IS NOT NULL AND c.accountcode <> ''`
    : `AND c.accountcode IN (${orgIds.map(() => '?').join(',')})`;
  const sql = `
    SELECT linkedid, uniqueid, org_id, src, dst, dstchannel,
           lastapp, duration, billsec, disposition, calldate, end_time,
           session_end_time
      FROM (
        SELECT
          c.linkedid,
          c.uniqueid,
          c.accountcode AS org_id,
          c.src,
          c.dst,
          c.dstchannel,
          c.lastapp,
          c.duration,
          c.billsec,
          c.disposition,
          c.calldate,
          DATE_ADD(c.calldate, INTERVAL c.duration SECOND) AS end_time,
          -- LATEST end_time across the whole session (all rows sharing
          -- this linkedid). Drives the window filter so we wait for
          -- every retry row to land before classifying the session.
          MAX(DATE_ADD(c.calldate, INTERVAL c.duration SECOND))
            OVER (PARTITION BY c.linkedid) AS session_end_time,
          ROW_NUMBER() OVER (
            PARTITION BY c.linkedid
            ORDER BY
              CASE WHEN c.disposition = 'ANSWERED' AND c.billsec > 0 THEN 1 ELSE 0 END DESC,
              c.duration DESC,
              c.id DESC
          ) AS rk
        FROM asterisk_cdr c
        WHERE c.channel NOT LIKE 'Local/%'
          AND c.dcontext LIKE '%\\_incoming' ESCAPE '\\\\'
          ${orgClause}
          -- Bound the scan area; the session_end_time filter below
          -- is the operational gate.
          AND DATE_ADD(c.calldate, INTERVAL c.duration SECOND)
                >= DATE_SUB(NOW(), INTERVAL ? SECOND)
      ) ranked
     WHERE rk = 1
       -- Process only sessions whose LAST row settled inside the
       -- window. Equivalent to: every retry row for this linkedid
       -- has been in the DB for at least settleSecs seconds.
       AND session_end_time
             BETWEEN DATE_SUB(NOW(), INTERVAL ? SECOND)
                 AND DATE_SUB(NOW(), INTERVAL ? SECOND)
       AND NOT (
         disposition = 'ANSWERED'
         AND billsec > 0
         AND (
           dstchannel REGEXP '^PJSIP/[a-zA-Z0-9_-]+-'
           OR dstchannel REGEXP '^Local/qm[a-f0-9]{32}@'
         )
       )
     ORDER BY session_end_time ASC`;
  // Replacement order: [explicit org ids...,] prefilterSecs, windowSecs, settleSecs.
  // In wildcard mode we drop the IN(...) placeholders, so the
  // accountcode binds are skipped.
  const replacements = wildcard
    ? [prefilterSecs, windowSecs, settleSecs]
    : [...orgIds, prefilterSecs, windowSecs, settleSecs];
  return { sql, replacements };
}

/**
 * Decide ticket source + kind for a row that survived the missed-row
 * filter. Three buckets:
 *   - bot_dropped: ANSWERED row that DID bridge to an AI agent but
 *     hung up under the talk-time threshold (handled here for parity
 *     with the legacy classifier; will trip only once we add an
 *     ai-bridge column to the call-logs SQL — left as a future
 *     extension so this PR stays scoped).
 *   - queue_timeout: NO_ANSWER (or ANSWERED-but-not-bridged) where
 *     the last app was Queue/IVR/MOH. Caller actively entered a
 *     queue or IVR.
 *   - missed_call: everything else (direct extension dial that did
 *     not pick up, BUSY/FAILED/CONGESTION inbound, etc).
 */
function decideSourceAndKind(row) {
  const lastapp = String(row.lastapp || '').toLowerCase();
  if (lastapp === 'queue' || lastapp === 'waitexten'
      || lastapp === 'background' || lastapp === 'playback') {
    return { source: 'queue_timeout', kind: 'missed' };
  }
  return { source: 'missed_call', kind: 'missed' };
}

/**
 * Parse the env var into a Set for O(1) lookups. Trims whitespace
 * and ignores empty entries. The literal '*' token, if present, is
 * preserved and means "every org" — `isOrgEnabled(any, set)` returns
 * true when the set contains '*'.
 */
function parseEnabledOrgs(envValue) {
  return new Set(
    String(envValue || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Decide whether a given org is on the new scheduler. Returns true
 * when the parsed-env set contains either the wildcard token '*' or
 * the org's UUID. Callers use this to gate the legacy classifier in
 * pollCdr (skip it for enabled orgs) and to short-circuit other
 * per-org checks.
 */
function isOrgEnabled(orgId, enabledSet) {
  if (!enabledSet || enabledSet.size === 0) return false;
  if (enabledSet.has(ENABLED_WILDCARD)) return true;
  return enabledSet.has(orgId);
}

module.exports = {
  buildMissedCallsQuery,
  decideSourceAndKind,
  parseEnabledOrgs,
  isOrgEnabled,
  ORG_IDS_ENV,
  ENABLED_WILDCARD,
};
