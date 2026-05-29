/**
 * PJSIP user-endpoint registration status service.
 *
 * Asks Asterisk via `pjsip show contacts` which user endpoints are
 * currently registered, parses the positional text output, and exposes
 * a Map keyed by endpoint name (e.g. `org_demo__09`) with the
 * registration details. The result is cached for a short TTL so a page-
 * load with N users doesn't generate N CLI calls — one call serves all.
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Why a separate service (vs. extending cliService.js)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  cliService runs `asterisk -rx` via direct `exec` import — that makes
 *  it impossible to mock for unit tests. This service accepts an `io`
 *  bundle (same dependency-injection pattern as wireguardApplier and
 *  wireguardStatusService) so tests can pass a stub that returns canned
 *  output. Production callers use the default IO which delegates to
 *  child_process.exec via util.promisify.
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Output format we're parsing (positional, whitespace-aligned)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  `pjsip show contacts` output looks roughly like:
 *
 *    Contact:  <aor>/<contact-uri> <hash> <Avail|Unavail|NonQual> <rtt|-nan>
 *
 *  Real example from prod (V7 Reception extension 09, active call):
 *
 *    Contact:  org_demo__09/sip:09@192.168.0.76:40314 fcd699215a Avail   171.789
 *
 *  We extract:
 *    - aor = "org_demo__09"
 *    - contact_uri = "sip:09@192.168.0.76:40314"
 *    - contact_ip  = "192.168.0.76"
 *    - contact_port = 40314
 *    - status (Avail/Unavail/NonQual)
 *    - rtt_ms (number or null if `-nan`)
 *
 *  An endpoint with NO active registration won't appear in the output —
 *  callers (route handler) should treat absence as "not registered".
 */

'use strict';

const { exec: nodeExec } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(nodeExec);

const DEFAULT_EXEC_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 30_000;

const DEFAULT_IO = Object.freeze({
  exec: execAsync,
  now: () => Date.now()
});

// Regex anchored to the positional `pjsip show contacts` format. Same
// shape used by cliService.getAllTrunkStatuses but the AOR portion here
// is intentionally lax (user endpoint names contain `__` and digits).
const CONTACT_LINE_REGEX =
  /^\s*Contact:\s+([^\/\s]+)\/([^\s]+)\s+\S+\s+(Avail|Unavail|NonQual)\s+(\S+)/;

// IP+port extraction from a SIP contact URI of the shape:
//   sip:<user>@<host>:<port>[;params...]
//   sip:<user>@<host>[;params...]  (default port — we treat as 5060)
const CONTACT_URI_HOST_PORT_REGEX = /^sip:[^@]+@([^:;\s]+)(?::(\d+))?/;

/**
 * Parse one Contact line. Returns null if the line doesn't match.
 *
 * @param {string} line
 * @returns {{ aor: string, contact_uri: string, contact_ip: string|null, contact_port: number|null, status: string, rtt_ms: number|null } | null}
 */
function parseContactLine(line) {
  const m = CONTACT_LINE_REGEX.exec(line);
  if (!m) return null;
  const [, aor, contactUri, statusRaw, rttRaw] = m;
  const STATUS_MAP = { Avail: 'reachable', Unavail: 'unreachable', NonQual: 'nonqual' };
  const status = STATUS_MAP[statusRaw] || 'unknown';
  const rttFloat = parseFloat(rttRaw);
  const rtt_ms = Number.isFinite(rttFloat) ? rttFloat : null;
  let contact_ip = null;
  let contact_port = null;
  const u = CONTACT_URI_HOST_PORT_REGEX.exec(contactUri);
  if (u) {
    contact_ip = u[1];
    contact_port = u[2] ? Number(u[2]) : 5060;
  }
  return { aor, contact_uri: contactUri, contact_ip, contact_port, status, rtt_ms };
}

/**
 * Parse the full `pjsip show contacts` stdout into a Map keyed by AOR.
 *
 * If the same AOR has multiple contacts (e.g., a phone registered from
 * both LAN and WAN), we keep the FIRST reachable one — operators care
 * about "is this user reachable?" more than the exact set of contacts.
 *
 * @param {string} stdout
 * @returns {Map<string, ReturnType<typeof parseContactLine>>}
 */
function parseAllContacts(stdout) {
  const map = new Map();
  if (!stdout) return map;
  for (const rawLine of stdout.split('\n')) {
    const parsed = parseContactLine(rawLine);
    if (!parsed) continue;
    const existing = map.get(parsed.aor);
    if (!existing) {
      map.set(parsed.aor, parsed);
      continue;
    }
    // Prefer reachable over non-reachable; otherwise keep the first.
    if (parsed.status === 'reachable' && existing.status !== 'reachable') {
      map.set(parsed.aor, parsed);
    }
  }
  return map;
}

/**
 * Cache wrapper. Stores the most recent successful Map + the timestamp
 * it was fetched. Returns the cached Map if fresh; otherwise re-fetches.
 *
 * Module-scoped (singleton) so all callers in this process share the cache.
 * Safe because the cache is read-only by callers — they iterate it but
 * don't mutate. A new fetch replaces the reference atomically.
 */
let _cache = {
  map: null,    // Map<string, ContactInfo> | null
  fetchedAt: 0  // milliseconds since epoch
};

/**
 * Fetch the registration Map for all PJSIP user endpoints, using the
 * cache if it's fresh (within `cacheTtlMs` of the last fetch).
 *
 * `force: true` bypasses the cache (useful for an explicit refresh action
 * from the operator).
 *
 * @param {object} [opts]
 * @param {number} [opts.cacheTtlMs=DEFAULT_CACHE_TTL_MS]
 * @param {number} [opts.execTimeoutMs=DEFAULT_EXEC_TIMEOUT_MS]
 * @param {boolean} [opts.force=false]
 * @param {object} [opts.io=DEFAULT_IO]
 * @returns {Promise<{ map: Map<string, object>, fetchedAt: number, fromCache: boolean }>}
 */
async function getAllUserRegistrations({
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  execTimeoutMs = DEFAULT_EXEC_TIMEOUT_MS,
  force = false,
  io = DEFAULT_IO
} = {}) {
  const now = io.now();
  if (!force && _cache.map && (now - _cache.fetchedAt) < cacheTtlMs) {
    return { map: _cache.map, fetchedAt: _cache.fetchedAt, fromCache: true };
  }
  const { stdout } = await io.exec('asterisk -rx "pjsip show contacts"', {
    timeout: execTimeoutMs
  });
  const map = parseAllContacts(stdout || '');
  _cache = { map, fetchedAt: now };
  return { map, fetchedAt: now, fromCache: false };
}

/**
 * Clear the cache. Used by tests to ensure isolation; can be called from
 * production code if an operator-triggered "refresh" needs to bypass the
 * normal TTL.
 */
function clearCache() {
  _cache = { map: null, fetchedAt: 0 };
}

/**
 * Test-only inspection of the current cache state.
 *
 * @returns {{ hasMap: boolean, size: number, fetchedAt: number }}
 */
function inspectCache() {
  return {
    hasMap: _cache.map !== null,
    size: _cache.map ? _cache.map.size : 0,
    fetchedAt: _cache.fetchedAt
  };
}

module.exports = {
  // Constants
  DEFAULT_EXEC_TIMEOUT_MS,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_IO,
  CONTACT_LINE_REGEX,
  CONTACT_URI_HOST_PORT_REGEX,
  // Pure functions (testable in isolation)
  parseContactLine,
  parseAllContacts,
  // Top-level
  getAllUserRegistrations,
  clearCache,
  inspectCache
};
