/**
 * Subnet allocator for customer WireGuard tunnels.
 *
 * Allocates /30 subnets from the pool 10.20.0.0/16. Each /30 gives:
 *   .0 → network (unused)
 *   .1 → cloud-side tunnel IP
 *   .2 → customer-side tunnel IP
 *   .3 → broadcast (unused)
 *
 * Total capacity: 16,384 /30 subnets (256 /24s × 64 /30s/24).
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  POOL SELECTION RATIONALE (why 10.20.0.0/16)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Audit performed against prod (203.0.113.1) on 2026-05-12:
 *
 *    Ranges already in use on prod:
 *      • 89.116.24.0/21        — eth0 public (Contabo)
 *      • 10.10.10.0/24         — wg0 internal infra (NUC + Staging peers)
 *      • 172.17.0.0/16         — Docker default bridge (docker0)
 *      • 172.18.0.0/16         — Docker custom bridge (vaultwarden)
 *      • 127.0.0.0/8           — loopback
 *
 *    10.20.0.0/16 → confirmed FREE. No routes, no interfaces, no docker
 *    bridges touch it.
 *
 *  Future ranges to AVOID for any new feature on this host (they're already
 *  taken, allocator will reject them via isValidCustomerSubnet):
 *      • 10.0.0.0/16           — historically used by some operators; not us
 *                                today but reserve mentally
 *      • 10.10.0.0/16          — internal Astradial infrastructure
 *      • 172.16.0.0/12         — Docker default range space; partly used
 *      • 192.168.0.0/16        — common customer LAN range (don't claim)
 *
 *  Customer-LAN overlap caveat (NOT preventable by the allocator):
 *      If a customer's site network internally uses 10.20.x.x (rare but
 *      possible for enterprise), their router will shadow our tunnel route.
 *      The customer config exporter (later PR) MUST warn operators to
 *      check the customer's LAN range before provisioning.
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  In-use semantics
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  A subnet is "in use" and not eligible for allocation when:
 *    - status = 'active'   (currently provisioned)
 *    - status = 'disabled' (peer removed from wg1 but row kept in DB)
 *    - status = 'revoked'  AND updated_at within REVOKED_RESERVATION_DAYS
 *                          (cooldown to prevent immediate re-use after a
 *                          security-driven revocation)
 *    - subnet ∈ RESERVED_SUBNETS (manually carved out, see below)
 *
 *  Revoked subnets older than the cooldown become recyclable automatically.
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Design notes
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  - Pure functions (`findNextAvailableSubnet`, `isValidCustomerSubnet`,
 *    `ipsForSubnet`) are unit-testable without a DB.
 *  - `allocateNextAvailable({ models })` wraps a DB query + the pure
 *    allocator.
 *  - Race condition: two concurrent calls may return the same subnet. The
 *    DB-level UNIQUE on customer_tunnels.tunnel_subnet ensures only one
 *    INSERT succeeds; callers must catch SequelizeUniqueConstraintError
 *    and retry.
 *
 *  See: docs/features/customer-tunnels.md for the broader design.
 */

'use strict';

const { Op } = require('sequelize');

const POOL_CIDR = '10.20.0.0/16';
const POOL_PREFIX = 16;
const SUBNET_PREFIX = 30;
const REVOKED_RESERVATION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compiled once, used by both isValidCustomerSubnet and ipsForSubnet so
 * there's a single source of truth for what "customer pool /30" looks like.
 */
const SUBNET_REGEX = /^10\.20\.(\d{1,3})\.(\d{1,3})\/30$/;

/**
 * /30 subnets that are inside the pool but must never be auto-allocated.
 *
 * Currently empty. Add entries here to reserve a /30 for special use
 * (e.g., a dedicated test peer, a documentation-only subnet, an emergency
 * debug tunnel). Reserved subnets are treated as "in use" by the allocator
 * AND rejected by isValidCustomerSubnet, so they can never accidentally
 * land in a customer_tunnels row.
 *
 * Add format: "10.20.X.Y/30" (must satisfy SUBNET_REGEX).
 */
const RESERVED_SUBNETS = Object.freeze([
  // Reserve no subnets initially. Add as needed.
  // Example future entry: '10.20.0.0/30',  // reserved: documentation/test subnet
]);

/**
 * Parse a /30 subnet string into its component octets, validating shape +
 * pool membership + alignment. Returns null if invalid.
 *
 * Internal helper — sharing one regex pass between validator and IP extraction.
 *
 * @param {string} subnet
 * @returns {{octet3: number, octet4: number} | null}
 */
function parseSubnet(subnet) {
  if (typeof subnet !== 'string') return null;
  const match = SUBNET_REGEX.exec(subnet);
  if (!match) return null;
  const octet3 = Number(match[1]);
  const octet4 = Number(match[2]);
  if (octet3 < 0 || octet3 > 255) return null;
  if (octet4 < 0 || octet4 > 252) return null;
  if (octet4 % 4 !== 0) return null; // misaligned /30
  return { octet3, octet4 };
}

/**
 * Validate that a subnet string falls inside our customer pool, is correctly
 * aligned to a /30 boundary, has the right prefix, and is NOT in
 * RESERVED_SUBNETS.
 *
 * @param {string} subnet - e.g. "10.20.7.0/30"
 * @returns {boolean}
 */
function isValidCustomerSubnet(subnet) {
  if (!parseSubnet(subnet)) return false;
  if (RESERVED_SUBNETS.includes(subnet)) return false;
  return true;
}

/**
 * Compute the cloud and customer IPs for a given /30 subnet.
 *
 * @param {string} subnet - e.g. "10.20.7.0/30"
 * @returns {{cloud_ip: string, customer_ip: string}}
 * @throws {Error} if subnet is not a valid customer /30
 */
function ipsForSubnet(subnet) {
  const parsed = parseSubnet(subnet);
  if (!parsed) {
    throw new Error(`Not a valid customer /30 subnet: ${subnet}`);
  }
  if (RESERVED_SUBNETS.includes(subnet)) {
    throw new Error(`Subnet ${subnet} is in RESERVED_SUBNETS — cannot allocate`);
  }
  const { octet3, octet4 } = parsed;
  return {
    cloud_ip: `10.20.${octet3}.${octet4 + 1}`,
    customer_ip: `10.20.${octet3}.${octet4 + 2}`
  };
}

/**
 * Pure function: given a set of in-use subnets, return the next available
 * /30 in the pool plus its cloud and customer IPs.
 *
 * Skips:
 *   - subnets in `usedSubnets` (allocated tunnels)
 *   - subnets in RESERVED_SUBNETS (manual carve-outs)
 *   - subnets in `reservedOverride` if provided (for tests)
 *
 * @param {Iterable<string>} usedSubnets
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.reservedOverride] - test-only: overrides
 *   RESERVED_SUBNETS to verify reservation logic without mutating module state
 * @returns {{subnet: string, cloud_ip: string, customer_ip: string}}
 * @throws {Error} if the pool is exhausted
 */
function findNextAvailableSubnet(usedSubnets, opts = {}) {
  const used = new Set(usedSubnets);
  // Treat reserved subnets as if they were already used.
  const reserved = opts.reservedOverride || RESERVED_SUBNETS;
  for (const r of reserved) used.add(r);

  // Walk every /30 in 10.20.0.0/16 in ascending order.
  // octet3 = third byte of IP (the /24 index), 0..255
  // octet4 = fourth byte, stepped by 4 (alignment for /30: .0, .4, .8, ...)
  for (let octet3 = 0; octet3 < 256; octet3++) {
    for (let octet4 = 0; octet4 < 256; octet4 += 4) {
      const subnet = `10.20.${octet3}.${octet4}/30`;
      if (!used.has(subnet)) {
        return {
          subnet,
          cloud_ip: `10.20.${octet3}.${octet4 + 1}`,
          customer_ip: `10.20.${octet3}.${octet4 + 2}`
        };
      }
    }
  }

  throw new Error(
    `Customer tunnel subnet pool exhausted (${POOL_CIDR} fully allocated). ` +
    `Free up revoked tunnels older than ${REVOKED_RESERVATION_DAYS} days, ` +
    `or expand the pool by editing subnetAllocator constants.`
  );
}

/**
 * Query the DB for in-use subnets — active, disabled, or revoked-within-cooldown.
 *
 * @param {object} opts
 * @param {object} opts.models - Sequelize models registry (must include CustomerTunnel)
 * @param {number} [opts.revokedReservationDays=30] - cooldown after revocation
 * @param {Date} [opts.now] - clock injection for tests
 * @returns {Promise<string[]>} - tunnel_subnet values currently in use
 */
async function getInUseSubnets({ models, revokedReservationDays = REVOKED_RESERVATION_DAYS, now = new Date() } = {}) {
  if (!models || !models.CustomerTunnel) {
    throw new Error('getInUseSubnets requires { models: { CustomerTunnel } }');
  }
  const { CustomerTunnel } = models;
  const cutoff = new Date(now.getTime() - revokedReservationDays * MS_PER_DAY);

  const rows = await CustomerTunnel.findAll({
    where: {
      [Op.or]: [
        { status: { [Op.in]: ['active', 'disabled'] } },
        {
          [Op.and]: [
            { status: 'revoked' },
            { updated_at: { [Op.gt]: cutoff } }
          ]
        }
      ]
    },
    attributes: ['tunnel_subnet']
  });

  return rows.map((r) => r.tunnel_subnet);
}

/**
 * Top-level allocation: query DB for in-use subnets, return next available.
 *
 * Race condition: two concurrent calls may return the same subnet. The DB-level
 * UNIQUE constraint on customer_tunnels.tunnel_subnet ensures only one INSERT
 * succeeds; the other will hit SequelizeUniqueConstraintError. The caller
 * (routes/customer-tunnels) is responsible for retry-on-conflict.
 *
 * @param {object} opts
 * @param {object} opts.models - Sequelize models registry
 * @returns {Promise<{subnet: string, cloud_ip: string, customer_ip: string}>}
 */
async function allocateNextAvailable({ models } = {}) {
  const used = await getInUseSubnets({ models });
  return findNextAvailableSubnet(used);
}

module.exports = {
  // Constants exposed for test + reference
  POOL_CIDR,
  POOL_PREFIX,
  SUBNET_PREFIX,
  REVOKED_RESERVATION_DAYS,
  RESERVED_SUBNETS,
  // Pure helpers (testable without DB)
  findNextAvailableSubnet,
  isValidCustomerSubnet,
  ipsForSubnet,
  // DB-aware
  getInUseSubnets,
  allocateNextAvailable
};
