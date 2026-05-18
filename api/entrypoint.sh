#!/bin/sh
set -e

echo "=== Astradial API Starting ==="

# Wait for MariaDB
echo "Waiting for database..."
for i in $(seq 1 30); do
  if node -e "
    const m = require('mariadb');
    const p = m.createPool({host:process.env.DB_HOST||'localhost',port:parseInt(process.env.DB_PORT)||3306,user:process.env.DB_USER||'astradial',password:process.env.DB_PASSWORD||'changeme',database:process.env.DB_NAME||'astradial',connectionLimit:1});
    p.getConnection().then(c=>{c.release();p.end();console.log('DB ready');process.exit(0)}).catch(()=>process.exit(1));
  " 2>/dev/null; then
    break
  fi
  echo "  attempt $i/30..."
  sleep 2
done

# Bootstrap-or-migrate:
#  - Fresh install (empty SequelizeMeta) → sync schema from Sequelize models
#    then mark all migrations as applied. Avoids the 36-migration historical
#    chain that's brittle on fresh DBs.
#  - Existing install → run pending migrations via scripts/run-migrations.js.
echo "Bootstrapping schema..."
node scripts/bootstrap-or-migrate.js

# Seed default admin on first boot
echo "Checking seed..."
node seed.js

# Start the API server
echo "Starting API server..."
exec node src/server.js
