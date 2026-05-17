'use strict';

/**
 * Tickets table — relational replacement for the Firestore
 * `astrapbx/{orgId}/tickets` collection.
 *
 * Why: the upstream auto-ticket classifier on events.example.com
 * + Firestore introduces multiple network hops, opaque skip rules
 * (today's IVR-abandoned bug), and a separate auth/security surface
 * for the editor. Pulling tickets into the same MariaDB the rest of
 * the platform runs on collapses three external dependencies into
 * one in-process write, gives us SQL-joins with users/queues/calls,
 * and keeps backups + cross-tenant safety in line with everything
 * else.
 *
 * Old Firestore tickets are NOT migrated — per product call, they
 * are no longer needed; the Firestore collection will be wiped in
 * a follow-up PR after the editor cuts over to MariaDB reads.
 *
 * Dedup invariant: at most ONE open ticket per (org_id, caller_number)
 * where caller_number is normalised to the trailing 10 digits.
 * Repeat calls increment `missed_count` and re-evaluate `priority`
 * (≥1 normal / ≥2 high / ≥3 urgent). Once a ticket is `closed`,
 * a fresh call from the same caller starts a brand-new ticket
 * (per product decision — closed = done; new call is a new case).
 *
 * Status flow:  open → in_progress → closed → archived → deleted
 *   - operator drives open/in_progress/closed via editor
 *   - archived = automatic, lazy, on tickets-page load when
 *     closed_at < NOW() − 1 DAY
 *   - delete = automatic, lazy, when archived_at < NOW() − 30 DAY
 *   No scheduler — both transitions run as part of the GET handler.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tickets', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      org_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        comment: 'Org-scope — every query is filtered by this',
      },
      caller_number: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'Last-10-digit canonical form for dedup matching',
      },
      caller_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Resolved at create time (user.full_name or caller_id_name); snapshot, not joined',
      },
      source: {
        type: Sequelize.ENUM('missed_call', 'queue_timeout', 'bot_dropped', 'manual'),
        allowNull: false,
        defaultValue: 'missed_call',
        comment: 'How the ticket was classified: NO_ANSWER inbound, ANSWERED-but-not-bridged, bot drop, or operator-created',
      },
      priority: {
        type: Sequelize.ENUM('normal', 'high', 'urgent'),
        allowNull: false,
        defaultValue: 'normal',
        comment: '≥1 missed_count → normal, ≥2 → high, ≥3 → urgent',
      },
      status: {
        type: Sequelize.ENUM('open', 'in_progress', 'closed', 'archived'),
        allowNull: false,
        defaultValue: 'open',
      },
      missed_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'Number of missed calls aggregated into this ticket via dedup',
      },
      last_call_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
        comment: 'Asterisk uniqueid of the most recent call that updated this ticket',
      },
      last_call_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Most recent call timestamp; drives sort and 24h archive window',
      },
      closed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Set when operator moves status → closed. 24h after this, lazy sweep moves to archived',
      },
      archived_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: '30 days after this, lazy sweep permanently deletes the row',
      },
      assignee_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'Which operator is working on this — optional',
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      tags: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Free-form array of labels for filtering (no schema enforcement v1)',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    // Indexes — picked to make the four hot queries fast:
    //   1. Editor's tickets page list (org + status + recency)
    //   2. Dedup lookup on incoming CDR (org + caller + open-status)
    //   3. Archive sweep (org + closed_at when status=closed)
    //   4. Delete sweep (org + archived_at when status=archived)
    //
    // No FK index on org_id needed (composite indexes already cover it,
    // and MariaDB 11 FK auto-creates one). Same for assignee_user_id —
    // FK auto-index avoids the migration-1061 gotcha from memory.
    await queryInterface.addIndex('tickets', ['org_id', 'status', 'last_call_at'], {
      name: 'idx_tickets_org_status_recent',
    });
    await queryInterface.addIndex('tickets', ['org_id', 'caller_number', 'status'], {
      name: 'idx_tickets_org_caller_status',
    });
    await queryInterface.addIndex('tickets', ['org_id', 'closed_at'], {
      name: 'idx_tickets_archive_sweep',
    });
    await queryInterface.addIndex('tickets', ['org_id', 'archived_at'], {
      name: 'idx_tickets_delete_sweep',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('tickets');
  },
};
