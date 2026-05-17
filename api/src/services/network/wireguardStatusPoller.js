/**
 * Periodic poller: every N seconds, run `wg show wg1 dump`, parse the
 * output, match peers to customer_tunnels by public key, and INSERT one
 * tunnel_metrics row per active tunnel.
 *
 * Drives the metrics chart in the UI. Designed to be cheap (one shell call
 * per cycle, no per-tunnel exec) and idempotent (each row is independent
 * — partial failures don't poison subsequent cycles).
 *
 * Lifecycle:
 *   - start({ models, intervalMs }) — kicks off setInterval
 *   - stop() — clearInterval (for graceful shutdown)
 *
 * Used by server.js at startup to begin polling once astrapbx is ready.
 *
 * Error policy:
 *   - Exec or DB errors are CAUGHT and logged. We do NOT crash the process
 *     just because wg show failed once (e.g., wg1 not bootstrapped yet).
 *   - A circuit-breaker-ish pattern: after N consecutive failures, the
 *     poller logs more loudly but keeps running (so it auto-recovers when
 *     wg1 comes up).
 */

'use strict';

const { getDumpedInterface, buildTunnelStatus } = require('./wireguardStatusService');

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_INTERFACE = 'wg1';
const NOISY_AFTER_N_FAILURES = 5; // log loudly after this many consecutive errors

// Retention (audit finding P1 #6): delete tunnel_metrics rows older than this
// many days. Runs at most once per RETENTION_PRUNE_INTERVAL_MS to keep
// per-cycle cost low. 90 days × 1440 rows/day × N tunnels ≈ bounded growth.
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_RETENTION_PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

class WireguardStatusPoller {
  /**
   * @param {object} opts
   * @param {object} opts.models - Sequelize models registry (CustomerTunnel, TunnelMetric)
   * @param {number} [opts.intervalMs]
   * @param {string} [opts.interfaceName]
   * @param {object} [opts.io] - injection point for status service's exec
   * @param {Function} [opts.onError] - error sink (default: console.error)
   * @param {Function} [opts.nowFn] - injectable clock
   */
  constructor({
    models,
    intervalMs = DEFAULT_INTERVAL_MS,
    interfaceName = DEFAULT_INTERFACE,
    retentionDays = DEFAULT_RETENTION_DAYS,
    retentionPruneIntervalMs = DEFAULT_RETENTION_PRUNE_INTERVAL_MS,
    io,
    onError = (err) => console.error('[wg-poller]', err.message),
    nowFn = () => new Date()
  } = {}) {
    if (!models) throw new Error('WireguardStatusPoller: { models } required');
    this.models = models;
    this.intervalMs = intervalMs;
    this.interfaceName = interfaceName;
    this.retentionDays = retentionDays;
    this.retentionPruneIntervalMs = retentionPruneIntervalMs;
    this.io = io;
    this.onError = onError;
    this.nowFn = nowFn;
    this._timer = null;
    this._inFlight = false;
    this._consecutiveFailures = 0;
    this._lastSuccessAt = null;
    this._totalSnapshots = 0;
    this._lastPruneAt = null;
    this._totalPruned = 0;
  }

  start() {
    if (this._timer) return; // already running — idempotent
    // Fire once immediately, then schedule
    this._tick().catch((err) => this.onError(err));
    this._timer = setInterval(() => {
      this._tick().catch((err) => this.onError(err));
    }, this.intervalMs);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Returns observability counters — handy for /health endpoint integration.
   */
  getStatus() {
    return {
      running: this._timer !== null,
      interval_ms: this.intervalMs,
      interface_name: this.interfaceName,
      last_success_at: this._lastSuccessAt,
      consecutive_failures: this._consecutiveFailures,
      total_snapshots_written: this._totalSnapshots,
      retention_days: this.retentionDays,
      last_prune_at: this._lastPruneAt,
      total_pruned: this._totalPruned
    };
  }

  /**
   * Delete tunnel_metrics rows older than retentionDays. Returns the number
   * of rows deleted. Throttled to once per retentionPruneIntervalMs — most
   * _tick cycles skip the prune entirely.
   */
  async _maybePrune() {
    const now = this.nowFn();
    if (this._lastPruneAt && (now - this._lastPruneAt) < this.retentionPruneIntervalMs) {
      return { pruned: 0, skipped: true };
    }
    const cutoff = new Date(now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000);
    try {
      const { TunnelMetric } = this.models;
      const Sequelize = TunnelMetric.sequelize.constructor;
      const deleted = await TunnelMetric.destroy({
        where: { snapshot_at: { [Sequelize.Op.lt]: cutoff } }
      });
      this._lastPruneAt = now;
      this._totalPruned += deleted;
      if (deleted > 0) {
        console.log(`[wg-poller] pruned ${deleted} tunnel_metrics rows older than ${cutoff.toISOString()}`);
      }
      return { pruned: deleted, skipped: false };
    } catch (err) {
      this.onError(new Error(`tunnel_metrics prune failed: ${err.message}`));
      return { pruned: 0, skipped: false, error: err.message };
    }
  }

  /**
   * Internal — one polling cycle. Returns { written } on success.
   */
  async _tick() {
    if (this._inFlight) {
      // Skip overlapping cycles (e.g., interval is faster than exec+DB latency)
      return { written: 0, skipped: true };
    }
    this._inFlight = true;
    try {
      const { CustomerTunnel, TunnelMetric } = this.models;

      // Get parsed wg output ONCE for all tunnels
      const parsed = await getDumpedInterface({
        interfaceName: this.interfaceName,
        io: this.io
      });

      // Get all active tunnels from DB
      const tunnels = await CustomerTunnel.findAll({
        where: { status: 'active' },
        attributes: ['id', 'customer_pubkey']
      });

      // For each, compute a status and INSERT a metrics row
      let written = 0;
      const snapshotAt = this.nowFn();
      for (const tunnel of tunnels) {
        try {
          const status = buildTunnelStatus(tunnel, parsed, { nowFn: this.nowFn });
          await TunnelMetric.create({
            tunnel_id: tunnel.id,
            snapshot_at: snapshotAt,
            latest_handshake_at: status.latest_handshake_at
              ? new Date(status.latest_handshake_at)
              : null,
            endpoint_ip: status.endpoint_ip,
            endpoint_port: status.endpoint_port,
            bytes_received: status.bytes_received,
            bytes_sent: status.bytes_sent,
            peer_count_total: parsed.peer_count
          });
          written++;
        } catch (perTunnelErr) {
          // Don't let one bad row kill the whole cycle
          this.onError(new Error(`tunnel ${tunnel.id} snapshot failed: ${perTunnelErr.message}`));
        }
      }

      this._consecutiveFailures = 0;
      this._lastSuccessAt = snapshotAt;
      this._totalSnapshots += written;

      // Retention: run at most once per hour. Errors are logged but don't
      // fail the tick (snapshots writing is more important than pruning).
      await this._maybePrune();

      return { written, skipped: false };
    } catch (err) {
      this._consecutiveFailures++;
      const noisy = this._consecutiveFailures >= NOISY_AFTER_N_FAILURES;
      const prefix = noisy ? `[wg-poller LOUD: ${this._consecutiveFailures} consec failures]` : '[wg-poller]';
      this.onError(new Error(`${prefix} cycle failed: ${err.message}`));
      throw err; // re-throw for caller's catch (immediate firing only)
    } finally {
      this._inFlight = false;
    }
  }
}

module.exports = {
  WireguardStatusPoller,
  DEFAULT_INTERVAL_MS,
  DEFAULT_INTERFACE,
  NOISY_AFTER_N_FAILURES
};
