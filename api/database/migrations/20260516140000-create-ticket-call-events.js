'use strict';

/**
 * ticket_call_events — append-only timeline of every call attempt
 * recorded against a missed-call ticket.
 *
 * Why a separate table (not a JSON column on `tickets`):
 *   - Cheaper write: an INSERT here is one row instead of read-modify-
 *     write of a JSON array, so the scheduler stays O(1) per event.
 *   - Cleanly extends to outbound-attempt logging in the future
 *     (kind='outbound_attempt') without another schema change.
 *   - Operator UX wants the timeline lazily — fetched only when an
 *     operator expands a ticket row, so a JOIN-less per-row lookup is
 *     fine and the tickets list payload stays small.
 *
 * One row per ANSWER attempt / NO_ANSWER attempt that contributed to
 * the ticket's missed_count, written by the call-logs scheduler
 * (`jobs/ticketsFromCallLogsScheduler.js`).
 *
 * Dedup invariant: a `(ticket_id, linkedid)` pair never repeats — the
 * UNIQUE index here is the idempotency guard the scheduler relies on,
 * so re-running the same poll window is a safe no-op.
 *
 * Cascade: ON DELETE CASCADE so events vanish when the parent ticket
 * is deleted (Ticket sweepArchive's `DELETE` 30 days post-archive).
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ticket_call_events', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      ticket_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tickets', key: 'id' },
        onDelete: 'CASCADE',
        // No explicit index on ticket_id — MariaDB 11 FK creates one
        // automatically; addIndex(['ticket_id']) would error 1061 per
        // the FK auto-index gotcha noted in repo memory.
      },
      org_id: {
        type: Sequelize.UUID,
        allowNull: false,
        comment: 'Denormalised from the parent ticket; lets us range-scan by org without a JOIN',
      },
      linkedid: {
        type: Sequelize.STRING(64),
        allowNull: false,
        comment: 'Asterisk linkedid (call session) — unique within (ticket_id) via the UNIQUE index below',
      },
      occurred_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: 'Time the call leg ended (calldate + duration on the CDR row)',
      },
      kind: {
        // 'missed' = NO_ANSWER inbound that incremented the ticket.
        // 'bot_dropped' = ANSWERED by AI agent under the talk-time threshold.
        // Future: 'outbound_attempt' for hospital-initiated callbacks.
        type: Sequelize.ENUM('missed', 'bot_dropped', 'outbound_attempt'),
        allowNull: false,
        defaultValue: 'missed',
      },
      meta: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Optional snapshot: { queue_name, duration, billsec, agent } — populated when cheap',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    // Idempotency guard for the scheduler: same call (linkedid) cannot
    // generate two events under the same ticket. Re-running a poll
    // window is a safe no-op because the INSERT errors and the
    // scheduler swallows duplicate-key.
    await queryInterface.addIndex('ticket_call_events', ['ticket_id', 'linkedid'], {
      unique: true,
      name: 'uniq_ticket_call_events_ticket_linkedid',
    });

    // Display-side hot query: fetch a ticket's timeline newest-first.
    await queryInterface.addIndex('ticket_call_events', ['ticket_id', 'occurred_at'], {
      name: 'idx_ticket_call_events_ticket_time',
    });

    // Cross-org safety: lets us scope reads / sweeps by org without
    // joining back through tickets.
    await queryInterface.addIndex('ticket_call_events', ['org_id', 'occurred_at'], {
      name: 'idx_ticket_call_events_org_time',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('ticket_call_events');
  },
};
