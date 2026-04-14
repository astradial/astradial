const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'workflow',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'workflow_db',
  max: 20,
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT '',
        trigger_type VARCHAR(50) NOT NULL, -- webhook, scheduled, recurring, event
        trigger_config JSONB DEFAULT '{}',
        nodes JSONB DEFAULT '[]',
        edges JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID NOT NULL REFERENCES workflows(id),
        org_id VARCHAR(36) NOT NULL,
        trigger_data JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'pending', -- pending, running, completed, failed, cancelled
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        error TEXT,
        steps JSONB DEFAULT '[]'
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id UUID NOT NULL REFERENCES workflows(id),
        org_id VARCHAR(36) NOT NULL,
        trigger_data JSONB DEFAULT '{}',
        scheduled_at TIMESTAMPTZ NOT NULL,
        repeat_until TIMESTAMPTZ,
        repeat_interval VARCHAR(50), -- e.g. '1 day', '1 hour'
        status VARCHAR(20) DEFAULT 'pending', -- pending, queued, executed, cancelled
        bull_job_id VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS org_automation_config (
        org_id VARCHAR(36) PRIMARY KEY,
        automation_channel_limit INTEGER DEFAULT 3,
        current_automation_calls INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL DEFAULT 'Default',
        key VARCHAR(64) NOT NULL UNIQUE,
        is_active BOOLEAN DEFAULT true,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
      CREATE INDEX IF NOT EXISTS idx_workflows_org ON workflows(org_id);
      CREATE INDEX IF NOT EXISTS idx_executions_workflow ON workflow_executions(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_org ON scheduled_jobs(org_id, status);
    `);

    console.log('✅ Database tables initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
