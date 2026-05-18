/**
 * Standalone tests for subnetAllocator pure functions.
 *
 * Run with: `node api/src/services/network/subnetAllocator.test.js`
 *
 * No test framework required. Uses node's built-in `assert`. Exits non-zero on
 * any failure so CI can wire it up later by simply invoking the file.
 *
 * Only the pure functions are tested here (no DB). DB-aware functions
 * (`getInUseSubnets`, `allocateNextAvailable`) need integration tests against
 * a real or in-memory Sequelize instance — to be added when the test
 * framework lands for this repo.
 */

'use strict';

const assert = require('node:assert/strict');
const {
  findNextAvailableSubnet,
  isValidCustomerSubnet,
  ipsForSubnet,
  getInUseSubnets,
  allocateNextAvailable,
  POOL_CIDR,
  SUBNET_PREFIX
} = require('./subnetAllocator');

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

test('POOL_CIDR is 10.20.0.0/16', () => {
  assert.equal(POOL_CIDR, '10.20.0.0/16');
});

test('SUBNET_PREFIX is /30', () => {
  assert.equal(SUBNET_PREFIX, 30);
});

test('empty pool returns 10.20.0.0/30 with .1/.2 IPs', () => {
  const r = findNextAvailableSubnet([]);
  assert.deepEqual(r, {
    subnet: '10.20.0.0/30',
    cloud_ip: '10.20.0.1',
    customer_ip: '10.20.0.2'
  });
});

test('skip first /30 if used', () => {
  const r = findNextAvailableSubnet(['10.20.0.0/30']);
  assert.equal(r.subnet, '10.20.0.4/30');
  assert.equal(r.cloud_ip, '10.20.0.5');
  assert.equal(r.customer_ip, '10.20.0.6');
});

test('finds gap between used subnets (first-fit)', () => {
  const r = findNextAvailableSubnet(['10.20.0.0/30', '10.20.0.4/30', '10.20.0.12/30']);
  assert.equal(r.subnet, '10.20.0.8/30');
});

test('crosses /24 boundary when whole /24 is full', () => {
  const used = [];
  for (let i = 0; i < 256; i += 4) used.push(`10.20.0.${i}/30`);
  const r = findNextAvailableSubnet(used);
  assert.equal(r.subnet, '10.20.1.0/30');
});

test('accepts Set as input as well as array', () => {
  const used = new Set(['10.20.0.0/30', '10.20.0.4/30']);
  const r = findNextAvailableSubnet(used);
  assert.equal(r.subnet, '10.20.0.8/30');
});

test('throws when pool exhausted', () => {
  const full = [];
  for (let o3 = 0; o3 < 256; o3++) {
    for (let o4 = 0; o4 < 256; o4 += 4) {
      full.push(`10.20.${o3}.${o4}/30`);
    }
  }
  assert.throws(() => findNextAvailableSubnet(full), /pool exhausted/);
});

// --- isValidCustomerSubnet ---

test('isValid: 10.20.7.0/30', () => {
  assert.equal(isValidCustomerSubnet('10.20.7.0/30'), true);
});

test('isValid: 10.20.0.4/30', () => {
  assert.equal(isValidCustomerSubnet('10.20.0.4/30'), true);
});

test('isValid: 10.20.255.252/30 (last in pool)', () => {
  assert.equal(isValidCustomerSubnet('10.20.255.252/30'), true);
});

test('rejects /16 prefix', () => {
  assert.equal(isValidCustomerSubnet('10.20.0.0/16'), false);
});

test('rejects misaligned /30 (.5)', () => {
  assert.equal(isValidCustomerSubnet('10.20.0.5/30'), false);
});

test('rejects misaligned /30 (.7)', () => {
  assert.equal(isValidCustomerSubnet('10.20.0.7/30'), false);
});

test('rejects internal infra pool 10.10.x', () => {
  assert.equal(isValidCustomerSubnet('10.10.10.0/30'), false);
});

test('rejects 10.30.x (wrong pool)', () => {
  assert.equal(isValidCustomerSubnet('10.30.7.0/30'), false);
});

test('rejects octet > 255', () => {
  assert.equal(isValidCustomerSubnet('10.20.0.256/30'), false);
});

test('rejects empty string', () => {
  assert.equal(isValidCustomerSubnet(''), false);
});

// --- ipsForSubnet ---

test('ipsForSubnet for V7 (10.20.7.0/30)', () => {
  const r = ipsForSubnet('10.20.7.0/30');
  assert.deepEqual(r, { cloud_ip: '10.20.7.1', customer_ip: '10.20.7.2' });
});

test('ipsForSubnet for 10.20.0.0/30', () => {
  const r = ipsForSubnet('10.20.0.0/30');
  assert.deepEqual(r, { cloud_ip: '10.20.0.1', customer_ip: '10.20.0.2' });
});

test('ipsForSubnet throws on invalid subnet', () => {
  assert.throws(() => ipsForSubnet('10.30.0.0/30'), /Not a valid/);
});

// --- reserved subnets (tests use reservedOverride to avoid mutating module state) ---

test('findNextAvailableSubnet skips reservedOverride entries', () => {
  // With 10.20.0.0/30 and 10.20.0.4/30 reserved, allocator should pick 10.20.0.8/30
  const r = findNextAvailableSubnet([], { reservedOverride: ['10.20.0.0/30', '10.20.0.4/30'] });
  assert.equal(r.subnet, '10.20.0.8/30');
});

test('findNextAvailableSubnet treats reserved + used as disjoint sets that combine', () => {
  // Reserved: .0. Used: .4. Allocator should skip both and pick .8.
  const r = findNextAvailableSubnet(['10.20.0.4/30'], { reservedOverride: ['10.20.0.0/30'] });
  assert.equal(r.subnet, '10.20.0.8/30');
});

test('default RESERVED_SUBNETS is empty (no implicit reservations)', () => {
  const { RESERVED_SUBNETS } = require('./subnetAllocator');
  assert.ok(Array.isArray(RESERVED_SUBNETS) || RESERVED_SUBNETS instanceof Object);
  assert.equal(RESERVED_SUBNETS.length, 0, 'No subnets should be reserved by default; reservations are opt-in');
});

test('isValidCustomerSubnet rejects entries in default RESERVED_SUBNETS', () => {
  // This test is a placeholder for when RESERVED_SUBNETS has entries.
  // Currently it's empty, so we test the function path indirectly via the
  // findNextAvailableSubnet test above. If a future commit adds entries to
  // RESERVED_SUBNETS, this test self-extends.
  const { RESERVED_SUBNETS } = require('./subnetAllocator');
  for (const reserved of RESERVED_SUBNETS) {
    assert.equal(
      isValidCustomerSubnet(reserved),
      false,
      `Reserved subnet ${reserved} should be rejected by isValidCustomerSubnet`
    );
  }
});

test('Object.freeze prevents accidental mutation of RESERVED_SUBNETS at runtime', () => {
  const { RESERVED_SUBNETS } = require('./subnetAllocator');
  assert.throws(
    () => { RESERVED_SUBNETS.push('10.20.0.0/30'); },
    /(read only|Cannot add property|object is not extensible)/i,
    'RESERVED_SUBNETS must be frozen so it cannot be mutated by accident'
  );
});

// --- DB-aware path (regression: Sequelize Op import bug) ---
// Earlier code destructured `Op` off a `Sequelize` key in `models`, which is
// not how `api/src/models/index.js` exports things — caused a TypeError in
// prod the first time anyone tried to create a tunnel. These tests pin the
// shape that `getInUseSubnets` / `allocateNextAvailable` must accept.

(async () => {
  let dbPassed = 0;
  let dbFailed = 0;

  async function dbTest(name, fn) {
    try {
      await fn();
      console.log(`PASS  ${name}`);
      dbPassed++;
    } catch (err) {
      console.error(`FAIL  ${name}`);
      console.error(`      ${err.message}`);
      dbFailed++;
    }
  }

  function makeMockModels(rows = []) {
    return {
      CustomerTunnel: {
        findAll: async () => rows.map((r) => ({ tunnel_subnet: r.tunnel_subnet }))
      }
    };
  }

  await dbTest('getInUseSubnets returns subnets from active+disabled rows', async () => {
    const models = makeMockModels([
      { tunnel_subnet: '10.20.0.0/30' },
      { tunnel_subnet: '10.20.0.4/30' }
    ]);
    const out = await getInUseSubnets({ models });
    assert.deepEqual(out, ['10.20.0.0/30', '10.20.0.4/30']);
  });

  await dbTest('getInUseSubnets does NOT require a Sequelize key in models', async () => {
    // Regression guard: the prior implementation destructured `Sequelize`
    // off `models` and exploded because the real models registry doesn't
    // expose Sequelize that way. Op now imports directly from the package.
    const models = { CustomerTunnel: { findAll: async () => [] } };
    const out = await getInUseSubnets({ models });
    assert.deepEqual(out, []);
  });

  await dbTest('getInUseSubnets throws helpful error when CustomerTunnel missing', async () => {
    await assert.rejects(
      () => getInUseSubnets({ models: {} }),
      /CustomerTunnel/
    );
  });

  await dbTest('allocateNextAvailable returns first free /30 given used set from DB', async () => {
    const models = makeMockModels([{ tunnel_subnet: '10.20.0.0/30' }]);
    const out = await allocateNextAvailable({ models });
    assert.equal(out.subnet, '10.20.0.4/30');
    assert.equal(out.cloud_ip, '10.20.0.5');
    assert.equal(out.customer_ip, '10.20.0.6');
  });

  // --- summary ---
  console.log(`\n${passed + dbPassed} passed, ${failed + dbFailed} failed`);
  process.exit((failed + dbFailed) > 0 ? 1 : 0);
})();
