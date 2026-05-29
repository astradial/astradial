'use strict';

/**
 * tunnel_metrics — time-series snapshots of wg1 peer state.
 *
 * Written by the wireguardStatusPoller in astrapbx (every 60s by default).
 * Read by GET /api/v1/customer-tunnels/:id/metrics for the UI charts.
 *
 * Schema choices:
 *   - tunnel_id is the FK to customer_tunnels; CASCADE delete (a deleted
 *     tunnel's history is gone).
 *   - latest_handshake_at is NULL when the peer has never handshaken
 *     (e.g., customer just configured but hasn't connected yet).
 *   - endpoint_ip captures the public IP wg sees for the peer at snapshot
 *     time. Useful for detecting CGNAT rotations.
 *   - bytes_received / bytes_sent are CUMULATIVE counters from wg itself;
 *     UI computes deltas when plotting throughput.
 *   - peer_count_total is per-snapshot count of all peers in wg1 (not just
 *     this peer) — gives a global view of the interface.
 *
 * No explicit addIndex on tunnel_id — FK auto-creates one on MariaDB 11
 * (per the lesson learned in PR #126).
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('tunnel_metrics', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      tunnel_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'customer_tunnels', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        comment: 'FK to customer_tunnels; cascades on delete'
      },
      snapshot_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
        comment: 'When the poller captured this row'
      },
      latest_handshake_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Most recent successful handshake (NULL if peer never handshaken)'
      },
      endpoint_ip: {
        type: Sequelize.STRING(45),
        allowNull: true,
        comment: 'Public IP wg sees for the peer (IPv4 or IPv6)'
      },
      endpoint_port: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Public port wg sees for the peer'
      },
      bytes_received: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
        comment: 'Cumulative bytes received by us from peer'
      },
      bytes_sent: {
        type: Sequelize.BIGINT,
        allowNull: false,
        defaultValue: 0,
        comment: 'Cumulative bytes sent by us to peer'
      },
      peer_count_total: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Total active peers in wg1 at snapshot time (global view)'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Time-series query index: (tunnel_id, snapshot_at) for charts
    await queryInterface.addIndex('tunnel_metrics', ['tunnel_id', 'snapshot_at'], {
      name: 'tunnel_metrics_tunnel_snapshot'
    });

    // For aging out old rows
    await queryInterface.addIndex('tunnel_metrics', ['snapshot_at'], {
      name: 'tunnel_metrics_snapshot_at'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('tunnel_metrics');
  }
};
