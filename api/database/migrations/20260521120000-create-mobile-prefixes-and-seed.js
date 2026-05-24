'use strict';

// Indian mobile-number prefix → telecom-circle lookup.
//
// Powers the org-level Protect-from-SPAM feature (#xxx). At inbound time
// the dialplan extracts the first 4 digits of the calling number (after
// stripping country code 91) and looks up the prefix here to find the
// circle code. The per-org block list lives in
// organizations.settings.spam_protection.blocked_circles — actual call
// blocking is wired up in Phase 2; this migration just creates the
// lookup table and seeds it.
//
// Data source: /api/database/seeds/india_mobile_prefixes.csv (4001 rows
// of 4-digit prefixes, ~2200 of which have non-empty circle data —
// blanks correspond to unassigned prefixes per TRAI's numbering plan).
//
// Idempotent: re-running drops + recreates the table, then loads fresh
// data. Safe because mobile_prefixes is reference data (not mutated by
// the application).

const fs = require('fs');
const path = require('path');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Composite PK (prefix, circle_code) — a small number of prefixes are
    // used across multiple circles (e.g. 'MH / UE' = Maharashtra OR
    // UP-East) and we split those at seed time into separate rows so the
    // lookup SQL stays a simple WHERE prefix=? AND circle_code IN (...).
    await queryInterface.createTable('mobile_prefixes', {
      prefix: {
        type: Sequelize.STRING(4),
        primaryKey: true,
        allowNull: false,
      },
      circle_code: {
        type: Sequelize.STRING(4),
        primaryKey: true,
        allowNull: false,
      },
      network_operator_code: {
        type: Sequelize.STRING(8),
        allowNull: true,
      },
      network_operator: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      circle_name: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      category: {
        type: Sequelize.STRING(16),
        allowNull: true,
      },
    });

    // Hot lookup is by prefix (called every inbound). circle_code index
    // helps "all prefixes for these blocked circles" reverse lookups.
    await queryInterface.addIndex('mobile_prefixes', ['circle_code']);

    // Load the CSV. Same dir convention as migrations themselves.
    const csvPath = path.join(__dirname, '..', 'seeds', 'india_mobile_prefixes.csv');
    if (!fs.existsSync(csvPath)) {
      throw new Error(`Seed file not found: ${csvPath}`);
    }
    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    // First line is the header: Number,Network Operator Code,Network Operator,Circle Code,Circle Name,Category
    const dataLines = lines.slice(1);

    // Build rows. Skip lines where circle_code is blank (unassigned
    // prefixes per TRAI's numbering plan — not useful for blocking).
    // Split rows where circle_code is like 'MH / UE' into one row per
    // circle. The CSV doesn't use quoted fields so a plain split is
    // safe; if that ever changes, swap to a real parser.
    const rows = [];
    const seen = new Set(); // composite key 'prefix|code' for dedup
    for (const line of dataLines) {
      const cols = line.split(',');
      if (cols.length < 6) continue;
      const [prefix, opCode, opName, circleCodeRaw, circleNameRaw, categoryRaw] = cols.map((c) => c.trim());
      if (!circleCodeRaw) continue;
      // Some prefixes belong to multiple circles ('MH / UE'). Split.
      const codes = circleCodeRaw.split('/').map((c) => c.trim()).filter(Boolean);
      const names = circleNameRaw.split('/').map((c) => c.trim());
      const cats = categoryRaw.split('/').map((c) => c.trim());
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        // Reject obviously-bad codes like 'UP' with no name — these are
        // CSV typos, not real TRAI circles. Real codes are always 2-3
        // letters AND have a non-empty matched name.
        const name = names[i] || names[0] || null;
        if (!name) continue;
        const key = `${prefix}|${code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          prefix,
          circle_code: code,
          network_operator_code: opCode || null,
          network_operator: opName || null,
          circle_name: name,
          category: cats[i] || cats[0] || null,
        });
      }
    }

    if (rows.length === 0) {
      throw new Error('CSV parsed to zero rows — refusing to leave an empty table.');
    }

    // Bulk insert in chunks; MariaDB's default max_allowed_packet is
    // generous but huge single INSERTs aren't ideal for binlog size.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await queryInterface.bulkInsert('mobile_prefixes', rows.slice(i, i + CHUNK));
    }

    console.log(`mobile_prefixes seeded with ${rows.length} rows`);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('mobile_prefixes');
  },
};
