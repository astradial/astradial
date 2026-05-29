#!/usr/bin/env node
/**
 * Bootstrap-or-migrate — the single entry point for getting the DB
 * schema into the right state at api boot.
 *
 * Strategy:
 *  - FRESH install (SequelizeMeta missing or empty): use sequelize.sync()
 *    to create every table from the model definitions. This is the
 *    "source of truth" for OSS users who don't need the historical
 *    migration chain. After sync, every existing migration filename is
 *    recorded in SequelizeMeta so future deploys don't try to re-apply
 *    them (which would fail with Duplicate-column / Foreign-key errors).
 *
 *  - EXISTING install (SequelizeMeta has rows): delegate to the regular
 *    run-migrations.js so new migrations land normally.
 *
 * Why this hybrid rather than always-migrate:
 *  Migrations were originally written for an internal SaaS that evolved
 *  incrementally — they assume earlier ones already applied, sometimes
 *  reference columns added by Sequelize sync, sometimes update tables
 *  that don't exist on fresh installs. For a clean OSS docker-compose
 *  boot, asking 36 historical migrations to land in order on an empty
 *  DB is brittle. sync() takes the model definitions (which ARE the
 *  current schema) and just creates them all.
 *
 *  Existing deployments (e.g. anyone upgrading from a hosted snapshot
 *  or a previous OSS install) still get the proper migration path.
 *
 * Idempotent: re-runs are no-ops once SequelizeMeta is populated.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT_DIR = __dirname;
const API_ROOT = path.resolve(SCRIPT_DIR, '..');
const MIGRATIONS_DIR = path.join(API_ROOT, 'database', 'migrations');

async function isFreshInstall(sequelize) {
  try {
    const rows = await sequelize.query(
      'SELECT COUNT(*) AS n FROM SequelizeMeta',
      { type: sequelize.QueryTypes.SELECT },
    );
    const count = Number(rows[0].n);
    return count === 0;
  } catch (e) {
    // Table doesn't exist → fresh
    return true;
  }
}

async function markAllMigrationsApplied(sequelize) {
  await sequelize.query(
    'CREATE TABLE IF NOT EXISTS SequelizeMeta (' +
    '  name VARCHAR(255) NOT NULL PRIMARY KEY' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  );

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.js') || f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    try {
      await sequelize.query(
        'INSERT INTO SequelizeMeta (name) VALUES (:n)',
        { replacements: { n: f } },
      );
    } catch (e) {
      // Duplicate primary key = already recorded; ignore.
      if (!e.message.match(/Duplicate/i)) throw e;
    }
  }
  console.log(`✓ Recorded ${files.length} migration filenames in SequelizeMeta.`);
}

function runMigrationsScript() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [path.join(SCRIPT_DIR, 'run-migrations.js')],
      { stdio: 'inherit', cwd: API_ROOT },
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`run-migrations.js exited ${code}`));
    });
  });
}

async function verifyMariaDBVersion(sequelize) {
  // Campaigns scheduler relies on `SELECT ... FOR UPDATE SKIP LOCKED`
  // (MariaDB 10.6+) for race-free row claim. Warn loudly on older
  // versions — the scheduler falls back to application-level locking
  // via locked_at/locked_by but throughput is lower and stricter.
  try {
    const [row] = await sequelize.query('SELECT VERSION() AS v', {
      type: sequelize.QueryTypes.SELECT,
    });
    const raw = String(row?.v || '');
    const m = raw.match(/(\d+)\.(\d+)/);
    if (!m) return;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    const ok = (major > 10) || (major === 10 && minor >= 6);
    if (!ok) {
      console.warn(
        `! MariaDB ${raw} detected. Campaigns scheduler prefers ≥10.6 ` +
        '(for FOR UPDATE SKIP LOCKED). Falling back to slower app-level locking.'
      );
    } else {
      console.log(`✓ MariaDB ${raw} supports SKIP LOCKED.`);
    }
  } catch (_) {
    // Non-fatal; the scheduler tolerates old MariaDB via its fallback path.
  }
}

async function seedCampaignSystemFields(models) {
  try {
    const { seedSystemLeadFieldsForAllOrgs } = require(
      path.join(API_ROOT, 'src', 'services', 'campaign-lead-fields-seed')
    );
    const n = await seedSystemLeadFieldsForAllOrgs(models);
    console.log(`✓ Campaign lead-fields seed checked across ${n} org(s).`);
  } catch (e) {
    // Don't block boot if seed fails — the feature is just unconfigured.
    console.warn('! Campaign lead-fields seed skipped:', e.message);
  }
}

async function main() {
  const sequelize = require(path.join(API_ROOT, 'src', 'config', 'database'));
  const models = require(path.join(API_ROOT, 'src', 'models'));
  const { syncDatabase } = models;

  await verifyMariaDBVersion(sequelize);

  const fresh = await isFreshInstall(sequelize);

  if (fresh) {
    console.log('Fresh install detected (SequelizeMeta empty/missing).');
    console.log('Creating schema from Sequelize models...');
    await syncDatabase(false);
    await markAllMigrationsApplied(sequelize);
    await seedCampaignSystemFields(models);
    console.log('✓ Bootstrap complete.');
    await sequelize.close();
    return;
  }

  console.log('Existing install detected. Running pending migrations...');
  await runMigrationsScript();
  await seedCampaignSystemFields(models);
  await sequelize.close();
}

main().catch((err) => {
  console.error('✗ Bootstrap/migrate failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
