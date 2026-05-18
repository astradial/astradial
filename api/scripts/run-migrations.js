#!/usr/bin/env node
/**
 * Run pending Sequelize migrations during deploy, without requiring
 * sequelize-cli (which isn't installed in production — npm ci --omit=dev
 * skips devDependencies).
 *
 * Mirrors what sequelize-cli's `db:migrate` does on the happy path:
 *   1. Reads every file in `database/migrations/`.
 *   2. Reads the names already recorded in `SequelizeMeta`.
 *   3. For each file not yet recorded, runs `up(queryInterface, Sequelize)`
 *      and inserts the filename into `SequelizeMeta` afterward.
 *   4. Exits 0 if every pending migration succeeded; non-zero if any failed.
 *
 * Runs in alphabetical order by filename. Sequelize CLI's default convention
 * is a date-prefixed name (`20260513120000-add-user-failover-fields.js`) so
 * alphabetical order = chronological order.
 *
 * The script is idempotent: re-running it is a no-op once the DB is at
 * head. Failures stop the script — a partial migration leaves the
 * remaining migrations pending, and the same deploy run will surface the
 * error so the operator sees what broke before the new code reloads.
 *
 * Called from the deploy workflows AFTER `npm ci --omit=dev` (so the
 * `sequelize` package is present) and BEFORE `pm2 reload`. If a migration
 * fails, pm2 is NOT reloaded — the old code keeps serving traffic while
 * the operator debugs.
 *
 * Designed to be called from inside `/app` (production), but
 * works from any CWD as long as `database/migrations/` and the Sequelize
 * config are reachable relative to the script path.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const API_ROOT = path.resolve(SCRIPT_DIR, '..');
const MIGRATIONS_DIR = path.join(API_ROOT, 'database', 'migrations');

async function main() {
  const sequelize = require(path.join(API_ROOT, 'src', 'config', 'database'));
  const { Sequelize } = require('sequelize');
  const qi = sequelize.getQueryInterface();

  // Ensure SequelizeMeta exists (matches sequelize-cli's bootstrap behavior).
  await sequelize.query(
    'CREATE TABLE IF NOT EXISTS SequelizeMeta (' +
    '  name VARCHAR(255) NOT NULL PRIMARY KEY' +
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  );

  const allFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();

  const applied = new Set(
    (await sequelize.query('SELECT name FROM SequelizeMeta', { type: sequelize.QueryTypes.SELECT }))
      .map((r) => r.name)
  );

  const pending = allFiles.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log(`✓ Migrations: at head (${allFiles.length} applied).`);
    await sequelize.close();
    return;
  }

  console.log(`Running ${pending.length} pending migration${pending.length === 1 ? '' : 's'}:`);
  for (const file of pending) {
    console.log(`  → ${file}`);
    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (typeof migration.up !== 'function') {
      throw new Error(`Migration ${file} has no up() function`);
    }
    await migration.up(qi, Sequelize);
    await sequelize.query('INSERT INTO SequelizeMeta (name) VALUES (:n)', {
      replacements: { n: file }
    });
    console.log(`    ✓ ${file} applied.`);
  }

  console.log(`✓ Migrations: ${pending.length} applied, ${allFiles.length} total.`);
  await sequelize.close();
}

main().catch((err) => {
  console.error('✗ Migration failed:', err.message);
  if (err.stack) console.error(err.stack);
  // Exit non-zero so the deploy workflow fails BEFORE pm2 reloads.
  // Old code keeps serving until the operator fixes the migration.
  process.exit(1);
});
