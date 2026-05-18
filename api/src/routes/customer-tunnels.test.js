/**
 * Tests for customer-tunnels routes' pure helpers.
 *
 * Run with: `node api/src/routes/customer-tunnels.test.js`
 *
 * Covers the testable pure logic: PSK generation, input validation,
 * serialization. Route handlers themselves are integration-tested
 * manually against staging (no test framework / supertest in repo yet).
 */

'use strict';

const assert = require('node:assert/strict');

// Import directly from the helpers module — bypasses the route's eager
// require of `../models` (which needs a configured .env to load).
const {
  generatePsk,
  validateCreateInput,
  serializeTunnel,
  TUNNEL_NAME_REGEX,
  WG_KEY_REGEX,
  SUBNET_ALLOC_RETRIES,
  parseCidr,
  formatCidr,
  normalizeCidr,
  cidrsOverlap,
  assertValidCustomerLanCidr,
  assertNoCustomerLanOverlap,
  RESERVED_INFRA_CIDRS,
  MIN_CUSTOMER_LAN_PREFIX,
  MAX_CUSTOMER_LAN_PREFIX
} = require('./customer-tunnels-helpers');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

const VALID_WG_KEY = 'kT+6Zes5CTvxU662Duh9sDwBvAKfPXeLo9ZK84lgzgA=';

// ─── generatePsk ──────────────────────────────────────────────────────────

test('generatePsk produces a 44-char base64 string', () => {
  const psk = generatePsk();
  assert.equal(typeof psk, 'string');
  assert.equal(psk.length, 44);
  assert.match(psk, WG_KEY_REGEX, 'PSK must match WG key format');
});

test('generatePsk produces unique values on each call', () => {
  const a = generatePsk();
  const b = generatePsk();
  const c = generatePsk();
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});

test('generatePsk produces high-entropy output (no obvious patterns)', () => {
  // Sample 50 PSKs; the first byte (1st base64 char) should not be the same value 50 times
  const firstChars = new Set();
  for (let i = 0; i < 50; i++) firstChars.add(generatePsk()[0]);
  assert.ok(firstChars.size > 10, `Expected diverse first chars, got ${firstChars.size}`);
});

// ─── validateCreateInput ──────────────────────────────────────────────────

test('validateCreateInput accepts valid input', () => {
  const r = validateCreateInput({ name: 'astradial-v7', customer_pubkey: VALID_WG_KEY });
  assert.equal(r.ok, true);
});

test('validateCreateInput accepts optional notes', () => {
  const r = validateCreateInput({
    name: 'astradial-v7',
    customer_pubkey: VALID_WG_KEY,
    notes: 'V7 multi-WAN tunnel'
  });
  assert.equal(r.ok, true);
});

test('validateCreateInput rejects missing name', () => {
  const r = validateCreateInput({ customer_pubkey: VALID_WG_KEY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'name'));
});

test('validateCreateInput rejects short name', () => {
  const r = validateCreateInput({ name: 'x', customer_pubkey: VALID_WG_KEY });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'name'));
});

test('validateCreateInput rejects name with shell-special chars', () => {
  const r = validateCreateInput({
    name: 'wg1; rm -rf /',
    customer_pubkey: VALID_WG_KEY
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'name'));
});

test('validateCreateInput rejects name >64 chars', () => {
  const r = validateCreateInput({
    name: 'a'.repeat(65),
    customer_pubkey: VALID_WG_KEY
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'name'));
});

test('validateCreateInput rejects missing customer_pubkey', () => {
  const r = validateCreateInput({ name: 'astradial-v7' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'customer_pubkey'));
});

test('validateCreateInput rejects malformed customer_pubkey', () => {
  const r = validateCreateInput({ name: 'astradial-v7', customer_pubkey: 'not-a-real-key' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'customer_pubkey'));
});

test('validateCreateInput rejects non-string notes', () => {
  const r = validateCreateInput({
    name: 'astradial-v7',
    customer_pubkey: VALID_WG_KEY,
    notes: 123
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'notes'));
});

test('validateCreateInput rejects notes >4000 chars', () => {
  const r = validateCreateInput({
    name: 'astradial-v7',
    customer_pubkey: VALID_WG_KEY,
    notes: 'x'.repeat(4001)
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'notes'));
});

test('validateCreateInput rejects null body', () => {
  const r = validateCreateInput(null);
  assert.equal(r.ok, false);
});

test('validateCreateInput rejects non-object body', () => {
  const r = validateCreateInput('not an object');
  assert.equal(r.ok, false);
});

test('validateCreateInput rejects undefined body (no 500, returns clean errors)', () => {
  const r = validateCreateInput(undefined);
  assert.equal(r.ok, false);
  // Critically: validator must NOT throw on missing body — it returns
  // errors so the route handler can emit a clean 400 instead of leaking
  // a stack trace via 500.
  assert.ok(Array.isArray(r.errors));
});

// ─── serializeTunnel ──────────────────────────────────────────────────────

test('serializeTunnel returns null for null input', () => {
  assert.equal(serializeTunnel(null), null);
  assert.equal(serializeTunnel(undefined), null);
});

test('serializeTunnel works on plain objects (no toJSON)', () => {
  const out = serializeTunnel({
    id: 'abc',
    name: 'test',
    preshared_key: 'SECRET'
  });
  assert.equal(out.id, 'abc');
  assert.equal(out.name, 'test');
  assert.equal(out.preshared_key, undefined,
    'preshared_key must be stripped from API output (security)');
});

test('serializeTunnel works on Sequelize-like objects with toJSON', () => {
  const tunnel = {
    toJSON() { return { id: 'abc', name: 'test', preshared_key: 'SECRET' }; }
  };
  const out = serializeTunnel(tunnel);
  assert.equal(out.id, 'abc');
  assert.equal(out.preshared_key, undefined,
    'preshared_key must be stripped even from Sequelize-shaped objects');
});

test('serializeTunnel preserves all other fields', () => {
  const tunnel = {
    id: 'abc',
    org_id: 'org-123',
    name: 'astradial-v7',
    tunnel_subnet: '10.20.7.0/30',
    cloud_tunnel_ip: '10.20.7.1',
    customer_tunnel_ip: '10.20.7.2',
    customer_pubkey: 'pk',
    status: 'active',
    preshared_key: 'SECRET',
    created_at: new Date('2026-05-12T08:00:00Z')
  };
  const out = serializeTunnel(tunnel);
  for (const k of ['id', 'org_id', 'name', 'tunnel_subnet', 'cloud_tunnel_ip',
                   'customer_tunnel_ip', 'customer_pubkey', 'status', 'created_at']) {
    assert.ok(k in out, `field ${k} should be preserved`);
  }
  assert.equal(out.preshared_key, undefined);
});

// ─── Constants sanity ─────────────────────────────────────────────────────

test('TUNNEL_NAME_REGEX matches expected names', () => {
  assert.ok(TUNNEL_NAME_REGEX.test('astradial-v7'));
  assert.ok(TUNNEL_NAME_REGEX.test('cust_001'));
  assert.ok(TUNNEL_NAME_REGEX.test('XYZ-123'));
});

test('TUNNEL_NAME_REGEX rejects shell-special characters', () => {
  assert.ok(!TUNNEL_NAME_REGEX.test('wg1; rm -rf /'));
  assert.ok(!TUNNEL_NAME_REGEX.test('a$(b)'));
  assert.ok(!TUNNEL_NAME_REGEX.test('with space'));
  assert.ok(!TUNNEL_NAME_REGEX.test('with/slash'));
  assert.ok(!TUNNEL_NAME_REGEX.test('with.dot'));
});

test('WG_KEY_REGEX matches realistic WG public keys', () => {
  assert.ok(WG_KEY_REGEX.test(VALID_WG_KEY));
  assert.ok(WG_KEY_REGEX.test('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='));
});

test('WG_KEY_REGEX rejects keys without trailing =', () => {
  assert.ok(!WG_KEY_REGEX.test('A'.repeat(43)));
});

test('SUBNET_ALLOC_RETRIES is a reasonable small int', () => {
  assert.ok(Number.isInteger(SUBNET_ALLOC_RETRIES));
  assert.ok(SUBNET_ALLOC_RETRIES >= 2 && SUBNET_ALLOC_RETRIES <= 10,
    'retries should be small enough to avoid amplifying load, big enough to recover from real races');
});

// ─── parseCidr ────────────────────────────────────────────────────────────

test('parseCidr returns network + prefix for a simple /24', () => {
  const { network, prefix } = parseCidr('192.168.0.0/24');
  // 192.168.0.0 = 0xC0A80000 = 3232235520
  assert.equal(network, 0xC0A80000);
  assert.equal(prefix, 24);
});

test('parseCidr zeroes host bits if user passes a non-network address', () => {
  // 192.168.0.5/24 should be treated as 192.168.0.0/24
  const { network, prefix } = parseCidr('192.168.0.5/24');
  assert.equal(network, 0xC0A80000);
  assert.equal(prefix, 24);
});

test('parseCidr handles /32 (single host)', () => {
  const { network, prefix } = parseCidr('10.20.0.2/32');
  assert.equal(network, 0x0A140002);
  assert.equal(prefix, 32);
});

test('parseCidr handles /0 (entire IPv4 space)', () => {
  const { network, prefix } = parseCidr('255.255.255.255/0');
  assert.equal(network, 0);
  assert.equal(prefix, 0);
});

test('parseCidr throws on malformed input', () => {
  assert.throws(() => parseCidr('not-a-cidr'), /not a valid IPv4 CIDR/);
  assert.throws(() => parseCidr('192.168.0.0'), /not a valid IPv4 CIDR/);
  assert.throws(() => parseCidr('192.168.0.0/'), /not a valid IPv4 CIDR/);
});

test('parseCidr throws on out-of-range octets', () => {
  assert.throws(() => parseCidr('256.0.0.0/24'), /octet out of range/);
  assert.throws(() => parseCidr('1.2.3.999/24'), /octet out of range/);
});

test('parseCidr throws on out-of-range prefix', () => {
  assert.throws(() => parseCidr('10.0.0.0/33'), /prefix.*out of range/);
});

// ─── cidrsOverlap ─────────────────────────────────────────────────────────

test('cidrsOverlap identical /24s overlap', () => {
  assert.equal(cidrsOverlap('192.168.0.0/24', '192.168.0.0/24'), true);
});

test('cidrsOverlap subset (192.168.0.0/24 ⊂ 192.168.0.0/16) overlap', () => {
  assert.equal(cidrsOverlap('192.168.0.0/24', '192.168.0.0/16'), true);
  assert.equal(cidrsOverlap('192.168.0.0/16', '192.168.0.0/24'), true); // commutative
});

test('cidrsOverlap partial subset (192.168.0.128/25 ⊂ 192.168.0.0/24) overlap', () => {
  assert.equal(cidrsOverlap('192.168.0.128/25', '192.168.0.0/24'), true);
});

test('cidrsOverlap disjoint /24s do NOT overlap', () => {
  assert.equal(cidrsOverlap('192.168.0.0/24', '192.168.1.0/24'), false);
  assert.equal(cidrsOverlap('10.0.0.0/24', '192.168.0.0/24'), false);
});

test('cidrsOverlap adjacent /25s do NOT overlap', () => {
  // 192.168.0.0/25 covers .0-.127, 192.168.0.128/25 covers .128-.255 — adjacent, no overlap
  assert.equal(cidrsOverlap('192.168.0.0/25', '192.168.0.128/25'), false);
});

test('cidrsOverlap reserved 10.20.0.0/16 overlaps customer-pool subsets', () => {
  // V7's /30 is INSIDE the reserved customer-pool — that's by design,
  // but a *customer LAN* claim of 10.20.0.0/24 must be rejected as overlap.
  assert.equal(cidrsOverlap('10.20.0.0/24', '10.20.0.0/16'), true);
});

// ─── assertValidCustomerLanCidr ───────────────────────────────────────────

test('assertValidCustomerLanCidr accepts a normal /24 in RFC 1918', () => {
  assert.doesNotThrow(() => assertValidCustomerLanCidr('192.168.0.0/24'));
  assert.doesNotThrow(() => assertValidCustomerLanCidr('10.0.0.0/24'));
  assert.doesNotThrow(() => assertValidCustomerLanCidr('172.16.0.0/24'));
});

test('assertValidCustomerLanCidr rejects public IP ranges', () => {
  assert.throws(() => assertValidCustomerLanCidr('8.8.8.0/24'), /RFC 1918 private/);
  assert.throws(() => assertValidCustomerLanCidr('1.1.1.0/24'), /RFC 1918 private/);
  assert.throws(() => assertValidCustomerLanCidr('89.116.31.0/24'), /RFC 1918 private/);
});

test('assertValidCustomerLanCidr rejects prefix outside [/16, /30]', () => {
  // /8 too wide
  assert.throws(() => assertValidCustomerLanCidr('10.0.0.0/8'), /prefix.*out of allowed range/);
  // /31 too narrow (only 2 addresses, both reserved)
  assert.throws(() => assertValidCustomerLanCidr('192.168.0.0/31'), /prefix.*out of allowed range/);
  // /32 single host — also rejected as "LAN"
  assert.throws(() => assertValidCustomerLanCidr('192.168.0.1/32'), /prefix.*out of allowed range/);
});

test('assertValidCustomerLanCidr rejects overlap with reserved infra ranges', () => {
  // wg0 internal infra
  assert.throws(() => assertValidCustomerLanCidr('10.10.10.0/24'), /reserved infrastructure/);
  // wg1 customer pool (any /24 inside it would overlap)
  assert.throws(() => assertValidCustomerLanCidr('10.20.0.0/24'), /reserved infrastructure/);
  // Docker bridges
  assert.throws(() => assertValidCustomerLanCidr('172.17.0.0/24'), /reserved infrastructure/);
  assert.throws(() => assertValidCustomerLanCidr('172.18.0.0/24'), /reserved infrastructure/);
});

test('assertValidCustomerLanCidr rejects malformed input early', () => {
  assert.throws(() => assertValidCustomerLanCidr('not-a-cidr'), /not a valid IPv4 CIDR/);
});

test('RESERVED_INFRA_CIDRS contains all expected ranges', () => {
  // Sanity check on the reserved list — these are load-bearing in
  // assertValidCustomerLanCidr above.
  assert.ok(RESERVED_INFRA_CIDRS.includes('10.10.10.0/24'), 'wg0 must be reserved');
  assert.ok(RESERVED_INFRA_CIDRS.includes('10.20.0.0/16'), 'wg1 pool must be reserved');
  assert.ok(RESERVED_INFRA_CIDRS.includes('127.0.0.0/8'), 'loopback must be reserved');
  assert.ok(Object.isFrozen(RESERVED_INFRA_CIDRS), 'must be frozen to prevent runtime mutation');
});

test('Customer LAN prefix bounds are sane', () => {
  assert.equal(MIN_CUSTOMER_LAN_PREFIX, 16);
  assert.equal(MAX_CUSTOMER_LAN_PREFIX, 30);
});

// ─── assertNoCustomerLanOverlap ───────────────────────────────────────────

test('assertNoCustomerLanOverlap accepts disjoint LAN', () => {
  assert.doesNotThrow(() =>
    assertNoCustomerLanOverlap('192.168.0.0/24', ['10.0.0.0/24', '172.16.0.0/24'])
  );
});

test('assertNoCustomerLanOverlap rejects identical LAN', () => {
  assert.throws(
    () => assertNoCustomerLanOverlap('192.168.0.0/24', ['192.168.0.0/24']),
    /overlaps with another customer/
  );
});

test('assertNoCustomerLanOverlap rejects subset overlap', () => {
  assert.throws(
    () => assertNoCustomerLanOverlap('192.168.0.0/16', ['192.168.0.0/24']),
    /overlaps with another customer/
  );
});

test('assertNoCustomerLanOverlap ignores nulls in existing list (safe for partial DB rows)', () => {
  assert.doesNotThrow(() =>
    assertNoCustomerLanOverlap('192.168.0.0/24', [null, '10.0.0.0/24', null])
  );
});

test('assertNoCustomerLanOverlap with empty existing list passes', () => {
  assert.doesNotThrow(() => assertNoCustomerLanOverlap('192.168.0.0/24', []));
});

// ─── validateCreateInput — customer_lan_cidr branch ───────────────────────

test('validateCreateInput accepts body WITHOUT customer_lan_cidr (backward compat)', () => {
  const r = validateCreateInput({
    name: 'v7-tirupathur',
    customer_pubkey: VALID_WG_KEY
  });
  assert.equal(r.ok, true);
});

test('validateCreateInput accepts body with valid customer_lan_cidr', () => {
  const r = validateCreateInput({
    name: 'v7-tirupathur',
    customer_pubkey: VALID_WG_KEY,
    customer_lan_cidr: '192.168.0.0/24'
  });
  assert.equal(r.ok, true);
});

test('validateCreateInput rejects body with malformed customer_lan_cidr', () => {
  const r = validateCreateInput({
    name: 'v7-tirupathur',
    customer_pubkey: VALID_WG_KEY,
    customer_lan_cidr: 'not-a-cidr'
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'customer_lan_cidr'));
});

test('validateCreateInput rejects public-range customer_lan_cidr', () => {
  const r = validateCreateInput({
    name: 'v7-tirupathur',
    customer_pubkey: VALID_WG_KEY,
    customer_lan_cidr: '8.8.8.0/24'
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'customer_lan_cidr' && /RFC 1918/.test(e.message)));
});

test('validateCreateInput rejects infra-overlap customer_lan_cidr', () => {
  const r = validateCreateInput({
    name: 'v7-tirupathur',
    customer_pubkey: VALID_WG_KEY,
    customer_lan_cidr: '10.20.0.0/24'  // overlaps wg1 pool
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'customer_lan_cidr' && /reserved infrastructure/.test(e.message)));
});

test('validateCreateInput treats empty-string customer_lan_cidr as "not provided"', () => {
  // UI form might send "" when user clears the field — treat that as null,
  // not as a malformed value.
  const r = validateCreateInput({
    name: 'v7-tirupathur',
    customer_pubkey: VALID_WG_KEY,
    customer_lan_cidr: ''
  });
  assert.equal(r.ok, true);
});

test('validateCreateInput trims whitespace before validating (paste-safety)', () => {
  // Direct API callers may include accidental whitespace from a copy-paste.
  // Trim before validating so the user gets a clean accept, not a confusing
  // "not a valid CIDR" error.
  const r = validateCreateInput({
    name: 'v7-tirupathur',
    customer_pubkey: VALID_WG_KEY,
    customer_lan_cidr: '  192.168.0.0/24  '
  });
  assert.equal(r.ok, true);
});

test('validateCreateInput rejects whitespace-only customer_lan_cidr (treated as not-provided)', () => {
  const r = validateCreateInput({
    name: 'v7-tirupathur',
    customer_pubkey: VALID_WG_KEY,
    customer_lan_cidr: '     '
  });
  assert.equal(r.ok, true);  // empty after trim → equivalent to omitting the field
});

// ─── normalizeCidr / formatCidr ───────────────────────────────────────────

test('formatCidr round-trips a parsed network address', () => {
  const p = parseCidr('10.20.0.0/24');
  assert.equal(formatCidr(p), '10.20.0.0/24');
});

test('normalizeCidr zeroes host bits — 10.5.1.5/16 → 10.5.0.0/16', () => {
  // wg syncconf's AllowedIPs parser is strict about network-address form.
  // We normalize before persistence so the applier never feeds wg a
  // non-canonical CIDR.
  assert.equal(normalizeCidr('10.5.1.5/16'), '10.5.0.0/16');
});

test('normalizeCidr is idempotent on already-canonical input', () => {
  assert.equal(normalizeCidr('192.168.0.0/24'), '192.168.0.0/24');
  assert.equal(normalizeCidr('10.20.0.0/30'), '10.20.0.0/30');
});

test('normalizeCidr handles /32 (single-host) correctly', () => {
  assert.equal(normalizeCidr('10.20.0.2/32'), '10.20.0.2/32');
});

test('normalizeCidr propagates parseCidr errors on malformed input', () => {
  assert.throws(() => normalizeCidr('not-a-cidr'), /not a valid IPv4 CIDR/);
});

// ─── summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
