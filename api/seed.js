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
    const rows = await conn.query('SELECT COUNT(*) as c FROM organizations');
    if (rows[0].c > 0) {
      console.log('Database already has organisations. Skipping seed.');
      return;
    }

    console.log('First boot detected. Creating default organisation and admin...');

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';
    const adminName = process.env.ADMIN_NAME || 'Admin';

    // Create org
    const orgId = uuid();
    const apiKey = 'org_' + uuid().replace(/-/g, '');
    const apiSecretHash = await bcrypt.hash(uuid(), 12);

    await conn.query(
      `INSERT INTO organizations (id, name, context_prefix, api_key, api_secret, status, settings, limits, contact_info, created_at, updated_at)
       VALUES (?, 'Default', 'default', ?, ?, 'active',
       '{"max_trunks":5,"max_dids":10,"max_users":50,"max_queues":10,"recording_enabled":false,"webhook_enabled":true,"features":{"call_transfer":true,"call_recording":true,"voicemail":true,"conference":true,"ivr":true,"ai_agent":false}}',
       '{"concurrent_calls":10,"monthly_minutes":10000,"storage_gb":10}',
       ?, NOW(), NOW())`,
      [orgId, apiKey, apiSecretHash, JSON.stringify({ email: adminEmail })]
    );

    // Create admin user with password
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const userId = uuid();

    await conn.query(
      `INSERT INTO org_users (id, org_id, email, name, role, status, password_hash, extension, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', 'active', ?, '1001', NOW(), NOW())`,
      [userId, orgId, adminEmail, adminName, passwordHash]
    );

    // Create SIP extension for admin
    const crypto = require('crypto');
    const sipPass = crypto.randomBytes(8).toString('hex');

    await conn.query(
      `INSERT INTO users (id, org_id, username, email, full_name, extension, role, status, password_hash, sip_password, asterisk_endpoint, recording_enabled, created_at, updated_at)
       VALUES (?, ?, 'admin', ?, ?, '1001', 'admin', 'active', ?, ?, ?, 0, NOW(), NOW())`,
      [uuid(), orgId, adminEmail, adminName, sipPass, sipPass, `PJSIP/1001`]
    );

    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  Astradial is ready!                                 ║');
    console.log('║                                                      ║');
    console.log('║  Dashboard:  http://localhost:3001                    ║');
    console.log(`║  Email:      ${adminEmail.padEnd(39)}║`);
    console.log(`║  Password:   ${adminPassword.padEnd(39)}║`);
    console.log('║                                                      ║');
    console.log(`║  SIP Extension 1001 password: ${sipPass.padEnd(22)}║`);
    console.log('║  Register with Zoiper to make test calls             ║');
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
