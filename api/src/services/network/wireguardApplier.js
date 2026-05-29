/**
 * WireGuard config applier — the only component in the customer-tunnels
 * feature with filesystem + process side effects.
 *
 * Reads tunnel state from DB → renders wg1.conf via wireguardGenerator →
 * writes the config atomically → reloads the wg1 interface via
 * `wg syncconf`. On any failure during the write or reload, restores the
 * previous config from backup.
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Atomic write protocol
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  1. Render new config (via wireguardGenerator.generateWg1Config)
 *  2. If old config exists, copy it to `<configPath>.bak-<timestamp>`
 *  3. Write new config to `<configPath>.new.<timestamp>` (mode 0600)
 *  4. fs.rename(tmpPath, configPath) — atomic on same filesystem
 *  5. exec `bash -c "wg syncconf wg1 <(wg-quick strip wg1)"` — hot-reload
 *     (only changed peers are updated; existing tunnels stay connected)
 *  6. On step 4 or 5 failure: restore from backup, re-run syncconf, throw
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Why dependency-injected fs + exec
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  The fs and exec implementations are accepted via opts.io so tests can
 *  inject stubs that record calls + simulate failure modes (write failure,
 *  rename failure, exec failure) without needing real /etc/wireguard or
 *  a wg1 interface to exist. Production callers use the defaults.
 *
 *  This is NOT a replacement for integration tests — tests verify the
 *  ORCHESTRATION sequence (read-old → backup → write → rename → exec, or
 *  failure → restore → re-exec). The actual `wg syncconf` command behaviour
 *  must be verified via a manual smoke test on a real VPS with wg1 bootstrap
 *  in place.
 *
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Security
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  - wg1.conf is written with mode 0600 (root-only) — it contains the
 *    server's private key and every customer's PSK.
 *  - Tmp file uses a random suffix to avoid TOCTOU on shared /etc/wireguard.
 *  - exec runs `wg-quick strip wg1 | wg syncconf wg1 -` (no shell variable
 *    interpolation, no user input in the command).
 *  - Backups are kept at mode 0600.
 *
 *
 * See: docs/features/customer-tunnels.md for the broader design.
 */

'use strict';

const fsPromises = require('node:fs/promises');
const { exec: nodeExec } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

const { generateWg1Config } = require('./wireguardGenerator');
const { INTERFACE_NAME_REGEX, assertValidInterfaceName } = require('./wireguardCommon');

const DEFAULT_CONFIG_PATH = '/etc/wireguard/wg1.conf';
const DEFAULT_INTERFACE = 'wg1';
const DEFAULT_FILE_MODE = 0o600;
const TMP_SUFFIX_RANDOM_BYTES = 8;

// Strict CIDR-shape regex used by syncCustomerLanRoutes as defense-in-depth
// before passing a CIDR value into `ip route add/del`. The customer_lan_cidr
// field is already validated at the route layer + model layer; this check
// ensures NO non-CIDR value can flow into a shell argument even if a future
// caller bypasses upstream validation.
const SAFE_CIDR_REGEX = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

// The wg1 interface's own address — never managed by syncCustomerLanRoutes.
// wg-quick installs this automatically when the interface comes up.
const INFRA_WG1_SUBNET = '10.20.0.0/16';

// `wg syncconf` typically completes in <1 second. 30s is a generous ceiling
// that prevents the route handler from hanging if wg-quick wedges on some
// firmware/version edge case.
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;

const execAsync = promisify(nodeExec);

/**
 * Default IO injection — production callers don't pass these.
 */
const DEFAULT_IO = Object.freeze({
  readFile: fsPromises.readFile.bind(fsPromises),
  writeFile: fsPromises.writeFile.bind(fsPromises),
  copyFile: fsPromises.copyFile.bind(fsPromises),
  rename: fsPromises.rename.bind(fsPromises),
  access: fsPromises.access.bind(fsPromises),
  unlink: fsPromises.unlink.bind(fsPromises),
  readdir: fsPromises.readdir.bind(fsPromises),
  stat: fsPromises.stat.bind(fsPromises),
  exec: execAsync,
  now: () => new Date()
});

/**
 * Check whether a file exists. Returns boolean, never throws.
 */
async function fileExists(io, p) {
  try {
    await io.access(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Build the timestamped backup path for a given config path.
 * Example: /etc/wireguard/wg1.conf  →  /etc/wireguard/wg1.conf.bak-2026-05-12T08-15-30-000Z
 *
 * We replace ':' with '-' in the ISO timestamp so the path doesn't contain
 * shell-special characters (matters when ops grep/find/ls these files).
 */
function buildBackupPath(configPath, when) {
  const stamp = when.toISOString().replace(/[:.]/g, '-');
  return `${configPath}.bak-${stamp}`;
}

/**
 * Build a tmp path next to the config (same filesystem → atomic rename works).
 */
function buildTmpPath(configPath, randomBytes) {
  const rand = Buffer.isBuffer(randomBytes)
    ? randomBytes.toString('hex')
    : String(randomBytes);
  return `${configPath}.new.${rand}`;
}

/**
 * Sync kernel routes for customer LAN CIDRs.
 *
 * For each active tunnel that has a `customer_lan_cidr` set, ensure a
 * `ip route` entry exists pointing that CIDR at the wg1 interface. Without
 * this, the kernel routes responses (e.g. SIP 401 challenges) to the
 * customer's LAN via the system default route (eth0 → public internet),
 * where they get dropped — the tunnel is "open" but unidirectional.
 *
 * Persistence note: this function installs routes at RUNTIME via
 * `ip route add`. The routes survive across `wg syncconf` (which only
 * touches the kernel's WireGuard module, not the routing table). They
 * do NOT survive a reboot — but they don't need to: `wg-quick@wg1` reads
 * `wg1.conf` at boot and re-adds routes for every peer's AllowedIPs
 * (which include `customer_lan_cidr`, written there by the generator).
 * So persistence is handled by wg-quick at boot, and this function
 * handles the apply-without-restart case during normal operation.
 *
 * Idempotent: running multiple times is safe. Routes already in place
 * stay (the "File exists" error from `ip route add` is treated as success).
 * Routes for customer LANs no longer in the active-tunnel set are removed.
 *
 * Failures are LOGGED but do NOT roll back the wg1.conf apply — the tunnel
 * itself is already up; route sync is a follow-on best-effort.
 *
 * Pre-condition: wg1 interface exists (i.e. `applyWg1Config` succeeded).
 *
 * Security: each customer_lan_cidr is re-validated against SAFE_CIDR_REGEX
 * before being interpolated into the `ip route` command — defense-in-depth
 * against future code paths bypassing upstream validation.
 *
 * @param {object} opts
 * @param {object[]} opts.tunnels - active tunnel rows (must include status + customer_lan_cidr)
 * @param {string} [opts.interfaceName='wg1']
 * @param {number} [opts.execTimeoutMs]
 * @param {object} [opts.io=DEFAULT_IO]
 * @returns {Promise<{added: string[], removed: string[], unchanged: string[], errors: string[]}>}
 */
async function syncCustomerLanRoutes({
  tunnels,
  interfaceName = DEFAULT_INTERFACE,
  execTimeoutMs = DEFAULT_EXEC_TIMEOUT_MS,
  io = DEFAULT_IO
} = {}) {
  if (!Array.isArray(tunnels)) {
    throw new Error('syncCustomerLanRoutes: tunnels must be an array');
  }
  assertValidInterfaceName(interfaceName);

  const errors = [];

  // Desired routes = active tunnels with a customer_lan_cidr
  const desired = new Set();
  for (const t of tunnels) {
    if (t.status !== 'active') continue;
    const cidr = t.customer_lan_cidr;
    if (!cidr) continue;
    if (!SAFE_CIDR_REGEX.test(cidr)) {
      errors.push(`tunnel ${t.id || t.name}: customer_lan_cidr "${cidr}" failed CIDR shape check — skipped`);
      continue;
    }
    desired.add(cidr);
  }

  // Current routes on the interface
  let stdout = '';
  try {
    const res = await io.exec(`ip -4 route show dev ${interfaceName}`, { timeout: execTimeoutMs });
    stdout = res?.stdout || '';
  } catch (err) {
    return {
      added: [],
      removed: [],
      unchanged: [],
      errors: [`ip route show failed: ${err.message}`]
    };
  }

  const current = new Set();
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^(\d{1,3}(?:\.\d{1,3}){3}\/(\d{1,2}))\b/);
    if (!m) continue;
    const cidr = m[1];
    const prefix = Number(m[2]);
    // Skip the wg1's own subnet — installed by wg-quick, not by us.
    if (cidr === INFRA_WG1_SUBNET) continue;
    // Skip host routes (/31, /32) — wg-quick installs a per-peer host route
    // for each customer's customer_tunnel_ip. Modern iproute2 strips the
    // /32 suffix on display so we wouldn't match those anyway, but distro/
    // kernel-version variance is real. Hard-cap at /30 to match customer-LAN
    // validation bounds (MIN_CUSTOMER_LAN_PREFIX..MAX_CUSTOMER_LAN_PREFIX
    // in customer-tunnels-helpers — 16-30). This makes it impossible for
    // syncCustomerLanRoutes to ever remove a wg-managed peer route, even
    // if a future Linux version starts displaying /32 routes with the suffix.
    if (prefix > 30) continue;
    current.add(cidr);
  }

  const toAdd = [...desired].filter((c) => !current.has(c));
  const toRemove = [...current].filter((c) => !desired.has(c));
  const unchanged = [...desired].filter((c) => current.has(c));

  for (const cidr of toAdd) {
    try {
      await io.exec(`ip route add ${cidr} dev ${interfaceName}`, { timeout: execTimeoutMs });
    } catch (err) {
      // "File exists" = idempotent success (route added between our check and add)
      if (/File exists/i.test(err.message || err.stderr || '')) continue;
      errors.push(`add ${cidr}: ${err.message}`);
    }
  }
  for (const cidr of toRemove) {
    // Defense-in-depth: still validate shape before passing to shell
    if (!SAFE_CIDR_REGEX.test(cidr)) {
      errors.push(`remove skipped: "${cidr}" failed CIDR shape check`);
      continue;
    }
    try {
      await io.exec(`ip route del ${cidr} dev ${interfaceName}`, { timeout: execTimeoutMs });
    } catch (err) {
      // "No such process" or "RTNETLINK answers: No such process" =
      // already gone, idempotent success.
      if (/No such (process|file)/i.test(err.message || err.stderr || '')) continue;
      errors.push(`del ${cidr}: ${err.message}`);
    }
  }

  return { added: toAdd, removed: toRemove, unchanged, errors };
}

/**
 * Apply the customer-tunnels config to the wg1 interface.
 *
 * @param {object} opts
 * @param {object} opts.models - Sequelize models registry (CustomerTunnel required)
 * @param {boolean} [opts.dryRun=false] - render only; do not write or reload
 * @param {string} [opts.configPath='/etc/wireguard/wg1.conf']
 * @param {string} [opts.interfaceName='wg1']
 * @param {string} [opts.privateKeyPath] - passed to generator
 * @param {object} [opts.io=DEFAULT_IO] - dependency injection for tests
 * @param {object} [opts.generator] - injectable generator (default: module's generateWg1Config)
 * @returns {Promise<{config: string, peerCount: number, applied: boolean,
 *                    backupPath: string|null, syncOutput: string|null,
 *                    dryRun: boolean}>}
 */
async function applyWg1Config({
  models,
  dryRun = false,
  configPath = DEFAULT_CONFIG_PATH,
  interfaceName = DEFAULT_INTERFACE,
  privateKeyPath,
  execTimeoutMs = DEFAULT_EXEC_TIMEOUT_MS,
  io = DEFAULT_IO,
  generator = generateWg1Config
} = {}) {
  if (!models) throw new Error('applyWg1Config requires { models }');
  assertValidInterfaceName(interfaceName);

  // 1. Render
  const { config, peerCount, tunnels = [] } = await generator({ models, privateKeyPath });

  if (dryRun) {
    return {
      config,
      peerCount,
      applied: false,
      backupPath: null,
      syncOutput: null,
      dryRun: true
    };
  }

  // 2. Backup existing config (if any)
  let backupPath = null;
  if (await fileExists(io, configPath)) {
    backupPath = buildBackupPath(configPath, io.now());
    await io.copyFile(configPath, backupPath);
  }

  // 3. Write new config to tmp, then atomic-rename into place.
  //    Tmp uniqueness uses ms timestamp — sufficient because the route layer
  //    serializes apply calls (one customer-tunnel mutation at a time). If
  //    concurrent applies ever become a real pattern, swap to crypto.randomBytes.
  const tmpPath = buildTmpPath(configPath, Date.now());
  let syncOutput = null;
  try {
    await io.writeFile(tmpPath, config, { mode: DEFAULT_FILE_MODE });
    await io.rename(tmpPath, configPath);

    // 4. Hot-reload wg1 — only changed peers are updated
    const syncCmd = `wg syncconf ${interfaceName} <(wg-quick strip ${interfaceName})`;
    const { stdout, stderr } = await io.exec(syncCmd, { shell: '/bin/bash', timeout: execTimeoutMs });
    syncOutput = `${stdout || ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim();
  } catch (err) {
    // 5. Rollback path — write to tmp + atomic rename (audit finding P2 #7).
    //    Previously used copyFile directly; if interrupted mid-write,
    //    configPath would be left corrupt. Mirror the forward-path's
    //    tmp+rename pattern so the rollback is also atomic.
    let rollbackError = null;
    let rollbackStatus;
    if (backupPath) {
      const rollbackTmp = buildTmpPath(configPath, `rb${Date.now()}`);
      try {
        // Read backup, write to tmp, rename — atomic at the configPath level.
        const backupBytes = await io.readFile(backupPath, 'utf8');
        await io.writeFile(rollbackTmp, backupBytes, { mode: DEFAULT_FILE_MODE });
        await io.rename(rollbackTmp, configPath);
        const syncCmd = `wg syncconf ${interfaceName} <(wg-quick strip ${interfaceName})`;
        await io.exec(syncCmd, { shell: '/bin/bash', timeout: execTimeoutMs });
        rollbackStatus = 'rolled back from backup (atomic)';
      } catch (rbErr) {
        rollbackError = rbErr;
        rollbackStatus = `rollback ALSO failed: ${rbErr.message}`;
        // Best-effort cleanup of rollback tmp
        try { await io.unlink(rollbackTmp); } catch (_) { /* ignore */ }
      }
    } else {
      // No backup → this was a fresh install. Config file may or may not
      // exist depending on which step failed. Operator must inspect.
      rollbackStatus = 'no backup available (fresh install) — config state may be partial';
    }
    // Clean up tmp if it's still around
    try { await io.unlink(tmpPath); } catch (_) { /* ignore */ }

    const err2 = new Error(`applyWg1Config failed: ${err.message} (${rollbackStatus})`);
    err2.original = err;
    err2.rollbackError = rollbackError;
    err2.backupPath = backupPath;
    err2.rollbackStatus = rollbackStatus;
    throw err2;
  }

  // 6. Sync kernel routes for customer LAN CIDRs. Non-fatal: route-sync
  //    failures don't roll back the apply (the tunnel itself is up).
  //    Captures any errors into the return value for caller visibility.
  let routeSync = null;
  try {
    routeSync = await syncCustomerLanRoutes({
      tunnels,
      interfaceName,
      execTimeoutMs,
      io
    });
  } catch (routeErr) {
    // Top-level throw (e.g. invalid interface name caught after rebuild) —
    // log on the returned object, don't propagate.
    routeSync = {
      added: [],
      removed: [],
      unchanged: [],
      errors: [`syncCustomerLanRoutes top-level failure: ${routeErr.message}`]
    };
  }

  return {
    config,
    peerCount,
    applied: true,
    backupPath,
    syncOutput,
    routeSync,
    dryRun: false
  };
}

/**
 * Manually restore a specific backup. Useful for incident response.
 *
 * @param {object} opts
 * @param {string} opts.backupPath
 * @param {string} [opts.configPath]
 * @param {string} [opts.interfaceName]
 * @param {object} [opts.io]
 * @returns {Promise<{restored: true, syncOutput: string}>}
 */
async function rollbackToBackup({
  backupPath,
  configPath = DEFAULT_CONFIG_PATH,
  interfaceName = DEFAULT_INTERFACE,
  execTimeoutMs = DEFAULT_EXEC_TIMEOUT_MS,
  io = DEFAULT_IO
} = {}) {
  if (!backupPath) throw new Error('rollbackToBackup requires { backupPath }');
  assertValidInterfaceName(interfaceName);
  if (!(await fileExists(io, backupPath))) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  await io.copyFile(backupPath, configPath);
  const syncCmd = `wg syncconf ${interfaceName} <(wg-quick strip ${interfaceName})`;
  const { stdout, stderr } = await io.exec(syncCmd, { shell: '/bin/bash', timeout: execTimeoutMs });
  const syncOutput = `${stdout || ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim();
  return { restored: true, syncOutput };
}

/**
 * List available config backups in the wg1.conf directory.
 *
 * @param {object} opts
 * @param {string} [opts.configPath]
 * @param {object} [opts.io]
 * @returns {Promise<Array<{path: string, sizeBytes: number, modifiedAt: Date}>>}
 */
async function listBackups({
  configPath = DEFAULT_CONFIG_PATH,
  io = DEFAULT_IO
} = {}) {
  const dir = path.dirname(configPath);
  const base = path.basename(configPath);
  const backupPrefix = `${base}.bak-`;

  let entries;
  try {
    entries = await io.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const backups = [];
  for (const name of entries) {
    if (!name.startsWith(backupPrefix)) continue;
    const fullPath = path.join(dir, name);
    try {
      const st = await io.stat(fullPath);
      backups.push({
        path: fullPath,
        sizeBytes: st.size,
        modifiedAt: st.mtime
      });
    } catch (_) { /* skip unreadable */ }
  }

  // Newest first
  backups.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return backups;
}

module.exports = {
  // Constants
  DEFAULT_CONFIG_PATH,
  DEFAULT_INTERFACE,
  DEFAULT_FILE_MODE,
  DEFAULT_EXEC_TIMEOUT_MS,
  INTERFACE_NAME_REGEX,
  // Internal helpers exposed for tests
  fileExists,
  buildBackupPath,
  buildTmpPath,
  assertValidInterfaceName,
  // Default IO bundle (for tests that want to override one field)
  DEFAULT_IO,
  // Top-level
  applyWg1Config,
  syncCustomerLanRoutes,
  rollbackToBackup,
  listBackups,
  // Constants used by syncCustomerLanRoutes — exposed for tests
  SAFE_CIDR_REGEX,
  INFRA_WG1_SUBNET
};
