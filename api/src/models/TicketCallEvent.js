'use strict';

/**
 * TicketCallEvent — one row per call attempt that contributed to a
 * missed-call ticket. Append-only timeline; read by the editor when
 * an operator expands a ticket to see "called at 11:00 PM, 12:00 AM,
 * 12:15 AM".
 *
 * Written by `jobs/ticketsFromCallLogsScheduler.js` via
 * `TicketCallEvent.recordSafe(...)` which swallows the duplicate-key
 * error from the (ticket_id, linkedid) UNIQUE index so re-runs of the
 * same poll window are no-ops.
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const TicketCallEvent = sequelize.define('TicketCallEvent', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    ticket_id:   { type: DataTypes.UUID, allowNull: false },
    org_id:      { type: DataTypes.UUID, allowNull: false },
    linkedid:    { type: DataTypes.STRING(64), allowNull: false },
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    kind: {
      type: DataTypes.ENUM('missed', 'bot_dropped', 'outbound_attempt'),
      allowNull: false,
      defaultValue: 'missed',
    },
    meta: { type: DataTypes.JSON, allowNull: true },
  }, {
    tableName: 'ticket_call_events',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,  // append-only — no updates after insert
  });

  /**
   * Idempotent insert. Returns the row that resulted (newly inserted
   * OR already-present from a prior poll). The duplicate-key path is
   * the hot path during normal operation — every poll window overlaps
   * the previous by 30s and the scheduler re-emits already-recorded
   * events for the overlap region.
   *
   * Args: { ticket_id, org_id, linkedid, occurred_at, kind, meta }
   * Returns: { event, created: boolean }
   */
  TicketCallEvent.recordSafe = async function recordSafe(attrs) {
    if (!attrs || !attrs.ticket_id || !attrs.linkedid) {
      throw new Error('TicketCallEvent.recordSafe requires ticket_id and linkedid');
    }
    try {
      const event = await TicketCallEvent.create(attrs);
      return { event, created: true };
    } catch (err) {
      // Duplicate-key (UNIQUE on ticket_id+linkedid) is the expected
      // path on poll-window overlap — silently treat as already-present.
      const isDuplicate =
        err && (err.name === 'SequelizeUniqueConstraintError' ||
                (err.original && (err.original.errno === 1062 || err.original.code === 'ER_DUP_ENTRY')));
      if (!isDuplicate) throw err;
      const existing = await TicketCallEvent.findOne({
        where: { ticket_id: attrs.ticket_id, linkedid: attrs.linkedid },
      });
      return { event: existing, created: false };
    }
  };

  return TicketCallEvent;
};
