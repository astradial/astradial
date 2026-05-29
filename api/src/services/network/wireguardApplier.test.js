/**
 * Orchestration tests for wireguardApplier.
 *
 * Run with: `node api/src/services/network/wireguardApplier.test.js`
 *
 * These tests use injected mock fs + exec to verify the orchestration
 * sequence (read-old → backup → write-tmp → rename → exec syncconf, or
 * failure → restore from backup → re-run syncconf). They do NOT exercise
 * real filesystem or `wg syncconf` — those need integration testing on a
 * VPS with wg1 bootstrap in place.
 *
 * Convention: each test builds a fresh `mockIo` recording call sequence,
 * runs the applier, then asserts on the recorded calls + the return value.
 */

'use strict';

const assert = require('node:assert/strict');
const {
  applyWg1Config,
  syncCustomerLanRoutes,
  rollbackToBackup,
  listBackups,
  fileExists,
  buildBackupPath,
  buildTmpPath,
  assertValidInterfaceName,
  DEFAULT_CONFIG_PATH,
  DEFAULT_INTERFACE,
  DEFAULT_EXEC_TIMEOUT_MS,
  SAFE_CIDR_REGEX,
  INFRA_WG1_SUBNET
} = require('./wireguardApplier');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const run = async () => {
    try {
      await fn();
      console.log(`PASS  ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL  ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  };
  // Sequential execution — push to a chain
  testQueue.push(run);
}

const testQueue = [];

/**
 * Mock-IO factory. Returns a fully-functional mock filesystem that records
 * every call. Optional `failures` object can simulate failure modes:
 *   { writeFile: 'EACCES' } → next writeFile throws with code 'EACCES'
 *   { rename: true } → next rename throws
 *   { exec: 'wg syncconf failed' } → next exec rejects
 */
function makeMockIo({ initialFiles = {}, failures = {} } = {}) {
  const files = new Map(Object.entries(initialFiles));
  const calls = [];
  const now = new Date('2026-05-12T08:15:30.000Z');

  function record(name, args) {
    calls.push({ name, args });
  }

  function maybeFail(opName) {
    const f = failures[opName];
    if (!f) return;
    delete failures[opName]; // one-shot — fail once then succeed
    const err = new Error(typeof f === 'string' ? f : `Mocked ${opName} failure`);
    if (typeof f === 'string' && f.startsWith('E')) err.code = f;
    throw err;
  }

  return {
    files,        // exposed for assertions
    calls,        // exposed for assertions
    failures,     // mutable; tests can change mid-flight if needed
    readFile: async (p, ...rest) => {
      record('readFile', [p, ...rest]);
      maybeFail('readFile');
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(p);
    },
    writeFile: async (p, content, opts) => {
      record('writeFile', [p, content, opts]);
      maybeFail('writeFile');
      files.set(p, content);
    },
    copyFile: async (src, dst) => {
      record('copyFile', [src, dst]);
      maybeFail('copyFile');
      if (!files.has(src)) {
        const err = new Error(`ENOENT: ${src}`);
        err.code = 'ENOENT';
        throw err;
      }
      files.set(dst, files.get(src));
    },
    rename: async (src, dst) => {
      record('rename', [src, dst]);
      maybeFail('rename');
      if (!files.has(src)) {
        const err = new Error(`ENOENT: ${src}`);
        err.code = 'ENOENT';
        throw err;
      }
      files.set(dst, files.get(src));
      files.delete(src);
    },
    access: async (p) => {
      record('access', [p]);
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
    },
    unlink: async (p) => {
      record('unlink', [p]);
      files.delete(p);
    },
    readdir: async (p) => {
      record('readdir', [p]);
      // Return any "files" whose paths start with `${p}/`
      const out = [];
      for (const k of files.keys()) {
        if (k.startsWith(p + '/')) out.push(k.slice(p.length + 1));
      }
      return out;
    },
    stat: async (p) => {
      record('stat', [p]);
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      const content = files.get(p);
      return { size: Buffer.byteLength(content), mtime: now, isFile: () => true };
    },
    exec: async (cmd, options) => {
      record('exec', [cmd, options]);
      maybeFail('exec');
      return { stdout: 'ok', stderr: '' };
    },
    now: () => now
  };
}

/**
 * Mock generator — bypasses DB and key file, returns canned output.
 */
function makeMockGenerator(output = '[Interface]\nMOCK CONFIG\n') {
  let callCount = 0;
  const gen = async ({ models, privateKeyPath }) => {
    callCount++;
    return { config: output, peerCount: 3 };
  };
  gen.callCount = () => callCount;
  return gen;
}

// ─── Tests ────────────────────────────────────────────────────────────────

test('applyWg1Config with dryRun returns config without writing', async () => {
  const io = makeMockIo();
  const gen = makeMockGenerator();
  const r = await applyWg1Config({ models: {}, dryRun: true, io, generator: gen });
  assert.equal(r.dryRun, true);
  assert.equal(r.applied, false);
  assert.equal(r.backupPath, null);
  assert.equal(r.peerCount, 3);
  assert.match(r.config, /MOCK CONFIG/);
  // No filesystem writes
  assert.equal(io.calls.filter((c) => c.name === 'writeFile').length, 0);
  assert.equal(io.calls.filter((c) => c.name === 'rename').length, 0);
  assert.equal(io.calls.filter((c) => c.name === 'exec').length, 0);
});

test('applyWg1Config fresh install (no existing config) skips backup', async () => {
  const io = makeMockIo(); // no initial files
  const gen = makeMockGenerator();
  const r = await applyWg1Config({ models: {}, io, generator: gen });
  assert.equal(r.applied, true);
  assert.equal(r.backupPath, null, 'no backup when nothing to back up');
  // Sequence: access (probing for old config) → writeFile (tmp) → rename →
  // exec (wg syncconf) → exec (ip route show for syncCustomerLanRoutes)
  const seq = io.calls.map((c) => c.name);
  assert.deepEqual(seq, ['access', 'writeFile', 'rename', 'exec', 'exec'],
    `expected access→writeFile→rename→exec→exec, got ${seq.join('→')}`);
});

test('applyWg1Config update (existing config) creates backup then writes', async () => {
  const io = makeMockIo({
    initialFiles: { [DEFAULT_CONFIG_PATH]: 'OLD CONFIG' }
  });
  const gen = makeMockGenerator('NEW CONFIG');
  const r = await applyWg1Config({ models: {}, io, generator: gen });
  assert.equal(r.applied, true);
  assert.match(r.backupPath, /^\/etc\/wireguard\/wg1\.conf\.bak-/);
  // Backup file contains old content
  assert.equal(io.files.get(r.backupPath), 'OLD CONFIG');
  // Active config now has new content
  assert.equal(io.files.get(DEFAULT_CONFIG_PATH), 'NEW CONFIG');
  // Sequence: access → copyFile (backup) → writeFile (tmp) → rename →
  // exec (wg syncconf) → exec (ip route show for syncCustomerLanRoutes)
  const seq = io.calls.map((c) => c.name);
  assert.deepEqual(seq, ['access', 'copyFile', 'writeFile', 'rename', 'exec', 'exec']);
});

test('applyWg1Config writes new config with mode 0600', async () => {
  const io = makeMockIo();
  const gen = makeMockGenerator();
  await applyWg1Config({ models: {}, io, generator: gen });
  const writeCall = io.calls.find((c) => c.name === 'writeFile');
  assert.ok(writeCall, 'writeFile should have been called');
  assert.equal(writeCall.args[2]?.mode, 0o600, 'writeFile must request mode 0600');
});

test('applyWg1Config runs `wg syncconf wg1` after writing', async () => {
  const io = makeMockIo();
  const gen = makeMockGenerator();
  await applyWg1Config({ models: {}, io, generator: gen });
  const execCall = io.calls.find((c) => c.name === 'exec');
  assert.ok(execCall, 'exec should have been called');
  assert.match(execCall.args[0], /wg syncconf wg1 <\(wg-quick strip wg1\)/);
});

test('applyWg1Config uses custom interfaceName when provided', async () => {
  const io = makeMockIo();
  const gen = makeMockGenerator();
  await applyWg1Config({ models: {}, interfaceName: 'wg99', io, generator: gen });
  const execCall = io.calls.find((c) => c.name === 'exec');
  assert.match(execCall.args[0], /wg syncconf wg99 <\(wg-quick strip wg99\)/);
});

test('applyWg1Config rolls back from backup on rename failure', async () => {
  const io = makeMockIo({
    initialFiles: { [DEFAULT_CONFIG_PATH]: 'OLD CONFIG' },
    failures: { rename: 'EACCES' }
  });
  const gen = makeMockGenerator('NEW CONFIG');
  await assert.rejects(
    () => applyWg1Config({ models: {}, io, generator: gen }),
    (err) => {
      assert.match(err.message, /applyWg1Config failed/);
      assert.match(err.message, /rolled back from backup/);
      return true;
    }
  );
  // After rollback, the active config should be the original
  // (copied back from the backup we made before the failed rename)
  assert.equal(io.files.get(DEFAULT_CONFIG_PATH), 'OLD CONFIG');
});

test('applyWg1Config rolls back from backup on exec (syncconf) failure', async () => {
  const io = makeMockIo({
    initialFiles: { [DEFAULT_CONFIG_PATH]: 'OLD CONFIG' },
    failures: { exec: 'wg syncconf rejected the config' }
  });
  const gen = makeMockGenerator('NEW CONFIG');
  await assert.rejects(
    () => applyWg1Config({ models: {}, io, generator: gen }),
    /applyWg1Config failed/
  );
  // After rollback, active config should be back to OLD CONFIG
  assert.equal(io.files.get(DEFAULT_CONFIG_PATH), 'OLD CONFIG');
});

test('applyWg1Config reports rollback failure when both primary and recovery fail', async () => {
  // Primary: rename fails. Rollback (atomic via tmp+rename — audit fix P2 #7):
  // make the rollback's writeFile fail so the recovery aborts.
  const io = makeMockIo({
    initialFiles: { [DEFAULT_CONFIG_PATH]: 'OLD CONFIG' }
  });

  // First writeFile (writing new config to tmp) succeeds, second writeFile
  // (rollback's tmp write) fails. Wrap writeFile to count.
  let writeCount = 0;
  const originalWrite = io.writeFile;
  io.writeFile = async (...args) => {
    writeCount++;
    if (writeCount === 2) throw new Error('Disk full during rollback');
    return originalWrite(...args);
  };
  // Primary path fails at rename step.
  io.failures.rename = 'EACCES';

  const gen = makeMockGenerator('NEW CONFIG');
  await assert.rejects(
    () => applyWg1Config({ models: {}, io, generator: gen }),
    (err) => {
      assert.match(err.message, /rollback ALSO failed/);
      return true;
    }
  );
});

test('applyWg1Config requires models option', async () => {
  await assert.rejects(
    () => applyWg1Config({}),
    /requires \{ models \}/
  );
});

test('applyWg1Config fresh install failure: error message says "no backup available"', async () => {
  // No initial file → no backup. exec fails after write.
  const io = makeMockIo({ failures: { exec: 'syncconf rejected' } });
  const gen = makeMockGenerator();
  await assert.rejects(
    () => applyWg1Config({ models: {}, io, generator: gen }),
    (err) => {
      // Must NOT lie about rolling back from a backup that doesn't exist
      assert.match(err.message, /no backup available/);
      assert.doesNotMatch(err.message, /rolled back from backup/);
      assert.equal(err.backupPath, null);
      assert.equal(err.rollbackStatus, 'no backup available (fresh install) — config state may be partial');
      return true;
    }
  );
});

// ─── rollbackToBackup ───────────────────────────────────────────────────

test('rollbackToBackup restores from backup and runs syncconf', async () => {
  const backupPath = '/etc/wireguard/wg1.conf.bak-2026-05-01T00-00-00-000Z';
  const io = makeMockIo({
    initialFiles: {
      [DEFAULT_CONFIG_PATH]: 'CURRENT',
      [backupPath]: 'OLD BACKUP'
    }
  });
  const r = await rollbackToBackup({ backupPath, io });
  assert.equal(r.restored, true);
  assert.equal(io.files.get(DEFAULT_CONFIG_PATH), 'OLD BACKUP');
  const execCall = io.calls.find((c) => c.name === 'exec');
  assert.match(execCall.args[0], /wg syncconf wg1/);
});

test('rollbackToBackup throws if backup path is missing', async () => {
  await assert.rejects(
    () => rollbackToBackup({ backupPath: '/nonexistent', io: makeMockIo() }),
    /Backup not found/
  );
});

test('rollbackToBackup requires backupPath argument', async () => {
  await assert.rejects(
    () => rollbackToBackup({ io: makeMockIo() }),
    /requires \{ backupPath \}/
  );
});

// ─── listBackups ────────────────────────────────────────────────────────

test('listBackups returns backups sorted newest-first', async () => {
  const io = makeMockIo({
    initialFiles: {
      '/etc/wireguard/wg1.conf': 'current',
      '/etc/wireguard/wg1.conf.bak-2026-05-01T00-00-00-000Z': 'older',
      '/etc/wireguard/wg1.conf.bak-2026-05-12T08-15-30-000Z': 'newer',
      '/etc/wireguard/notabackup': 'noise'
    }
  });
  const backups = await listBackups({ io });
  assert.equal(backups.length, 2);
  // Both should have backup-pattern paths
  for (const b of backups) {
    assert.match(b.path, /\.bak-/);
    assert.ok(b.sizeBytes > 0);
    assert.ok(b.modifiedAt instanceof Date);
  }
});

test('listBackups returns empty array if directory is missing', async () => {
  // Mock readdir to return ENOENT
  const io = makeMockIo();
  io.readdir = async () => {
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  };
  const r = await listBackups({ io });
  assert.deepEqual(r, []);
});

// ─── Helpers ────────────────────────────────────────────────────────────

test('buildBackupPath produces shell-safe ISO timestamp', () => {
  const p = buildBackupPath('/etc/wireguard/wg1.conf', new Date('2026-05-12T08:15:30.500Z'));
  assert.match(p, /^\/etc\/wireguard\/wg1\.conf\.bak-2026-05-12T08-15-30-500Z$/);
  // No colons (shell-special)
  assert.doesNotMatch(p, /:/);
});

test('buildTmpPath produces unique path with provided random bytes', () => {
  const p = buildTmpPath('/etc/wireguard/wg1.conf', 'abc123');
  assert.equal(p, '/etc/wireguard/wg1.conf.new.abc123');
});

test('fileExists returns true for existing files, false for missing', async () => {
  const io = makeMockIo({ initialFiles: { '/etc/wireguard/wg1.conf': 'x' } });
  assert.equal(await fileExists(io, '/etc/wireguard/wg1.conf'), true);
  assert.equal(await fileExists(io, '/nonexistent'), false);
});

// ─── interfaceName validation (security: command injection defense) ──────

test('assertValidInterfaceName accepts wg0, wg1, wg99, eth0-like names', () => {
  assert.doesNotThrow(() => assertValidInterfaceName('wg0'));
  assert.doesNotThrow(() => assertValidInterfaceName('wg1'));
  assert.doesNotThrow(() => assertValidInterfaceName('wg99'));
  assert.doesNotThrow(() => assertValidInterfaceName('customer-tun'));
  assert.doesNotThrow(() => assertValidInterfaceName('my_tunnel'));
});

test('assertValidInterfaceName rejects shell-special characters (CRITICAL)', () => {
  // Each of these would be a shell injection vector if interpolated into exec
  assert.throws(() => assertValidInterfaceName('wg1; rm -rf /'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('wg1$(whoami)'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('wg1`id`'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('wg1 && evil'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('wg1|sh'), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('../wg1'), /Invalid.*interface name/);
});

test('assertValidInterfaceName rejects empty + too-long names (IFNAMSIZ=16)', () => {
  assert.throws(() => assertValidInterfaceName(''), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName('a'.repeat(16)), /Invalid.*interface name/);
  assert.doesNotThrow(() => assertValidInterfaceName('a'.repeat(15)));
});

test('assertValidInterfaceName rejects non-string', () => {
  assert.throws(() => assertValidInterfaceName(null), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName(undefined), /Invalid.*interface name/);
  assert.throws(() => assertValidInterfaceName(123), /Invalid.*interface name/);
});

test('applyWg1Config rejects invalid interfaceName before any I/O', async () => {
  const io = makeMockIo();
  const gen = makeMockGenerator();
  await assert.rejects(
    () => applyWg1Config({ models: {}, interfaceName: 'wg1; rm -rf /', io, generator: gen }),
    /Invalid.*interface name/
  );
  // Critically: no I/O calls happened — we rejected BEFORE touching anything.
  // Generator may have been called (validation is before generator in current
  // impl), but no fs/exec calls. Verify the actual invariant we care about:
  assert.equal(io.calls.filter((c) => c.name === 'writeFile').length, 0);
  assert.equal(io.calls.filter((c) => c.name === 'rename').length, 0);
  assert.equal(io.calls.filter((c) => c.name === 'exec').length, 0);
});

test('rollbackToBackup rejects invalid interfaceName', async () => {
  const io = makeMockIo({
    initialFiles: { '/etc/wireguard/wg1.conf.bak-x': 'data' }
  });
  await assert.rejects(
    () => rollbackToBackup({
      backupPath: '/etc/wireguard/wg1.conf.bak-x',
      interfaceName: 'wg1$(whoami)',
      io
    }),
    /Invalid.*interface name/
  );
});

// ─── exec timeout ────────────────────────────────────────────────────────

test('applyWg1Config passes timeout to exec', async () => {
  const io = makeMockIo();
  const gen = makeMockGenerator();
  await applyWg1Config({ models: {}, io, generator: gen });
  const execCall = io.calls.find((c) => c.name === 'exec');
  assert.ok(execCall, 'exec should have been called');
  assert.equal(execCall.args[1].timeout, DEFAULT_EXEC_TIMEOUT_MS,
    `exec must include timeout: ${DEFAULT_EXEC_TIMEOUT_MS}`);
  assert.equal(execCall.args[1].shell, '/bin/bash');
});

test('applyWg1Config uses custom execTimeoutMs when provided', async () => {
  const io = makeMockIo();
  const gen = makeMockGenerator();
  await applyWg1Config({ models: {}, io, generator: gen, execTimeoutMs: 5000 });
  const execCall = io.calls.find((c) => c.name === 'exec');
  assert.equal(execCall.args[1].timeout, 5000);
});

test('rollbackToBackup passes timeout to exec', async () => {
  const io = makeMockIo({
    initialFiles: {
      '/etc/wireguard/wg1.conf.bak-x': 'data'
    }
  });
  await rollbackToBackup({ backupPath: '/etc/wireguard/wg1.conf.bak-x', io });
  const execCall = io.calls.find((c) => c.name === 'exec');
  assert.equal(execCall.args[1].timeout, DEFAULT_EXEC_TIMEOUT_MS);
});

test('DEFAULT_EXEC_TIMEOUT_MS is set to a reasonable value', () => {
  assert.ok(DEFAULT_EXEC_TIMEOUT_MS >= 5_000, 'timeout should be ≥5s to avoid spurious failures');
  assert.ok(DEFAULT_EXEC_TIMEOUT_MS <= 60_000, 'timeout should be ≤60s to avoid hanging route handlers');
});

// ─── syncCustomerLanRoutes ────────────────────────────────────────────────

/**
 * Specialized mock for syncCustomerLanRoutes — lets each test wire its own
 * `ip route show` stdout + record every exec call to assert add/del commands.
 */
function makeRouteSyncMockIo({ routeShowStdout = '', execFailures = {} } = {}) {
  const calls = [];
  return {
    calls,
    exec: async (cmd, options) => {
      calls.push({ cmd, options });
      // Reject if a registered failure matches this command
      for (const [pattern, errMsg] of Object.entries(execFailures)) {
        if (cmd.includes(pattern)) {
          const err = new Error(errMsg);
          err.stderr = errMsg;
          throw err;
        }
      }
      if (cmd.startsWith('ip -4 route show')) {
        return { stdout: routeShowStdout, stderr: '' };
      }
      return { stdout: '', stderr: '' };
    }
  };
}

test('syncCustomerLanRoutes adds route for an active tunnel with customer_lan_cidr', async () => {
  const io = makeRouteSyncMockIo({ routeShowStdout: '' });
  const r = await syncCustomerLanRoutes({
    tunnels: [{ id: 'v7', status: 'active', customer_lan_cidr: '192.168.0.0/24' }],
    io
  });
  assert.deepEqual(r.added, ['192.168.0.0/24']);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.errors, []);
  // Verify the actual command issued
  const addCall = io.calls.find((c) => c.cmd.startsWith('ip route add'));
  assert.ok(addCall);
  assert.equal(addCall.cmd, 'ip route add 192.168.0.0/24 dev wg1');
});

test('syncCustomerLanRoutes skips tunnels with status=disabled or revoked', async () => {
  const io = makeRouteSyncMockIo();
  await syncCustomerLanRoutes({
    tunnels: [
      { id: 'a', status: 'disabled', customer_lan_cidr: '192.168.10.0/24' },
      { id: 'b', status: 'revoked', customer_lan_cidr: '192.168.20.0/24' }
    ],
    io
  });
  // No "ip route add" calls should have happened
  const addCalls = io.calls.filter((c) => c.cmd.startsWith('ip route add'));
  assert.equal(addCalls.length, 0);
});

test('syncCustomerLanRoutes skips tunnels with no customer_lan_cidr (null/undefined)', async () => {
  const io = makeRouteSyncMockIo();
  const r = await syncCustomerLanRoutes({
    tunnels: [
      { id: 'a', status: 'active', customer_lan_cidr: null },
      { id: 'b', status: 'active' }  // undefined
    ],
    io
  });
  assert.deepEqual(r.added, []);
  const addCalls = io.calls.filter((c) => c.cmd.startsWith('ip route add'));
  assert.equal(addCalls.length, 0);
});

test('syncCustomerLanRoutes removes routes for CIDRs no longer in active tunnels', async () => {
  // Current state: wg1 has both 192.168.0.0/24 (still desired) and 10.50.0.0/24 (no longer desired)
  const io = makeRouteSyncMockIo({
    routeShowStdout: [
      '10.20.0.0/16 proto kernel scope link src 10.20.0.1',
      '192.168.0.0/24 scope link',
      '10.50.0.0/24 scope link'
    ].join('\n')
  });
  const r = await syncCustomerLanRoutes({
    tunnels: [
      { id: 'v7', status: 'active', customer_lan_cidr: '192.168.0.0/24' }
      // 10.50.0.0/24 is no longer claimed by anyone
    ],
    io
  });
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, ['10.50.0.0/24']);
  assert.deepEqual(r.unchanged, ['192.168.0.0/24']);
  const delCall = io.calls.find((c) => c.cmd.startsWith('ip route del'));
  assert.ok(delCall);
  assert.equal(delCall.cmd, 'ip route del 10.50.0.0/24 dev wg1');
});

test('syncCustomerLanRoutes skips wg1\'s own subnet (10.20.0.0/16) from removal', async () => {
  // wg-quick installs 10.20.0.0/16 automatically; we must NOT touch it.
  const io = makeRouteSyncMockIo({
    routeShowStdout: '10.20.0.0/16 proto kernel scope link src 10.20.0.1\n'
  });
  const r = await syncCustomerLanRoutes({ tunnels: [], io });
  assert.deepEqual(r.removed, [], 'must not remove the wg1 infra subnet');
  const delCalls = io.calls.filter((c) => c.cmd.startsWith('ip route del'));
  assert.equal(delCalls.length, 0);
});

test('syncCustomerLanRoutes NEVER deletes /32 host routes (wg-quick per-peer routes)', async () => {
  // Critical fragility flagged by QA review on PR #148: wg-quick installs a
  // /32 host route on wg1 for every active peer's customer_tunnel_ip (e.g.
  // 10.20.0.2/32 for V7). Modern iproute2 STRIPS the /32 suffix on display
  // ("10.20.0.2 dev wg1 scope link") so the regex wouldn't match anyway —
  // but older distros / patched builds emit "10.20.0.2/32 ...". If THAT
  // ever lands in our parser, the host route is in `current`, not in
  // `desired`, so we'd issue `ip route del 10.20.0.2/32 dev wg1` and KILL
  // cryptokey-routed traffic for that peer. Hard-cap parser at /30.
  const io = makeRouteSyncMockIo({
    routeShowStdout: [
      '10.20.0.0/16 proto kernel scope link src 10.20.0.1',
      '10.20.0.2/32 dev wg1 scope link',  // ← V7 peer's host route (older iproute2 format)
      '10.20.0.6/32 dev wg1 scope link',  // ← hypothetical 2nd customer's host route
      '192.168.0.0/24 scope link'         // ← V7's customer LAN (what we DO manage)
    ].join('\n')
  });
  const r = await syncCustomerLanRoutes({
    tunnels: [{ id: 'v7', status: 'active', customer_lan_cidr: '192.168.0.0/24' }],
    io
  });
  // The /32 host routes must NOT appear in removed
  assert.ok(!r.removed.some((c) => c.endsWith('/32')),
    'host routes (/32) must NEVER be removed by syncCustomerLanRoutes');
  // Verify no ip route del for any /32
  const delsAgainstHostRoutes = io.calls.filter(
    (c) => c.cmd.startsWith('ip route del') && c.cmd.includes('/32')
  );
  assert.equal(delsAgainstHostRoutes.length, 0,
    'must not issue ip route del for any /32 host route');
});

test('syncCustomerLanRoutes ignores /31 routes too (point-to-point edge case)', async () => {
  // /31s are valid for point-to-point links per RFC 3021; not used by
  // customer-tunnels but a kernel could in theory have one on wg1.
  // Same defense applies: hard prefix cap at /30.
  const io = makeRouteSyncMockIo({
    routeShowStdout: '10.20.0.0/31 dev wg1 scope link\n'
  });
  const r = await syncCustomerLanRoutes({ tunnels: [], io });
  assert.deepEqual(r.removed, []);
});

test('syncCustomerLanRoutes is idempotent — no change when desired matches current', async () => {
  const io = makeRouteSyncMockIo({
    routeShowStdout: '192.168.0.0/24 scope link\n10.20.0.0/16 proto kernel scope link src 10.20.0.1\n'
  });
  const r = await syncCustomerLanRoutes({
    tunnels: [{ id: 'v7', status: 'active', customer_lan_cidr: '192.168.0.0/24' }],
    io
  });
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.unchanged, ['192.168.0.0/24']);
  // No add or del commands should fire
  const writeCalls = io.calls.filter((c) => /ip route (add|del)/.test(c.cmd));
  assert.equal(writeCalls.length, 0);
});

test('syncCustomerLanRoutes treats "File exists" on add as idempotent success', async () => {
  const io = makeRouteSyncMockIo({
    routeShowStdout: '',
    execFailures: { 'ip route add 192.168.0.0/24': 'RTNETLINK answers: File exists' }
  });
  const r = await syncCustomerLanRoutes({
    tunnels: [{ id: 'v7', status: 'active', customer_lan_cidr: '192.168.0.0/24' }],
    io
  });
  assert.deepEqual(r.errors, [], 'File exists is not a real error');
});

test('syncCustomerLanRoutes treats "No such process" on del as idempotent success', async () => {
  const io = makeRouteSyncMockIo({
    routeShowStdout: '10.50.0.0/24 scope link',
    execFailures: { 'ip route del': 'RTNETLINK answers: No such process' }
  });
  const r = await syncCustomerLanRoutes({ tunnels: [], io });
  assert.deepEqual(r.errors, [], 'No such process is not a real error');
});

test('syncCustomerLanRoutes captures real errors in result.errors (non-fatal)', async () => {
  const io = makeRouteSyncMockIo({
    routeShowStdout: '',
    execFailures: { 'ip route add': 'permission denied' }
  });
  const r = await syncCustomerLanRoutes({
    tunnels: [{ id: 'v7', status: 'active', customer_lan_cidr: '192.168.0.0/24' }],
    io
  });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /permission denied/);
  // Function must NOT throw — errors are reported, not raised
});

test('syncCustomerLanRoutes returns errors (not throws) when ip route show fails', async () => {
  const io = makeRouteSyncMockIo({
    execFailures: { 'ip -4 route show': 'Cannot get RTA: -ENODEV' }
  });
  const r = await syncCustomerLanRoutes({
    tunnels: [{ id: 'v7', status: 'active', customer_lan_cidr: '192.168.0.0/24' }],
    io
  });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /ip route show failed/);
  // Without current routes, the function bails out — desired routes are NOT added
  // (because we don't know what state we're in)
  assert.deepEqual(r.added, []);
});

test('syncCustomerLanRoutes refuses to interpolate a malformed CIDR (defense-in-depth)', async () => {
  const io = makeRouteSyncMockIo();
  const r = await syncCustomerLanRoutes({
    tunnels: [
      { id: 'evil', status: 'active', customer_lan_cidr: '192.168.0.0/24; rm -rf /' }
    ],
    io
  });
  assert.equal(r.added.length, 0, 'malformed CIDR must NOT be added');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /CIDR shape check/);
  // Make sure NO ip route add was issued for the malformed input
  const addCalls = io.calls.filter((c) => c.cmd.startsWith('ip route add'));
  assert.equal(addCalls.length, 0);
});

test('syncCustomerLanRoutes uses custom interfaceName when provided', async () => {
  const io = makeRouteSyncMockIo();
  await syncCustomerLanRoutes({
    tunnels: [{ id: 't', status: 'active', customer_lan_cidr: '192.168.0.0/24' }],
    interfaceName: 'wg42',
    io
  });
  const addCall = io.calls.find((c) => c.cmd.startsWith('ip route add'));
  assert.equal(addCall.cmd, 'ip route add 192.168.0.0/24 dev wg42');
});

test('syncCustomerLanRoutes rejects invalid interface names (shell-injection defense)', async () => {
  const io = makeRouteSyncMockIo();
  await assert.rejects(
    () => syncCustomerLanRoutes({
      tunnels: [],
      interfaceName: 'wg1; rm -rf /',
      io
    }),
    /Invalid.*interface name/
  );
});

test('syncCustomerLanRoutes throws on non-array tunnels (clean error)', async () => {
  const io = makeRouteSyncMockIo();
  await assert.rejects(
    () => syncCustomerLanRoutes({ tunnels: null, io }),
    /tunnels must be an array/
  );
});

test('SAFE_CIDR_REGEX accepts well-formed CIDRs, rejects shell-special chars', () => {
  assert.ok(SAFE_CIDR_REGEX.test('192.168.0.0/24'));
  assert.ok(SAFE_CIDR_REGEX.test('10.0.0.0/8'));
  assert.ok(SAFE_CIDR_REGEX.test('10.20.0.2/32'));
  assert.ok(!SAFE_CIDR_REGEX.test('192.168.0.0/24; rm -rf /'));
  assert.ok(!SAFE_CIDR_REGEX.test('192.168.0.0'));  // no prefix
  assert.ok(!SAFE_CIDR_REGEX.test('not-a-cidr'));
});

test('INFRA_WG1_SUBNET matches the wireguardGenerator default interface CIDR', () => {
  // If these ever diverge, syncCustomerLanRoutes would try to remove the
  // wg-quick-managed route or fail to skip it — both bad. Import the
  // generator's value and verify our applier's constant tracks the same
  // network address.
  const { DEFAULT_INTERFACE_ADDRESS } = require('./wireguardGenerator');
  // DEFAULT_INTERFACE_ADDRESS is the interface IP+mask (e.g. "10.20.0.1/16");
  // INFRA_WG1_SUBNET is the network address (e.g. "10.20.0.0/16"). Derive
  // the expected network address from the generator's source of truth.
  const m = DEFAULT_INTERFACE_ADDRESS.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
  assert.ok(m, `DEFAULT_INTERFACE_ADDRESS ${DEFAULT_INTERFACE_ADDRESS} unparseable`);
  const prefix = Number(m[5]);
  const ipUint = ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0;
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const network = (ipUint & mask) >>> 0;
  const expectedSubnet = `${(network >>> 24) & 0xFF}.${(network >>> 16) & 0xFF}.${(network >>> 8) & 0xFF}.${network & 0xFF}/${prefix}`;
  assert.equal(INFRA_WG1_SUBNET, expectedSubnet,
    `INFRA_WG1_SUBNET (${INFRA_WG1_SUBNET}) must match the network of ` +
    `DEFAULT_INTERFACE_ADDRESS (${DEFAULT_INTERFACE_ADDRESS} → network ${expectedSubnet})`);
});

// ─── applyWg1Config integration with syncCustomerLanRoutes ────────────────

test('applyWg1Config passes tunnels from generator into syncCustomerLanRoutes', async () => {
  const io = makeMockIo();
  const tunnels = [
    { id: 'v7', status: 'active', customer_lan_cidr: '192.168.0.0/24', customer_pubkey: 'pk' }
  ];
  // Custom generator that returns tunnels (mirrors real generator output shape)
  const gen = async () => ({ config: 'MOCK', peerCount: 1, tunnels });
  const r = await applyWg1Config({ models: {}, io, generator: gen });
  assert.equal(r.applied, true);
  assert.ok(r.routeSync, 'routeSync result must be returned');
  // The 2nd exec call is `ip -4 route show`, then `ip route add`
  const execCalls = io.calls.filter((c) => c.name === 'exec').map((c) => c.args[0]);
  assert.ok(execCalls.some((cmd) => cmd.startsWith('ip -4 route show')),
    'expected ip route show command');
  assert.ok(execCalls.some((cmd) => cmd === 'ip route add 192.168.0.0/24 dev wg1'),
    'expected ip route add 192.168.0.0/24');
});

test('applyWg1Config syncCustomerLanRoutes failure does NOT roll back the apply', async () => {
  const io = makeMockIo();
  const tunnels = [
    { id: 'v7', status: 'active', customer_lan_cidr: '192.168.0.0/24', customer_pubkey: 'pk' }
  ];
  // Mock the FIRST exec (wg syncconf) success, SECOND (ip route show) failure
  let execCount = 0;
  const originalExec = io.exec;
  io.exec = async (cmd, options) => {
    io.calls.push({ name: 'exec', args: [cmd, options] });
    execCount++;
    if (cmd.startsWith('ip -4 route show')) {
      throw new Error('Cannot get RTA: -ENODEV');
    }
    return { stdout: 'ok', stderr: '' };
  };
  const gen = async () => ({ config: 'MOCK', peerCount: 1, tunnels });
  const r = await applyWg1Config({ models: {}, io, generator: gen });
  // Apply itself still succeeded — route-sync failure is non-fatal
  assert.equal(r.applied, true);
  assert.ok(r.routeSync.errors.length >= 1);
});

// ─── Run sequentially ───────────────────────────────────────────────────

(async () => {
  for (const t of testQueue) await t();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
