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

# Run Sequelize migrations
echo "Running migrations..."
npx sequelize-cli db:migrate 2>/dev/null || echo "Sequelize migrations done"

# Run SQL migrations (for tables not covered by Sequelize)
for f in database/migrations/*.sql; do
  if [ -f "$f" ]; then
    echo "Running SQL: $f"
    node -e "
      const m=require('mariadb'),fs=require('fs');
      const p=m.createPool({host:process.env.DB_HOST||'localhost',port:parseInt(process.env.DB_PORT)||3306,user:process.env.DB_USER||'astradial',password:process.env.DB_PASSWORD||'changeme',database:process.env.DB_NAME||'astradial',connectionLimit:1,multipleStatements:true});
      p.getConnection().then(async c=>{try{await c.query(fs.readFileSync('$f','utf8'))}catch(e){if(!e.message.includes('already exists'))console.error(e.message)}finally{c.release();await p.end();process.exit(0)}}).catch(e=>{console.error(e.message);process.exit(0)});
    " 2>/dev/null || true
  fi
done

# Seed default admin on first boot
echo "Checking seed..."
node seed.js

# Start the API server
echo "Starting API server..."
exec node src/server.js
