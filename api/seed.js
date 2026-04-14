#!/usr/bin/env node

/**
 * First-boot seed script.
 * Creates default org + admin user from environment variables.
 * Skips if any org already exists.
 */

const bcrypt = require('bcrypt');
const { v4: uuid } = require('uuid');
const mariadb = require('mariadb');

async function seed() {
  const pool = mariadb.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'astradial',
    password: process.env.DB_PASSWORD || 'changeme',
    database: process.env.DB_NAME || 'astradial',
    connectionLimit: 1,
  });

  let conn;
  try {
    conn = await pool.getConnection();

    // Check if already seeded
    const rows = await conn.query('SELECT COUNT(*) as c FROM org_users');
    if (rows[0].c > 0) {
      console.log('Admin account already exists. Skipping seed.');
      return;
    }

    console.log('First boot detected. Creating default organisation and admin...');

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';
    const adminName = process.env.ADMIN_NAME || 'Admin';

    // No default org — admin creates orgs from the dashboard
    // Just check org_users table exists and create admin user
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    await conn.query(
      `INSERT INTO org_users (id, org_id, email, name, role, status, password_hash, created_at, updated_at)
       VALUES (?, NULL, ?, ?, 'owner', 'active', ?, NOW(), NOW())`,
      [uuid(), adminEmail, adminName, passwordHash]
    );

    // Create SIP extension for admin
    const crypto = require('crypto');
    const sipPass = crypto.randomBytes(8).toString('hex');

    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  Astradial is ready!                                 ║');
    console.log('║                                                      ║');
    console.log('║  Dashboard:  http://localhost:3001                    ║');
    console.log(`║  Email:      ${adminEmail.padEnd(39)}║`);
    console.log(`║  Password:   ${adminPassword.padEnd(39)}║`);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

  } catch (err) {
    console.error('Seed error:', err.message);
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

seed().then(() => process.exit(0)).catch(() => process.exit(0));

// This patch is appended by the seed but we need to add missing columns via a separate migration
