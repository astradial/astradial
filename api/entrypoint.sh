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

# Run all migrations (.js + .sql) in timestamp order — single script,
# fails fast, records to SequelizeMeta.
echo "Running migrations..."
node scripts/run-migrations.js

# Seed default admin on first boot
echo "Checking seed..."
node seed.js

# Start the API server
echo "Starting API server..."
exec node src/server.js
