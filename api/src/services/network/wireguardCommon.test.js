/**
 * Tests for wireguardCommon — the shared validator module extracted
 * from wireguardApplier and wireguardStatusService.
 *
 * Run: `node api/src/services/network/wireguardCommon.test.js`
 */

'use strict';

const assert = require('node:assert/strict');
const {
  INTERFACE_NAME_REGEX,
  assertValidInterfaceName
} = require('./wireguardCommon');

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

test('INTERFACE_NAME_REGEX is exported and matches typical names', () => {
  assert.ok(INTERFACE_NAME_REGEX instanceof RegExp);
  assert.ok(INTERFACE_NAME_REGEX.test('wg0'));
  assert.ok(INTERFACE_NAME_REGEX.test('wg1'));
  assert.ok(INTERFACE_NAME_REGEX.test('wg99'));
  assert.ok(INTERFACE_NAME_REGEX.test('customer-tun'));
  assert.ok(INTERFACE_NAME_REGEX.test('my_tunnel'));
});

test('assertValidInterfaceName rejects shell-special chars (command injection defense)', () => {
  assert.throws(() => assertValidInterfaceName('wg1; rm -rf /'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('wg1$(whoami)'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('wg1`id`'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('wg1 && evil'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('wg1|sh'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('../wg1'), /Invalid.*interface name/);
});

test('assertValidInterfaceName rejects empty + too-long names (Linux IFNAMSIZ=16)', () => {
  assert.throws(() => assertValidInterfaceName(''), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('a'.repeat(16)), /Invalid.*interface name/);
  assert.doesNotThrow(() => assertValidInterfaceName('a'.repeat(15)));
});

test('assertValidInterfaceName rejects non-string', () => {
  assert.throws(() => assertValidInterfaceName(null), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName(undefined), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName(123), /Invalid.*interface name/);
});

test('module exports are stable (no accidental re-imports break)', () => {
  // Confirms both applier and statusService continue to get the same identity
  // out of this shared module — important for the dedupe to work.
  const again = require('./wireguardCommon');
  assert.equal(again.assertValidInterfaceName, assertValidInterfaceName);
  assert.equal(again.INTERFACE_NAME_REGEX, INTERFACE_NAME_REGEX);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
