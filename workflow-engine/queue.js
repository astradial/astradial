const Bull = require('bull');
const { pool } = require('./db');
require('dotenv').config();

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Main workflow execution queue
const workflowQueue = new Bull('workflow-execution', { redis: REDIS_CONFIG });

// Scheduled jobs queue (separate for delayed/recurring jobs)
const scheduleQueue = new Bull('workflow-schedule', { redis: REDIS_CONFIG });

const ASTRAPBX_URL = process.env.ASTRAPBX_URL || 'http://localhost:8000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/**
 * Get the configured concurrency limit for an org from DB.
 */
async function getOrgLimit(orgId) {
  const result = await pool.query(
    'SELECT automation_channel_limit FROM org_automation_config WHERE org_id = $1',
    [orgId]
  );
  if (result.rows.length === 0) {
    const limit = parseInt(process.env.DEFAULT_AUTOMATION_CHANNEL_LIMIT || '3');
    await pool.query(
      'INSERT INTO org_automation_config (org_id, automation_channel_limit) VALUES ($1, $2) ON CONFLICT (org_id) DO NOTHING',
      [orgId, limit]
    );
    return limit;
  }
  return result.rows[0].automation_channel_limit;
}

/**
 * Get live outbound call count from AstraPBX.
 */
async function getLiveCallCount(orgId) {
  try {
    const resp = await fetch(`${ASTRAPBX_URL}/api/v1/calls/automation-count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': INTERNAL_API_KEY },
      body: JSON.stringify({ org_id: orgId }),
    });
    const data = await resp.json();
    return data.count || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if org has available slots (for UI display).
 */
async function checkChannelLimit(orgId) {
  const limit = await getOrgLimit(orgId);
  const current = await getLiveCallCount(orgId);
  return { available: current < limit, current, limit };
}

module.exports = {
  workflowQueue,
  scheduleQueue,
  checkChannelLimit,
  getOrgLimit,
  getLiveCallCount,
};
