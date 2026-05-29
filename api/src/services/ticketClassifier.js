/**
 * Ticket classifier — decides whether an inbound CDR row should
 * create or increment a missed-call ticket in MariaDB.
 *
 * Replaces the upstream classifier on events.example.com so the
 * decision lives in the same process that polls CDRs. Side benefits:
 *   - No HTTP round-trip per call (was 200-500ms, now <5ms)
 *   - Classifier rules are PR-reviewed in this repo
 *   - Ticket write is atomic with the surrounding DB transaction
 *
 * The single export `classifyAndUpsertTicket(cdrRow, orgId,
 * effectiveDisposition)` is called by `pollCdr` for every inbound
 * CDR. It either upserts a ticket via `Ticket.upsertFromCdr` or
 * returns `{ skipped: true, reason }` for human-answered / AI-handled
 * / non-ticket-worthy calls.
 *
 * Bot-extension cache: each org's list of `routing_type='ai_agent'`
 * users is fetched lazily and cached for 5 minutes. Toggling a user's
 * routing_type takes up to that long to propagate.
 */
'use strict';

const { Ticket, User, sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const ticketStream = require('./ticketStream');

const BOT_DROP_THRESHOLD_SECS = 8;
const BOT_EXT_TTL_MS = 5 * 60 * 1000;

const _botExtCache = new Map();  // orgId → { exts: Set<string>, expiresAt }
const _userByPhoneCache = new Map();  // orgId → { byPhone: Map<10digit,user>, expiresAt }

async function getBotExtensions(orgId) {
  const cached = _botExtCache.get(orgId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.exts;
  const rows = await User.findAll({
    where: { org_id: orgId, routing_type: 'ai_agent', status: 'active' },
    attributes: ['extension'],
    raw: true,
  });
  const exts = new Set(rows.map((r) => String(r.extension)).filter(Boolean));
  _botExtCache.set(orgId, { exts, expiresAt: now + BOT_EXT_TTL_MS });
  return exts;
}

// Phone-number → caller-name resolution. Same 5-min cache as the bot
// list. Matches against the org's users.phone_number using the trailing
// 10-digit normalised form (handled by the SQL).
async function resolveCallerName(orgId, callerNumber) {
  const cached = _userByPhoneCache.get(orgId);
  const now = Date.now();
  let byPhone;
  if (cached && cached.expiresAt > now) {
    byPhone = cached.byPhone;
  } else {
    const rows = await User.findAll({
      where: { org_id: orgId, status: 'active' },
      attributes: ['full_name', 'username', 'phone_number'],
      raw: true,
    });
    byPhone = new Map();
    for (const u of rows) {
      if (!u.phone_number) continue;
      const k = Ticket.normalisePhone(u.phone_number);
      if (k && !byPhone.has(k)) byPhone.set(k, u.full_name || u.username);
    }
    _userByPhoneCache.set(orgId, { byPhone, expiresAt: now + BOT_EXT_TTL_MS });
  }
  const k = Ticket.normalisePhone(callerNumber);
  return byPhone.get(k) || null;
}

/**
 * Decide + upsert. Arguments:
 *   - r                       — the asterisk_cdr row (raw shape from pollCdr)
 *   - orgId                   — resolved org UUID
 *   - effectiveDisposition    — disposition the caller has already
 *     normalised (today's hotfix overrides ANSWERED→NO ANSWER for
 *     IVR/queue-abandoned). Used so the rules here line up with what
 *     gets POSTed to events.example.com during dual-write.
 *
 * Returns one of:
 *   - { skipped: true, reason: '<why>' }
 *   - { upserted: true, ticket_id, created: bool, source: '<...>' }
 */
async function classifyAndUpsertTicket(r, orgId, effectiveDisposition) {
  if (!orgId) return { skipped: true, reason: 'no_org' };

  const src = String(r.src || '').trim();
  if (!src || src.length < 7) {
    return { skipped: true, reason: 'src_not_a_phone_number' };
  }

  const disp = String(effectiveDisposition || r.disposition || '').toUpperCase();
  const dch = String(r.dstchannel || '').trim();
  const lastapp = String(r.lastapp || '').toLowerCase();
  const billsec = Number(r.billsec || 0);

  // Did this call actually bridge to a real PJSIP user endpoint?
  // Two valid shapes:
  //   1. `PJSIP/<endpoint>-…` — direct dial straight to a member.
  //   2. `Local/qm<hex>@<org>__qmem-…` — queue routes through our
  //      per-member helper context. When billsec > 0 on a Queue row
  //      with this dstchannel, app_queue HAS bridged caller↔member
  //      successfully (regardless of whether the inner Dial was to
  //      PJSIP or a phone-via-trunk). Without this branch, every
  //      successfully-answered queue call falls through to the
  //      missed-ticket path and the auto-classifier creates a
  //      bogus "Queue Timeout" ticket on top of a completed call.
  //      Reproduced 2026-05-15 on Thangavelu Hospital: call answered
  //      by Raman for 45s, ticket opened anyway.
  const realPjsipBridge = /^PJSIP\/[a-zA-Z0-9_-]+-/.test(dch) && billsec > 0;
  const realQueueBridge = /^Local\/qm[a-f0-9]{32}@/.test(dch) && billsec > 0 && lastapp === 'queue';

  // Queue answered the call → no ticket. We do not try to detect
  // bot-handled queue calls here because the bot extension lives
  // INSIDE the qm helper context, not on this parent CDR row — that
  // detection belongs at the inner Dial CDR row level if it's ever
  // needed.
  //
  // Cross-batch safety net: if pollCdr processed a NO_ANSWER row for
  // this same linkedid in an earlier batch (before the ANSWERED row
  // existed), a bogus "Queue Timeout" ticket may already be open.
  // Auto-close it now that we have proof the call was answered.
  // Matching is scoped to (org, caller_number, last_call_id matches
  // OR ticket created in last 10min) so we don't clobber unrelated
  // tickets for the same caller.
  if (disp === 'ANSWERED' && realQueueBridge) {
    try {
      const callerKey = Ticket.normalisePhone(r.src);
      if (callerKey) {
        await sequelize.query(
          `UPDATE tickets
              SET status = 'closed',
                  closed_at = NOW(),
                  updated_at = NOW()
            WHERE org_id = ?
              AND caller_number = ?
              AND status IN ('open','in_progress')
              AND (last_call_id = ? OR created_at > (NOW() - INTERVAL 10 MINUTE))`,
          { replacements: [orgId, callerKey, r.uniqueid || r.linkedid || ''] }
        );
        ticketStream.broadcast(orgId, { type: 'refresh' });
      }
    } catch (closeErr) {
      console.warn('classifier: failed to auto-close ticket for answered queue call:', closeErr.message);
    }
    return { skipped: true, reason: 'queue_answered' };
  }

  // If a real human (not bot) picked up, no ticket.
  if (disp === 'ANSWERED' && realPjsipBridge) {
    // Could be a member ext or could be a bot ext. Decide based on
    // the org's bot list.
    const bots = await getBotExtensions(orgId);
    // Extract extension from the PJSIP channel name, e.g.
    // PJSIP/org_demo_1002-0000005d → 1002
    const extMatch = dch.match(/PJSIP\/\w+?_(\d{2,6})-/);
    const ext = extMatch ? extMatch[1] : null;
    if (ext && bots.has(ext)) {
      // Bot answered — but did the caller actually engage long enough
      // for the bot to do something useful? Under the 8s threshold
      // we still create a `bot_dropped` ticket so the operator
      // follows up.
      if (billsec >= BOT_DROP_THRESHOLD_SECS) {
        return { skipped: true, reason: 'ai_handled' };
      }
      const callerName = await resolveCallerName(orgId, src);
      const { ticket, created } = await Ticket.upsertFromCdr({
        org_id: orgId,
        callerRaw: src,
        source: 'bot_dropped',
        callerName: callerName || (r.clid || null),
        callId: r.uniqueid || null,
        callTimestamp: r.calldate || null,
        notes: JSON.stringify({ category: 'Bot Dropped' }),
      });
      ticketStream.broadcast(orgId, { type: 'refresh', ticket_id: ticket.id });
      return { upserted: true, ticket_id: ticket.id, created, source: 'bot_dropped' };
    }
    // Real human bridged — no ticket.
    return { skipped: true, reason: 'human_answered' };
  }

  // Everything past this point is a candidate for a missed-call
  // ticket. Distinguish "in queue/IVR when caller hung up" from
  // "plain NO ANSWER" purely for the `source` label so the editor
  // can show what kind of miss it was.
  let source = 'missed_call';
  if (lastapp === 'queue') source = 'queue_timeout';
  else if (['waitexten', 'background', 'playback'].includes(lastapp)) source = 'queue_timeout';

  // disposition='ANSWERED' with no realPjsipBridge — i.e. Answer()
  // ran for the IVR / queue music but no member picked up — was
  // already handled by the disposition override; we'd see disp =
  // 'NO ANSWER' here. But if a future code path forgets that
  // override, fall through to the same missed-call path rather
  // than silently dropping the ticket.
  const callerName = await resolveCallerName(orgId, src);
  // Default category shown in the editor's "Category" column. The
  // source value (queue_timeout vs missed_call) is preserved
  // separately on the column; category is the human-friendly label.
  const categoryLabel = source === 'queue_timeout' ? 'Queue Timeout' : 'Missed Call';
  const { ticket, created } = await Ticket.upsertFromCdr({
    org_id: orgId,
    callerRaw: src,
    source,
    callerName: callerName || (r.clid || null),
    callId: r.uniqueid || null,
    callTimestamp: r.calldate || null,
    notes: JSON.stringify({ category: categoryLabel }),
  });
  ticketStream.broadcast(orgId, { type: 'refresh', ticket_id: ticket.id });
  return { upserted: true, ticket_id: ticket.id, created, source };
}

module.exports = { classifyAndUpsertTicket, getBotExtensions, resolveCallerName };
// Allow caches to be flushed by tests / hot-reload paths.
module.exports._flushCaches = () => {
  _botExtCache.clear();
  _userByPhoneCache.clear();
};
