/**
 * Standalone tests for wireguardGenerator pure functions.
 *
 * Run with: `node api/src/services/network/wireguardGenerator.test.js`
 *
 * Tests cover the pure rendering logic. I/O helpers (loadServerPrivateKey,
 * loadServerPublicKey, getActiveTunnels, generateWg1Config) need integration
 * tests against a real filesystem + Sequelize and are deferred to when the
 * test framework lands for this repo.
 */

'use strict';

const assert = require('node:assert/strict');
const {
  renderInterfaceBlock,
  renderPeerBlock,
  renderCustomerSidePeer,
  renderWg1Config,
  assertValidWgKey,
  assertValidIpv4,
  DEFAULT_INTERFACE_ADDRESS,
  DEFAULT_LISTEN_PORT,
  DEFAULT_POST_UP,
  DEFAULT_POST_DOWN
} = require('./wireguardGenerator');

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

// Test fixtures — valid 44-char base64 WG keys (these are real-looking but
// generated for tests; not used anywhere in production).
const FAKE_SERVER_PRIVATE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const FAKE_SERVER_PUBLIC  = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
const FAKE_CUSTOMER_PUB   = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=';
const FAKE_PSK            = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=';

const V7_TUNNEL = {
  org_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  name: 'astradial-v7',
  tunnel_subnet: '10.20.7.0/30',
  cloud_tunnel_ip: '10.20.7.1',
  customer_tunnel_ip: '10.20.7.2',
  customer_pubkey: FAKE_CUSTOMER_PUB,
  preshared_key: FAKE_PSK,
  persistent_keepalive: 25,
  created_at: new Date('2026-05-12T13:25:00.000Z')
};

// --- assertValidWgKey ---

test('assertValidWgKey accepts a valid 44-char base64 key', () => {
  assert.doesNotThrow(() => assertValidWgKey(FAKE_CUSTOMER_PUB));
});

test('assertValidWgKey rejects empty string', () => {
  assert.throws(() => assertValidWgKey(''), /Invalid WireGuard/);
});

test('assertValidWgKey rejects null', () => {
  assert.throws(() => assertValidWgKey(null), /Invalid WireGuard/);
});

test('assertValidWgKey rejects key without padding', () => {
  // 43 chars without '=' is invalid
  assert.throws(() => assertValidWgKey('A'.repeat(43)), /Invalid WireGuard/);
});

test('assertValidWgKey rejects key with wrong length', () => {
  assert.throws(() => assertValidWgKey('AAAA='), /Invalid WireGuard/);
});

test('assertValidWgKey label appears in error', () => {
  try {
    assertValidWgKey('bad', 'server private key');
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /server private key/);
  }
});

// --- renderInterfaceBlock ---

test('renderInterfaceBlock with defaults', () => {
  const out = renderInterfaceBlock({ private_key: FAKE_SERVER_PRIVATE });
  assert.match(out, /\[Interface\]/);
  assert.match(out, new RegExp(`Address = ${DEFAULT_INTERFACE_ADDRESS.replace('/', '\\/')}`));
  assert.match(out, new RegExp(`ListenPort = ${DEFAULT_LISTEN_PORT}`));
  assert.match(out, new RegExp(`PrivateKey = ${FAKE_SERVER_PRIVATE.replace(/[+/=]/g, '\\$&')}`));
  assert.match(out, new RegExp(`PostUp = ${DEFAULT_POST_UP.replace(/[./]/g, '\\$&')}`));
  assert.match(out, new RegExp(`PostDown = ${DEFAULT_POST_DOWN.replace(/[./]/g, '\\$&')}`));
});

test('renderInterfaceBlock with custom values', () => {
  const out = renderInterfaceBlock({
    private_key: FAKE_SERVER_PRIVATE,
    address: '10.99.0.1/24',
    listen_port: 51999,
    post_up: '/bin/true',
    post_down: '/bin/false'
  });
  assert.match(out, /Address = 10\.99\.0\.1\/24/);
  assert.match(out, /ListenPort = 51999/);
  assert.match(out, /PostUp = \/bin\/true/);
  assert.match(out, /PostDown = \/bin\/false/);
});

test('renderInterfaceBlock rejects missing private key', () => {
  assert.throws(() => renderInterfaceBlock({}), /server private key/);
});

test('renderInterfaceBlock rejects invalid private key', () => {
  assert.throws(() => renderInterfaceBlock({ private_key: 'too-short' }), /server private key/);
});

// --- renderPeerBlock ---

test('renderPeerBlock for V7 produces expected fields', () => {
  const out = renderPeerBlock(V7_TUNNEL);
  assert.match(out, /\[Peer\]/);
  assert.match(out, new RegExp(`PublicKey = ${FAKE_CUSTOMER_PUB.replace(/[+/=]/g, '\\$&')}`));
  assert.match(out, new RegExp(`PresharedKey = ${FAKE_PSK.replace(/[+/=]/g, '\\$&')}`));
  assert.match(out, /AllowedIPs = 10\.20\.7\.2\/32/);
  assert.match(out, /PersistentKeepalive = 25/);
});

test('renderPeerBlock includes header comment with org/name/created', () => {
  const out = renderPeerBlock(V7_TUNNEL);
  assert.match(out, /# org=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee name=astradial-v7 created=2026-05-12T13:25:00\.000Z/);
});

test('renderPeerBlock defaults persistent_keepalive to 25 if missing', () => {
  const t = { ...V7_TUNNEL };
  delete t.persistent_keepalive;
  const out = renderPeerBlock(t);
  assert.match(out, /PersistentKeepalive = 25/);
});

test('renderPeerBlock rejects missing tunnel', () => {
  assert.throws(() => renderPeerBlock(null), /tunnel is required/);
});

test('renderPeerBlock rejects tunnel with missing preshared_key (forgot withSecrets scope)', () => {
  const t = { ...V7_TUNNEL };
  delete t.preshared_key;
  assert.throws(() => renderPeerBlock(t), /pre-shared key/);
});

test('renderPeerBlock rejects tunnel with invalid customer_pubkey', () => {
  const t = { ...V7_TUNNEL, customer_pubkey: 'short' };
  assert.throws(() => renderPeerBlock(t), /customer pubkey/);
});

test('renderPeerBlock WITHOUT customer_lan_cidr keeps AllowedIPs = tunnel IP only (backward compat)', () => {
  const out = renderPeerBlock(V7_TUNNEL);
  assert.match(out, /AllowedIPs = 10\.20\.7\.2\/32\s*$/m);
  assert.doesNotMatch(out, /,/);  // no comma in AllowedIPs line → single entry
});

test('renderPeerBlock WITH customer_lan_cidr adds it to AllowedIPs (V7 scenario)', () => {
  const t = { ...V7_TUNNEL, customer_lan_cidr: '192.168.0.0/24' };
  const out = renderPeerBlock(t);
  assert.match(out, /AllowedIPs = 10\.20\.7\.2\/32, 192\.168\.0\.0\/24/);
});

test('renderPeerBlock customer_lan_cidr precedes tunnel IP in NO way — tunnel IP is always first', () => {
  // Ordering matters for readability; tunnel-side /32 should be the
  // "primary" identifier. LAN follows.
  const t = { ...V7_TUNNEL, customer_lan_cidr: '10.50.0.0/24' };
  const out = renderPeerBlock(t);
  const allowedLine = out.split('\n').find((l) => l.startsWith('AllowedIPs'));
  const tunnelIdx = allowedLine.indexOf('10.20.7.2/32');
  const lanIdx = allowedLine.indexOf('10.50.0.0/24');
  assert.ok(tunnelIdx >= 0 && lanIdx >= 0);
  assert.ok(tunnelIdx < lanIdx, 'tunnel IP must appear before customer LAN');
});

test('renderPeerBlock empty-string customer_lan_cidr is treated as absent (defensive)', () => {
  const t = { ...V7_TUNNEL, customer_lan_cidr: '' };
  const out = renderPeerBlock(t);
  assert.match(out, /AllowedIPs = 10\.20\.7\.2\/32\s*$/m);
  assert.doesNotMatch(out, /,/);
});

// --- renderCustomerSidePeer ---

test('renderCustomerSidePeer with no cloud_routed_ips → AllowedIPs is just tunnel IP', () => {
  const out = renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: FAKE_SERVER_PUBLIC,
    cloud_endpoint: '203.0.113.1:51821'
  });
  assert.match(out, /\[Peer\]/);
  assert.match(out, new RegExp(`PublicKey = ${FAKE_SERVER_PUBLIC.replace(/[+/=]/g, '\\$&')}`));
  assert.match(out, /AllowedIPs = 10\.20\.7\.1\/32\n/);  // tunnel IP only, no public IP
  assert.match(out, /Endpoint = 89\.116\.31\.109:51821/);
  assert.match(out, /PersistentKeepalive = 25/);
});

test('renderCustomerSidePeer with cloud_routed_ips=[203.0.113.1] → AllowedIPs has both', () => {
  const out = renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: FAKE_SERVER_PUBLIC,
    cloud_endpoint: '203.0.113.1:51821',
    cloud_routed_ips: ['203.0.113.1']
  });
  assert.match(out, /AllowedIPs = 10\.20\.7\.1\/32, 89\.116\.31\.109\/32/);
});

test('renderCustomerSidePeer deduplicates AllowedIPs entries', () => {
  // If caller passes the tunnel IP again in routed_ips, no duplicate output.
  const out = renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: FAKE_SERVER_PUBLIC,
    cloud_endpoint: '203.0.113.1:51821',
    cloud_routed_ips: ['10.20.7.1', '203.0.113.1', '203.0.113.1']
  });
  // Expect tunnel IP appears once, public IP appears once
  const allowed = out.match(/AllowedIPs = (.+)$/m)[1];
  const entries = allowed.split(',').map((s) => s.trim());
  assert.equal(entries.length, 2, `expected 2 unique entries, got: ${entries.join(' | ')}`);
  assert.equal(entries[0], '10.20.7.1/32');
  assert.equal(entries[1], '203.0.113.1/32');
});

test('renderCustomerSidePeer preserves input order in AllowedIPs after tunnel IP', () => {
  const out = renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: FAKE_SERVER_PUBLIC,
    cloud_endpoint: '203.0.113.1:51821',
    cloud_routed_ips: ['203.0.113.1', '10.99.0.1']
  });
  assert.match(out, /AllowedIPs = 10\.20\.7\.1\/32, 89\.116\.31\.109\/32, 10\.99\.0\.1\/32/);
});

test('renderCustomerSidePeer rejects missing tunnel', () => {
  assert.throws(() => renderCustomerSidePeer({ cloud_public_key: FAKE_SERVER_PUBLIC, cloud_endpoint: '1.2.3.4:5' }), /tunnel is required/);
});

test('renderCustomerSidePeer rejects invalid cloud_public_key', () => {
  assert.throws(() => renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: 'short',
    cloud_endpoint: '1.2.3.4:5'
  }), /cloud public key/);
});

test('renderCustomerSidePeer rejects missing endpoint', () => {
  assert.throws(() => renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: FAKE_SERVER_PUBLIC
  }), /endpoint is required/);
});

test('renderCustomerSidePeer rejects non-array cloud_routed_ips', () => {
  assert.throws(() => renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: FAKE_SERVER_PUBLIC,
    cloud_endpoint: '203.0.113.1:51821',
    cloud_routed_ips: '203.0.113.1'  // string, not array
  }), /must be an array/);
});

test('renderCustomerSidePeer rejects invalid IPv4 in cloud_routed_ips', () => {
  assert.throws(() => renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: FAKE_SERVER_PUBLIC,
    cloud_endpoint: '203.0.113.1:51821',
    cloud_routed_ips: ['not.an.ip.address']
  }), /not a valid IPv4/);
});

test('renderCustomerSidePeer rejects octet > 255 in cloud_routed_ips', () => {
  assert.throws(() => renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: FAKE_SERVER_PUBLIC,
    cloud_endpoint: '203.0.113.1:51821',
    cloud_routed_ips: ['89.116.999.1']
  }), /octet out of range/);
});

test('renderCustomerSidePeer rejects hostname in cloud_routed_ips', () => {
  // AllowedIPs requires CIDR; hostnames are not valid there.
  assert.throws(() => renderCustomerSidePeer({
    tunnel: V7_TUNNEL,
    cloud_public_key: FAKE_SERVER_PUBLIC,
    cloud_endpoint: 'sip.example.com:51821',
    cloud_routed_ips: ['sip.example.com']
  }), /not a valid IPv4/);
});

// --- assertValidIpv4 ---

test('assertValidIpv4 accepts standard IPv4', () => {
  assert.doesNotThrow(() => assertValidIpv4('203.0.113.1'));
});

test('assertValidIpv4 accepts edge IPv4 (0.0.0.0, 255.255.255.255)', () => {
  assert.doesNotThrow(() => assertValidIpv4('0.0.0.0'));
  assert.doesNotThrow(() => assertValidIpv4('255.255.255.255'));
});

test('assertValidIpv4 rejects 256+ octet', () => {
  assert.throws(() => assertValidIpv4('256.0.0.0'), /octet out of range/);
});

test('assertValidIpv4 rejects CIDR (caller must strip /N)', () => {
  assert.throws(() => assertValidIpv4('10.0.0.1/32'), /not a valid IPv4/);
});

test('assertValidIpv4 rejects non-string', () => {
  assert.throws(() => assertValidIpv4(12345), /expected string/);
});

// --- renderWg1Config (full file) ---

test('renderWg1Config with no peers produces just interface', () => {
  const out = renderWg1Config({
    private_key: FAKE_SERVER_PRIVATE,
    peers: [],
    generated_at: new Date('2026-05-12T13:30:00.000Z')
  });
  assert.match(out, /# AUTO-GENERATED/);
  assert.match(out, /# Generated: 2026-05-12T13:30:00\.000Z/);
  assert.match(out, /\[Interface\]/);
  assert.doesNotMatch(out, /\[Peer\]/);
});

test('renderWg1Config with one peer includes interface + peer', () => {
  const out = renderWg1Config({
    private_key: FAKE_SERVER_PRIVATE,
    peers: [V7_TUNNEL],
    generated_at: new Date('2026-05-12T13:30:00.000Z')
  });
  assert.match(out, /\[Interface\]/);
  assert.match(out, /\[Peer\]/);
  assert.match(out, /name=astradial-v7/);
});

test('renderWg1Config with multiple peers preserves order', () => {
  const t1 = { ...V7_TUNNEL, name: 'first', org_id: '00000000-1111-2222-3333-444444444444', customer_tunnel_ip: '10.20.0.2' };
  const t2 = { ...V7_TUNNEL, name: 'second', org_id: '99999999-1111-2222-3333-444444444444', customer_tunnel_ip: '10.20.0.6' };
  const out = renderWg1Config({
    private_key: FAKE_SERVER_PRIVATE,
    peers: [t1, t2]
  });
  const firstIdx = out.indexOf('name=first');
  const secondIdx = out.indexOf('name=second');
  assert.ok(firstIdx > 0, 'first peer should appear');
  assert.ok(secondIdx > firstIdx, 'second peer should appear after first (renderer preserves input order)');
});

test('renderWg1Config output marks AUTO-GENERATED + source-of-truth', () => {
  const out = renderWg1Config({ private_key: FAKE_SERVER_PRIVATE });
  assert.match(out, /AUTO-GENERATED by AstraPBX wireguardGenerator\. DO NOT EDIT BY HAND/);
  assert.match(out, /Source of truth: customer_tunnels table/);
});

test('renderWg1Config is deterministic given fixed generated_at', () => {
  const fixedTime = new Date('2026-01-01T00:00:00.000Z');
  const a = renderWg1Config({ private_key: FAKE_SERVER_PRIVATE, peers: [V7_TUNNEL], generated_at: fixedTime });
  const b = renderWg1Config({ private_key: FAKE_SERVER_PRIVATE, peers: [V7_TUNNEL], generated_at: fixedTime });
  assert.equal(a, b, 'two calls with same inputs must produce identical output');
});

// --- summary ---

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
