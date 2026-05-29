/**
 * WireGuard status service.
 *
 * Runs `wg show <iface> dump`, parses the output, and joins each peer to
 * its corresponding `customer_tunnels` row (by public key match) — giving
 * the API a per-tunnel live status without exposing the raw wg-dump format
 * to callers.
 *
 * Used by:
 *   - GET /api/v1/customer-tunnels/:id/status   (live status of one tunnel)
 *   - wireguardStatusPoller (writes snapshots to tunnel_metrics)
 *
 * Dependency injection:
 *   `io.exec` for the shell call (tests stub it). Defaults to
 *   util.promisify(child_process.exec) — same pattern as wireguardApplier.
 */

'use strict';

const { exec: nodeExec } = require('node:child_process');
const { promisify } = require('node:util');
const {
  parseWgShowDump,
  findPeerByPubkey,
  handshakeAgeSeconds,
  isPeerAlive
} = require('./wireguardStatusParser');
const { assertValidInterfaceName } = require('./wireguardCommon');

const execAsync = promisify(nodeExec);

const DEFAULT_INTERFACE = 'wg1';
const DEFAULT_EXEC_TIMEOUT_MS = 10_000; // wg show dump is cheap — 10s is plenty

const DEFAULT_IO = Object.freeze({
  exec: execAsync
});

/**
 * Run `wg show <iface> dump` and return the parsed structure.
 *
 * @param {object} opts
 * @param {string} [opts.interfaceName='wg1']
 * @param {number} [opts.timeoutMs]
 * @param {object} [opts.io]
 * @returns {Promise<ReturnType<typeof parseWgShowDump>>}
 */
async function getDumpedInterface({
  interfaceName = DEFAULT_INTERFACE,
  timeoutMs = DEFAULT_EXEC_TIMEOUT_MS,
  io = DEFAULT_IO
} = {}) {
  assertValidInterfaceName(interfaceName);
  const { stdout } = await io.exec(`wg show ${interfaceName} dump`, { timeout: timeoutMs });
  return parseWgShowDump(stdout);
}

/**
 * Per-tunnel live status: takes a customer_tunnels row + the parsed dump,
 * returns a JSON-friendly status object the API can return directly.
 *
 * Pure function — no DB, no exec. Caller supplies the dump from
 * getDumpedInterface() so they can compute statuses for many tunnels from
 * one dump call.
 *
 * @param {object} tunnel - customer_tunnels row (must include customer_pubkey)
 * @param {object} parsedDump - output of parseWgShowDump
 * @param {object} [opts]
 * @param {Function} [opts.nowFn] - injectable clock for tests
 * @param {number} [opts.aliveWindowSeconds=180]
 * @returns {{
 *   tunnel_id: string,
 *   alive: boolean,
 *   present_in_wg: boolean,
 *   handshake_age_seconds: number | null,
 *   latest_handshake_at: string | null,   // ISO
 *   endpoint_ip: string | null,
 *   endpoint_port: number | null,
 *   bytes_received: number,
 *   bytes_sent: number,
 *   allowed_ips: string[]
 * }}
 */
function buildTunnelStatus(tunnel, parsedDump, opts = {}) {
  const nowFn = opts.nowFn || (() => new Date());
  const aliveWindowSeconds = opts.aliveWindowSeconds || 180;

  if (!tunnel || !tunnel.customer_pubkey) {
    throw new Error('buildTunnelStatus: tunnel.customer_pubkey is required');
  }

  const peer = findPeerByPubkey(parsedDump, tunnel.customer_pubkey);

  if (!peer) {
    return {
      tunnel_id: tunnel.id,
      alive: false,
      present_in_wg: false,
      handshake_age_seconds: null,
      latest_handshake_at: null,
      endpoint_ip: null,
      endpoint_port: null,
      bytes_received: 0,
      bytes_sent: 0,
      allowed_ips: []
    };
  }

  return {
    tunnel_id: tunnel.id,
    alive: isPeerAlive(peer, aliveWindowSeconds, nowFn),
    present_in_wg: true,
    handshake_age_seconds: handshakeAgeSeconds(peer, nowFn),
    latest_handshake_at: peer.latest_handshake_at?.toISOString() || null,
    endpoint_ip: peer.endpoint_ip,
    endpoint_port: peer.endpoint_port,
    bytes_received: peer.bytes_received,
    bytes_sent: peer.bytes_sent,
    allowed_ips: peer.allowed_ips
  };
}

/**
 * High-level: get live status for one tunnel by querying wg and matching
 * by public key.
 *
 * @param {object} opts
 * @param {object} opts.tunnel - customer_tunnels row
 * @param {string} [opts.interfaceName]
 * @param {object} [opts.io]
 * @param {object} [opts.statusOpts] - passed to buildTunnelStatus
 * @returns {Promise<ReturnType<typeof buildTunnelStatus>>}
 */
async function getTunnelStatus({ tunnel, interfaceName, io, statusOpts } = {}) {
  if (!tunnel) throw new Error('getTunnelStatus: tunnel is required');
  const parsed = await getDumpedInterface({ interfaceName, io });
  return buildTunnelStatus(tunnel, parsed, statusOpts);
}

/**
 * High-level: get live status for many tunnels with a single wg-show call.
 *
 * @param {object} opts
 * @param {object[]} opts.tunnels - array of customer_tunnels rows
 * @param {string} [opts.interfaceName]
 * @param {object} [opts.io]
 * @param {object} [opts.statusOpts]
 * @returns {Promise<{ statuses: Array<ReturnType<typeof buildTunnelStatus>>, peer_count: number }>}
 */
async function getStatusForTunnels({ tunnels, interfaceName, io, statusOpts } = {}) {
  if (!Array.isArray(tunnels)) throw new Error('getStatusForTunnels: tunnels must be an array');
  const parsed = await getDumpedInterface({ interfaceName, io });
  const statuses = tunnels.map((t) => buildTunnelStatus(t, parsed, statusOpts));
  return { statuses, peer_count: parsed.peer_count };
}

module.exports = {
  DEFAULT_INTERFACE,
  DEFAULT_EXEC_TIMEOUT_MS,
  DEFAULT_IO,
  assertValidInterfaceName,
  getDumpedInterface,
  buildTunnelStatus,
  getTunnelStatus,
  getStatusForTunnels
};
