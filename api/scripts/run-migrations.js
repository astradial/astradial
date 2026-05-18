#!/usr/bin/env node
/**
 * Run pending DB migrations during deploy.
 *
 * Handles BOTH file types in timestamp order:
 *   - .js  — Sequelize-style modules with `up(queryInterface, Sequelize)`
 *   - .sql — raw SQL run via `sequelize.query()` (supports multi-statement)
 *
 * Order = lexicographic by filename. Sequelize CLI's default
 * `YYYYMMDDHHMMSS-name.ext` convention makes alphabetical = chronological,
 * so a .sql file dated 2026-04-12 runs BEFORE a .js file dated 2026-04-13
 * even though they're different file types. That's the whole point —
 * interleaving fixes the original bug where all .sql ran after all .js,
 * causing .js migrations that depend on .sql-added columns to fail
 * silently in production deploys.
 *
 * Each filename is recorded in `SequelizeMeta` after a successful apply,
 * so re-runs are idempotent. Failures stop the script — partial state is
 * left in place for the operator to debug, and the deploy workflow exits
 * non-zero so the new code doesn't reload over a broken DB.
 *
 * Doesn't require sequelize-cli (which isn't always present in production
 * — `npm ci --omit=dev` skips devDependencies).
 *
 * Designed to be called from inside `/app/api` or wherever the
 * working directory has `database/migrations/` reachable. Locates files
 * relative to its own path so cwd doesn't matter.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const API_ROOT = path.resolve(SCRIPT_DIR, '..');
const MIGRATIONS_DIR = path.join(API_ROOT, 'database', 'migrations');

async function applyJsMigration(file, qi, Sequelize) {
  const migration = require(path.join(MIGRATIONS_DIR, file));
  if (typeof migration.up !== 'function') {
    throw new Error(`Migration ${file} has no up() function`);
  }
  try {
    await migration.up(qi, Sequelize);
  } catch (e) {
    // Tolerate well-known idempotency errors — the same migration may have
    // been applied via a different path (e.g. Sequelize model auto-sync
    // creating columns) or the operator already ran it manually. Keep
    // recording the filename in SequelizeMeta so future runs skip it.
    if (
      e.message.match(/already exists/i) ||
      e.message.match(/Duplicate column/i) ||
      e.message.match(/Duplicate key/i) ||
      e.message.match(/Duplicate entry/i)
    ) {
      console.log(`      (skipping — already applied: ${e.message.slice(0, 80)})`);
      return;
    }
    throw e;
  }
}

async function applySqlMigration(file, sequelize) {
  const sqlPath = path.join(MIGRATIONS_DIR, file);
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Split on `;` at end-of-statement. Naive — would break on semicolons
  // inside string literals. Our SQL migrations don't have any.
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    // Skip lines that are pure SQL comments
    const meaningful = stmt.replace(/^\s*--[^\n]*\n?/gm, '').trim();
    if (meaningful === '') continue;
    try {
      await sequelize.query(stmt);
    } catch (e) {
      // `ADD COLUMN IF NOT EXISTS` etc. throw on re-run on some MariaDB
      // versions; tolerate well-known idempotency-related errors so
      // re-runs are safe.
      if (
        e.message.match(/already exists/i) ||
        e.message.match(/Duplicate column/i) ||
        e.message.match(/Duplicate key/i)
      ) {
        console.log(`      (skipping — already applied: ${e.message.slice(0, 80)})`);
        continue;
      }
      throw new Error(`SQL statement failed in ${file}: ${e.message}\n  Statement: ${stmt.slice(0, 200)}`);
    }
  }
}

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

  // Discover BOTH .js and .sql migrations, sort chronologically.
  const allFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.js') || f.endsWith('.sql'))
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
    if (file.endsWith('.js')) {
      await applyJsMigration(file, qi, Sequelize);
    } else {
      await applySqlMigration(file, sequelize);
    }
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
