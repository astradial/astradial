/**
 * Ticket — relational model for the customer-facing "missed-call ticket"
 * concept. See migration 20260515210000-create-tickets.js for the why,
 * dedup invariant, and status lifecycle.
 *
 * Static helpers attached to the class encapsulate the two operations
 * the CDR poller and the editor hot-path actually need:
 *   - upsertFromCdr  — dedup-aware INSERT-or-INCREMENT for a missed call
 *   - sweepArchive   — lazy state transitions called from the list endpoint
 *
 * Both keep all SQL inside the model so callers don't sprinkle raw
 * queries around.
 */
'use strict';

const { DataTypes } = require('sequelize');

// Trailing 10 digits — the canonical key for dedup. "9876543210",
// "919876543210", "0 99444 21125", "+91-99444-21125" all collapse to
// "9876543210".
function normalisePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length <= 10) return digits;
  if (digits.startsWith('91') && digits.length >= 12) return digits.slice(-10);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits.slice(-10);
}

function priorityFor(missedCount) {
  if (missedCount >= 3) return 'urgent';
  if (missedCount >= 2) return 'high';
  return 'normal';
}

module.exports = (sequelize) => {
  const Ticket = sequelize.define('Ticket', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false },
    caller_number: { type: DataTypes.STRING(20), allowNull: false },
    caller_name: { type: DataTypes.STRING(255), allowNull: true },
    source: {
      type: DataTypes.ENUM('missed_call', 'queue_timeout', 'bot_dropped', 'manual'),
      allowNull: false,
      defaultValue: 'missed_call',
    },
    priority: {
      type: DataTypes.ENUM('normal', 'high', 'urgent'),
      allowNull: false,
      defaultValue: 'normal',
    },
    status: {
      type: DataTypes.ENUM('open', 'in_progress', 'closed', 'archived'),
      allowNull: false,
      defaultValue: 'open',
    },
    missed_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    last_call_id: { type: DataTypes.STRING(64), allowNull: true },
    last_call_at: { type: DataTypes.DATE, allowNull: true },
    closed_at: { type: DataTypes.DATE, allowNull: true },
    archived_at: { type: DataTypes.DATE, allowNull: true },
    assignee_user_id: { type: DataTypes.UUID, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    tags: { type: DataTypes.JSON, allowNull: true },
  }, {
    tableName: 'tickets',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  });

  // Expose helpers as statics so callers can `Ticket.upsertFromCdr(...)`.
  Ticket.normalisePhone = normalisePhone;
  Ticket.priorityFor = priorityFor;

  /**
   * Dedup-aware ticket create-or-increment.
   *
   * If an `open` or `in_progress` ticket exists for this org+caller,
   * increment its missed_count and recompute priority. Otherwise
   * INSERT a fresh row. Run inside a transaction with row-level
   * locking so two simultaneous CDR-poller cycles can't race to
   * create duplicate tickets for the same caller.
   *
   * Args:
   *   - org_id          (required)
   *   - callerRaw       — anything; we normalise. Required.
   *   - source          — 'missed_call' | 'queue_timeout' | 'bot_dropped' | 'manual'
   *   - callerName      — best-effort display name (resolved from user table or CDR clid)
   *   - callId          — Asterisk uniqueid (for traceability)
   *   - callTimestamp   — Date for the call (defaults to NOW)
   *
   * Returns: { ticket, created } where `created` is true if a NEW row
   * was inserted (caller can use this to fire ticket_opened notifications)
   * vs false if an existing ticket was incremented.
   */
  Ticket.upsertFromCdr = async function upsertFromCdr({
    org_id, callerRaw, source = 'missed_call', callerName = null,
    callId = null, callTimestamp = null, notes = null,
  }) {
    if (!org_id) throw new Error('upsertFromCdr requires org_id');
    if (!callerRaw) throw new Error('upsertFromCdr requires callerRaw');
    const caller_number = normalisePhone(callerRaw);
    if (!caller_number) throw new Error('upsertFromCdr could not normalise callerRaw');
    const last_call_at = callTimestamp ? new Date(callTimestamp) : new Date();

    return sequelize.transaction(async (t) => {
      const existing = await Ticket.findOne({
        where: {
          org_id,
          caller_number,
          status: ['open', 'in_progress'],
        },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (existing) {
        const newCount = (existing.missed_count || 0) + 1;
        await existing.update({
          missed_count: newCount,
          priority: priorityFor(newCount),
          last_call_id: callId || existing.last_call_id,
          last_call_at,
          // Refresh caller_name only if we now have one and didn't before
          caller_name: existing.caller_name || callerName || null,
        }, { transaction: t });
        return { ticket: existing, created: false };
      }

      const created = await Ticket.create({
        org_id,
        caller_number,
        caller_name: callerName || null,
        source,
        priority: 'normal',
        status: 'open',
        missed_count: 1,
        last_call_id: callId,
        last_call_at,
        notes: notes || null,
      }, { transaction: t });
      return { ticket: created, created: true };
    });
  };

  /**
   * Lazy state-transition sweep — called at the top of every
   * GET /api/v1/tickets so we never need a cron. Two transitions:
   *   1. closed > 24h ago → archived
   *   2. archived > 30 days ago → DELETE (storage policy)
   *
   * Org-scoped so the sweep can't touch other orgs' data. Indexed
   * (idx_tickets_archive_sweep + idx_tickets_delete_sweep) so even
   * orgs with thousands of historic tickets finish in milliseconds.
   *
   * Returns: { archived, deleted } counts for caller logging.
   */
  Ticket.sweepArchive = async function sweepArchive(org_id) {
    if (!org_id) throw new Error('sweepArchive requires org_id');
    const [, archivedMeta] = await sequelize.query(
      `UPDATE tickets
         SET status = 'archived',
             archived_at = NOW(),
             updated_at = NOW()
       WHERE org_id = ?
         AND status = 'closed'
         AND closed_at IS NOT NULL
         AND closed_at < (NOW() - INTERVAL 1 DAY)`,
      { replacements: [org_id] }
    );
    const [, deletedMeta] = await sequelize.query(
      `DELETE FROM tickets
         WHERE org_id = ?
           AND status = 'archived'
           AND archived_at IS NOT NULL
           AND archived_at < (NOW() - INTERVAL 30 DAY)`,
      { replacements: [org_id] }
    );
    return {
      archived: archivedMeta?.affectedRows || 0,
      deleted: deletedMeta?.affectedRows || 0,
    };
  };

  return Ticket;
};
