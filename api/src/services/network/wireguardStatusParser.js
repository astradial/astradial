/**
 * Parser for `wg show <interface> dump` output.
 *
 * The `dump` subcommand of wg produces tab-separated lines, one per peer,
 * preceded by a single line for the interface itself. The format is stable
 * across wireguard-tools versions back to ~1.0 and is documented in the
 * wg(8) manpage.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Output shape (real example from a healthy peer):
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Line 0 (interface):
 *    private_key  public_key  listen_port  fwmark
 *    iKQAH...=    mBYga...=   51820        off
 *
 *  Line 1..N (one per peer):
 *    public_key  preshared_key  endpoint                allowed_ips
 *      latest_handshake  transfer_rx  transfer_tx  persistent_keepalive
 *
 *  Example peer line:
 *    oRoJ+EEsYGF...=  (none)  49.207.232.227:37309  10.10.10.2/32
 *      1715520600  1234567890  987654321  off
 *
 *  Field semantics:
 *    - preshared_key:        "(none)" when not set; else 44-char base64
 *    - endpoint:             "host:port" — host is IPv4 or [IPv6]; "(none)"
 *                            when peer has not been contacted yet
 *    - allowed_ips:          comma-separated CIDRs (or "(none)")
 *    - latest_handshake:     unix timestamp (seconds); 0 if no handshake yet
 *    - transfer_rx/tx:       cumulative byte counters
 *    - persistent_keepalive: integer seconds, or "off"
 *
 *  Lines are TAB-separated (\t). Fields can contain spaces (e.g.,
 *  "(none)" or comma-separated allowed_ips), so split on \t only.
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Why pure?
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  This module does no I/O. It accepts the dump output as a string and
 *  returns a structured object. The caller (wireguardStatusService) runs
 *  the actual `wg show` command. This split lets us test the parser
 *  against many synthetic outputs (real captures, malformed lines,
 *  edge cases) without needing a wireguard interface.
 */

'use strict';

/**
 * Parse the output of `wg show <iface> dump`.
 *
 * @param {string} dumpText - exact stdout of `wg show <iface> dump`
 * @returns {{
 *   interface: {
 *     private_key_present: boolean,    // we don't expose the key itself
 *     public_key: string,
 *     listen_port: number | null,
 *     fwmark: string                    // "off" or a hex/decimal mark
 *   },
 *   peers: Array<{
 *     public_key: string,
 *     preshared_key_present: boolean,   // boolean, not the key
 *     endpoint_ip: string | null,       // null if "(none)"
 *     endpoint_port: number | null,
 *     allowed_ips: string[],            // empty array if "(none)"
 *     latest_handshake_at: Date | null, // null if 0
 *     bytes_received: number,
 *     bytes_sent: number,
 *     persistent_keepalive: number | null  // null if "off"
 *   }>,
 *   peer_count: number
 * }}
 */
function parseWgShowDump(dumpText) {
  if (typeof dumpText !== 'string') {
    throw new TypeError('parseWgShowDump: dumpText must be a string');
  }

  // Split on any line terminator; ignore blank lines + leading/trailing whitespace
  const lines = dumpText.split(/\r?\n/).map((l) => l).filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error('parseWgShowDump: empty input (no lines)');
  }

  // First line is the interface
  const iface = parseInterfaceLine(lines[0]);

  // Remaining lines are peers
  const peers = [];
  for (let i = 1; i < lines.length; i++) {
    peers.push(parsePeerLine(lines[i], i));
  }

  return {
    interface: iface,
    peers,
    peer_count: peers.length
  };
}

/**
 * Parse the first line of `wg show dump` (the interface).
 *
 * Format: private_key \t public_key \t listen_port \t fwmark
 */
function parseInterfaceLine(line) {
  const parts = line.split('\t');
  if (parts.length < 4) {
    throw new Error(
      `parseInterfaceLine: expected 4 tab-separated fields, got ${parts.length} from line: ${JSON.stringify(line.slice(0, 100))}`
    );
  }
  return {
    private_key_present: parts[0] !== '(none)' && parts[0].length > 0,
    public_key: parts[1],
    listen_port: parsePortField(parts[2]),
    fwmark: parts[3]
  };
}

/**
 * Parse a peer line.
 *
 * Format: pubkey \t psk \t endpoint \t allowed_ips \t latest_handshake \t rx \t tx \t persistent_keepalive
 */
function parsePeerLine(line, lineNumber) {
  const parts = line.split('\t');
  if (parts.length < 8) {
    throw new Error(
      `parsePeerLine (line ${lineNumber}): expected 8 tab-separated fields, got ${parts.length} from line: ${JSON.stringify(line.slice(0, 100))}`
    );
  }

  const [pubkey, psk, endpoint, allowedIps, handshake, rx, tx, keepalive] = parts;

  return {
    public_key: pubkey,
    preshared_key_present: psk !== '(none)' && psk.length > 0,
    ...parseEndpointField(endpoint),
    allowed_ips: parseAllowedIpsField(allowedIps),
    latest_handshake_at: parseHandshakeField(handshake),
    bytes_received: parseUnsignedInt(rx, `bytes_received (line ${lineNumber})`),
    bytes_sent: parseUnsignedInt(tx, `bytes_sent (line ${lineNumber})`),
    persistent_keepalive: parseKeepaliveField(keepalive)
  };
}

/**
 * Parse the endpoint field: "host:port", "[ipv6]:port", or "(none)".
 *
 * Returns { endpoint_ip, endpoint_port } with null values for "(none)".
 */
function parseEndpointField(endpoint) {
  if (endpoint === '(none)' || !endpoint) {
    return { endpoint_ip: null, endpoint_port: null };
  }

  // IPv6 form: "[2001:db8::1]:51820"
  const v6Match = /^\[([^\]]+)\]:(\d+)$/.exec(endpoint);
  if (v6Match) {
    return {
      endpoint_ip: v6Match[1],
      endpoint_port: parsePortField(v6Match[2])
    };
  }

  // IPv4 form: "1.2.3.4:51820"
  const lastColon = endpoint.lastIndexOf(':');
  if (lastColon < 0) {
    // Malformed but we don't fail — preserve what we have
    return { endpoint_ip: endpoint, endpoint_port: null };
  }
  return {
    endpoint_ip: endpoint.slice(0, lastColon),
    endpoint_port: parsePortField(endpoint.slice(lastColon + 1))
  };
}

/**
 * Parse comma-separated allowed_ips. "(none)" → []. Empty → [].
 */
function parseAllowedIpsField(allowedIps) {
  if (!allowedIps || allowedIps === '(none)') return [];
  return allowedIps.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Parse the latest_handshake unix timestamp.
 * 0 means "no handshake yet" → null. Negative → null. Else Date.
 */
function parseHandshakeField(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

/**
 * Parse a port number. Returns null on "(none)", empty, or invalid.
 */
function parsePortField(value) {
  if (value === '(none)' || !value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) return null;
  return n;
}

/**
 * Parse persistent_keepalive: integer or "off".
 */
function parseKeepaliveField(value) {
  if (value === 'off' || !value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * Parse an unsigned integer. Throws on negative or non-numeric — these
 * should never appear in well-formed wg output, so a strict failure
 * tells us the format changed (or input was corrupted).
 */
function parseUnsignedInt(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`parseUnsignedInt[${label}]: invalid value ${JSON.stringify(value)}`);
  }
  // Use Math.trunc — wg output for bytes is always integer but allow
  // future-proofing for any decimal contamination
  return Math.trunc(n);
}

/**
 * Convenience: given a parsed dump and a customer's public key, return
 * just that peer (or null if not present).
 */
function findPeerByPubkey(parsed, customerPubkey) {
  if (!parsed || !Array.isArray(parsed.peers)) return null;
  if (!customerPubkey || typeof customerPubkey !== 'string') return null;
  return parsed.peers.find((p) => p.public_key === customerPubkey) || null;
}

/**
 * Convenience: compute handshake age in seconds (Date.now-based).
 * Returns null if no handshake.
 *
 * `nowFn` is injectable so tests can be deterministic.
 */
function handshakeAgeSeconds(peer, nowFn = () => new Date()) {
  if (!peer || !peer.latest_handshake_at) return null;
  const now = nowFn();
  const diffMs = now.getTime() - peer.latest_handshake_at.getTime();
  return Math.floor(diffMs / 1000);
}

/**
 * Heuristic: is a peer considered "alive"? A peer is alive if it had a
 * handshake within the last `windowSeconds` (default 180s — 3 minutes,
 * which is plenty for standard 25s keepalive intervals).
 */
function isPeerAlive(peer, windowSeconds = 180, nowFn = () => new Date()) {
  const age = handshakeAgeSeconds(peer, nowFn);
  if (age === null) return false;
  return age <= windowSeconds;
}

module.exports = {
  parseWgShowDump,
  // Internal helpers exposed for fine-grained tests
  parseInterfaceLine,
  parsePeerLine,
  parseEndpointField,
  parseAllowedIpsField,
  parseHandshakeField,
  parsePortField,
  parseKeepaliveField,
  parseUnsignedInt,
  // Convenience helpers
  findPeerByPubkey,
  handshakeAgeSeconds,
  isPeerAlive
};
