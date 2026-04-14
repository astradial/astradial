#!/bin/sh
set -e

echo "=== Astradial API Starting ==="

# Wait for MariaDB
echo "Waiting for MariaDB..."
for i in $(seq 1 30); do
  if node -e "
    const seq = require('./src/config/database');
    seq.authenticate().then(() => { console.log('DB ready'); process.exit(0); }).catch(() => process.exit(1));
  " 2>/dev/null; then
    break
  fi
  echo "  attempt $i/30..."
  sleep 2
done

# Run migrations
echo "Running migrations..."
npx sequelize-cli db:migrate 2>/dev/null || echo "Migrations completed (or already up to date)"

# Seed default admin + test extensions on first boot
node -e "
const { sequelize } = require('./src/models');
const bcrypt = require('bcrypt');
const { v4: uuid } = require('uuid');

async function seed() {
  // Check if any org exists
  const [orgs] = await sequelize.query('SELECT COUNT(*) as c FROM organizations');
  if (orgs[0].c > 0) { console.log('Database already seeded.'); return; }

  console.log('First boot — creating default admin org + users...');

  // Create default org
  const orgId = uuid();
  const apiKey = 'org_' + uuid().replace(/-/g, '');
  const apiSecret = await bcrypt.hash('admin', 12);
  await sequelize.query(
    \`INSERT INTO organizations (id, name, context_prefix, api_key, api_secret, status, settings, limits, contact_info, created_at, updated_at)
     VALUES (?, 'Default', 'default', ?, ?, 'active', '{\"max_trunks\":5,\"max_dids\":10,\"max_users\":50,\"max_queues\":10,\"recording_enabled\":false,\"webhook_enabled\":true}', '{\"concurrent_calls\":10}', '{\"email\":\"admin@localhost\"}', NOW(), NOW())\`,
    { replacements: [orgId, apiKey, apiSecret] }
  );

  // Create admin user
  const adminHash = await bcrypt.hash('admin', 12);
  await sequelize.query(
    \`INSERT INTO org_users (id, org_id, email, name, role, status, password_hash, extension, created_at, updated_at)
     VALUES (UUID(), ?, 'admin@astradial.com', 'Admin', 'owner', 'active', ?, '1001', NOW(), NOW())\`,
    { replacements: [orgId, adminHash] }
  );

  // Create test extensions
  const crypto = require('crypto');
  const sipPass1 = crypto.randomBytes(8).toString('hex');
  const sipPass2 = crypto.randomBytes(8).toString('hex');

  const { User } = require('./src/models');
  await User.create({ org_id: orgId, username: 'admin', email: 'admin@astradial.com', full_name: 'Admin', extension: '1001', role: 'admin', status: 'active', password: sipPass1, sip_password: sipPass1, recording_enabled: false, routing_type: 'sip' });
  await User.create({ org_id: orgId, username: 'agent', email: 'agent@astradial.com', full_name: 'Agent', extension: '1002', role: 'agent', status: 'active', password: sipPass2, sip_password: sipPass2, recording_enabled: false, routing_type: 'sip' });

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Astradial is ready!                             ║');
  console.log('║                                                  ║');
  console.log('║  Dashboard: http://localhost:3001                 ║');
  console.log('║  Login:     admin@astradial.com / admin          ║');
  console.log('║                                                  ║');
  console.log('║  Test extensions:                                ║');
  console.log('║    1001 (Admin) SIP pass: ' + sipPass1 + '      ║');
  console.log('║    1002 (Agent) SIP pass: ' + sipPass2 + '      ║');
  console.log('║                                                  ║');
  console.log('║  Register a softphone (Zoiper) to test calls    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
}

seed().then(() => process.exit(0)).catch(e => { console.error('Seed error:', e.message); process.exit(0); });
" || true

# Start the API server
echo "Starting API server on port 8000..."
exec node src/server.js
