/**
 * Pure helpers for the customer-tunnels route — extracted into a separate
 * module so the test file can load them WITHOUT triggering the route's
 * top-level `require('../models')` (which initializes Sequelize and needs
 * a configured .env to load).
 *
 * Anything here must be testable in isolation: no DB, no fs, no exec.
 */

'use strict';

const crypto = require('node:crypto');

const TUNNEL_NAME_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;
const WG_KEY_REGEX = /^[A-Za-z0-9+/]{43}=$/;
const SUBNET_ALLOC_RETRIES = 3;

// IPv4 CIDR loose-form validator. Semantic checks happen below.
const IPV4_CIDR_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

// CIDRs we will NEVER let a customer claim as their LAN. Any overlap with
// these means the tunnel would route traffic that we use for infra OR for
// the customer tunnel pool itself — both lead to broken routing.
//
// Frozen so accidental .push() at runtime throws.
const RESERVED_INFRA_CIDRS = Object.freeze([
  '10.10.10.0/24',   // wg0 — internal infra (NUC + staging peers)
  '10.20.0.0/16',    // wg1 — customer tunnel pool
  '172.17.0.0/16',   // docker0 default bridge
  '172.18.0.0/16',   // docker custom bridge (vaultwarden)
  '127.0.0.0/8'      // loopback
]);

// Customers must declare their LAN as RFC 1918 private space. Public-range
// LANs are rejected — they'd hijack public-internet routing in unpredictable
// ways and there's no legitimate operator reason to allow them.
const PRIVATE_PARENT_CIDRS = Object.freeze([
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16'
]);

// Max LAN size — /16 (65k hosts). Larger LANs are suspicious AND increase
// the surface area for accidental cross-customer overlap. Customers with
// genuinely larger networks can request multiple tunnels.
const MIN_CUSTOMER_LAN_PREFIX = 16;
const MAX_CUSTOMER_LAN_PREFIX = 30;

/**
 * Generate a base64-encoded 32-byte pre-shared key.
 * Matches WireGuard's 44-char base64 format.
 */
function generatePsk() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Parse an IPv4 CIDR into a numeric { network: uint32, prefix: number }
 * for set-arithmetic. Throws on invalid input.
 *
 * Network address is computed by zeroing host bits — so the user can pass
 * "192.168.0.5/24" and we treat it as 192.168.0.0/24.
 *
 * @param {string} cidr
 * @returns {{ network: number, prefix: number }}
 */
function parseCidr(cidr) {
  if (typeof cidr !== 'string') {
    throw new Error(`parseCidr: expected string, got ${typeof cidr}`);
  }
  const m = IPV4_CIDR_REGEX.exec(cidr);
  if (!m) {
    throw new Error(`parseCidr: "${cidr}" is not a valid IPv4 CIDR`);
  }
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const prefix = Number(m[5]);
  for (const o of octets) {
    if (o < 0 || o > 255) {
      throw new Error(`parseCidr: octet out of range in "${cidr}"`);
    }
  }
  if (prefix < 0 || prefix > 32) {
    throw new Error(`parseCidr: prefix /${prefix} out of range in "${cidr}"`);
  }
  // Convert to uint32. Using >>> 0 to keep it unsigned.
  const ipUint = (
    (octets[0] << 24) |
    (octets[1] << 16) |
    (octets[2] << 8) |
    octets[3]
  ) >>> 0;
  // Mask off host bits so the result is the network address.
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const network = (ipUint & mask) >>> 0;
  return { network, prefix };
}

/**
 * Convert a parsed { network, prefix } back to a canonical CIDR string.
 *
 * @param {{ network: number, prefix: number }} parsed
 * @returns {string}
 */
function formatCidr({ network, prefix }) {
  const octets = [
    (network >>> 24) & 0xFF,
    (network >>> 16) & 0xFF,
    (network >>> 8) & 0xFF,
    network & 0xFF
  ];
  return `${octets.join('.')}/${prefix}`;
}

/**
 * Normalize a CIDR by zeroing host bits. So "10.5.1.5/16" becomes
 * "10.5.0.0/16". Required before persisting / passing to WireGuard, which
 * is strict about network-address form in AllowedIPs entries.
 *
 * Throws if the input isn't a valid IPv4 CIDR.
 *
 * @param {string} cidr
 * @returns {string}
 */
function normalizeCidr(cidr) {
  return formatCidr(parseCidr(cidr));
}

/**
 * Decide whether two CIDRs overlap (share any address in common).
 *
 * Overlap iff one CIDR contains the other's network address — which is
 * true iff: shorter-prefix network masked to the same prefix === the other
 * network masked to that prefix.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function cidrsOverlap(a, b) {
  const pa = parseCidr(a);
  const pb = parseCidr(b);
  const shorterPrefix = Math.min(pa.prefix, pb.prefix);
  const mask = shorterPrefix === 0 ? 0 : (0xFFFFFFFF << (32 - shorterPrefix)) >>> 0;
  return ((pa.network & mask) >>> 0) === ((pb.network & mask) >>> 0);
}

/**
 * Validate a customer_lan_cidr string. Throws on rejection with a descriptive
 * message so the route can surface it as a 400 error.
 *
 * Rules (in evaluation order):
 *  1. Must be a valid IPv4 CIDR
 *  2. Prefix must be /16 - /30
 *  3. Must be within an RFC 1918 private range
 *  4. Must NOT overlap any reserved infra CIDR
 *  5. (Caller's responsibility) Must NOT overlap any OTHER customer's
 *     customer_lan_cidr — needs DB context, see assertNoCustomerLanOverlap.
 *
 * @param {string} cidr
 */
function assertValidCustomerLanCidr(cidr) {
  const parsed = parseCidr(cidr);
  if (parsed.prefix < MIN_CUSTOMER_LAN_PREFIX || parsed.prefix > MAX_CUSTOMER_LAN_PREFIX) {
    throw new Error(
      `customer_lan_cidr prefix /${parsed.prefix} is out of allowed range ` +
      `[/${MIN_CUSTOMER_LAN_PREFIX} - /${MAX_CUSTOMER_LAN_PREFIX}]`
    );
  }
  // Must be inside RFC 1918
  const insidePrivate = PRIVATE_PARENT_CIDRS.some((priv) => cidrsOverlap(cidr, priv) && parseCidr(priv).prefix <= parsed.prefix);
  if (!insidePrivate) {
    throw new Error(
      `customer_lan_cidr "${cidr}" must be inside an RFC 1918 private range ` +
      `(${PRIVATE_PARENT_CIDRS.join(', ')})`
    );
  }
  // Must not overlap infra
  for (const infra of RESERVED_INFRA_CIDRS) {
    if (cidrsOverlap(cidr, infra)) {
      throw new Error(
        `customer_lan_cidr "${cidr}" overlaps with reserved infrastructure range ${infra}`
      );
    }
  }
}

/**
 * Check that a proposed customer_lan_cidr does not overlap with any other
 * customer's customer_lan_cidr in the DB.
 *
 * Caller passes the array of all existing LAN CIDRs (typically from
 * `SELECT customer_lan_cidr FROM customer_tunnels WHERE id != excludeId
 *   AND status IN ('active','disabled')`).
 *
 * Pure function — DB query is the caller's job (so this stays unit-testable).
 *
 * @param {string} proposed
 * @param {string[]} existing
 */
function assertNoCustomerLanOverlap(proposed, existing) {
  for (const other of existing) {
    if (!other) continue;
    if (cidrsOverlap(proposed, other)) {
      throw new Error(
        `customer_lan_cidr "${proposed}" overlaps with another customer's LAN "${other}"`
      );
    }
  }
}

/**
 * Validate a tunnel create-request body.
 *
 * @param {*} body
 * @returns {{ ok: true } | { ok: false, errors: {field: string, message: string}[] }}
 */
function validateCreateInput(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: [{ field: '_body', message: 'Request body required' }] };
  }
  if (!body.name || typeof body.name !== 'string') {
    errors.push({ field: 'name', message: 'name is required (string)' });
  } else if (!TUNNEL_NAME_REGEX.test(body.name)) {
    errors.push({
      field: 'name',
      message: 'name must be 2-64 chars matching [a-zA-Z0-9_-]+'
    });
  }
  if (!body.customer_pubkey || typeof body.customer_pubkey !== 'string') {
    errors.push({ field: 'customer_pubkey', message: 'customer_pubkey is required (44-char base64 WireGuard public key)' });
  } else if (!WG_KEY_REGEX.test(body.customer_pubkey)) {
    errors.push({
      field: 'customer_pubkey',
      message: 'customer_pubkey must be a 44-char base64 WireGuard public key'
    });
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    errors.push({ field: 'notes', message: 'notes must be a string' });
  }
  if (body.notes && body.notes.length > 4000) {
    errors.push({ field: 'notes', message: 'notes max 4000 chars' });
  }
  // customer_lan_cidr is optional. If present, must pass static checks.
  // Cross-customer overlap is the caller's job (needs DB).
  //
  // Trim before validating so a stray space from a copy-paste doesn't get
  // a confusing "not a valid IPv4 CIDR" error. Keeps POST + PATCH paths
  // consistent (both trim before assertValid).
  if (body.customer_lan_cidr !== undefined && body.customer_lan_cidr !== null && body.customer_lan_cidr !== '') {
    if (typeof body.customer_lan_cidr !== 'string') {
      errors.push({ field: 'customer_lan_cidr', message: 'customer_lan_cidr must be a string or null' });
    } else {
      const trimmed = body.customer_lan_cidr.trim();
      if (trimmed === '') {
        // After trim, only whitespace — treat as "not provided".
      } else {
        try {
          assertValidCustomerLanCidr(trimmed);
        } catch (err) {
          errors.push({ field: 'customer_lan_cidr', message: err.message });
        }
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Shape a CustomerTunnel row for API output. Always strips preshared_key
 * (which is server-secret in API responses; clients fetch it via the
 * dedicated /customer-config endpoint).
 */
function serializeTunnel(t) {
  if (!t) return null;
  const obj = t.toJSON ? t.toJSON() : { ...t };
  // Defense in depth: drop preshared_key even if a future code path
  // accidentally includes it via withSecrets scope.
  delete obj.preshared_key;
  return obj;
}

module.exports = {
  TUNNEL_NAME_REGEX,
  WG_KEY_REGEX,
  SUBNET_ALLOC_RETRIES,
  IPV4_CIDR_REGEX,
  RESERVED_INFRA_CIDRS,
  PRIVATE_PARENT_CIDRS,
  MIN_CUSTOMER_LAN_PREFIX,
  MAX_CUSTOMER_LAN_PREFIX,
  generatePsk,
  parseCidr,
  formatCidr,
  normalizeCidr,
  cidrsOverlap,
  assertValidCustomerLanCidr,
  assertNoCustomerLanOverlap,
  validateCreateInput,
  serializeTunnel
};
