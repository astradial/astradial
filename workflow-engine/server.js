const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const { pool, initDb } = require('./db');
const { workflowQueue, scheduleQueue, checkChannelLimit, getOrgLimit, getLiveCallCount } = require('./queue');
const { executeWorkflow } = require('./runner');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3002;

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Health ───
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'workflow-engine', uptime: process.uptime() });
});

// ─── API Keys CRUD ───

function generateApiKey() {
  return 'wfk_' + crypto.randomBytes(24).toString('hex');
}

app.get('/api-keys', async (req, res) => {
  const { org_id } = req.query;
  if (!org_id) return res.status(400).json({ error: 'org_id required' });
  try {
    const result = await pool.query(
      'SELECT id, org_id, name, key, is_active, last_used_at, created_at FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC',
      [org_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api-keys', async (req, res) => {
  const { org_id, name } = req.body;
  if (!org_id) return res.status(400).json({ error: 'org_id required' });
  try {
    const key = generateApiKey();
    const result = await pool.query(
      'INSERT INTO api_keys (org_id, name, key) VALUES ($1, $2, $3) RETURNING *',
      [org_id, name || 'Default', key]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api-keys/:id', async (req, res) => {
  const { name, is_active } = req.body;
  try {
    const result = await pool.query(
      'UPDATE api_keys SET name = COALESCE($1, name), is_active = COALESCE($2, is_active) WHERE id = $3 RETURNING *',
      [name, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Key not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api-keys/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM api_keys WHERE id = $1', [req.params.id]);
    res.json({ status: 'deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Templates ───
app.get('/templates', (req, res) => {
  const templatesDir = path.join(__dirname, '..', 'templates');
  try {
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));
    const templates = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf8'));
      return { id: f.replace('.json', ''), name: data.name, description: data.description, trigger_type: data.trigger_type };
    });
    res.json(templates);
  } catch { res.json([]); }
});

app.post('/templates/:id/create', async (req, res) => {
  const { org_id } = req.body;
  if (!org_id) return res.status(400).json({ error: 'org_id required' });
  const templatePath = path.join(__dirname, '..', 'templates', `${req.params.id}.json`);
  try {
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    const result = await pool.query(
      `INSERT INTO workflows (org_id, name, description, trigger_type, trigger_config, nodes, edges)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [org_id, template.name, template.description, template.trigger_type,
       JSON.stringify(template.trigger_config), JSON.stringify(template.nodes), JSON.stringify(template.edges)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Workflows CRUD ───

app.post('/workflows', async (req, res) => {
  try {
    const { org_id, name, description, trigger_type, trigger_config, nodes, edges } = req.body;
    if (!org_id || !name || !trigger_type) {
      return res.status(400).json({ error: 'org_id, name, trigger_type required' });
    }
    const result = await pool.query(
      `INSERT INTO workflows (org_id, name, description, trigger_type, trigger_config, nodes, edges)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [org_id, name, description || '', trigger_type, JSON.stringify(trigger_config || {}), JSON.stringify(nodes || []), JSON.stringify(edges || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/workflows', async (req, res) => {
  try {
    const { org_id } = req.query;
    const result = await pool.query(
      'SELECT * FROM workflows WHERE org_id = $1 ORDER BY created_at DESC', [org_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/workflows/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM workflows WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/workflows/:id', async (req, res) => {
  try {
    const { name, description, trigger_type, trigger_config, nodes, edges, is_active } = req.body;
    const result = await pool.query(
      `UPDATE workflows SET name = COALESCE($1, name), description = COALESCE($2, description),
       trigger_type = COALESCE($3, trigger_type), trigger_config = COALESCE($4, trigger_config),
       nodes = COALESCE($5, nodes), edges = COALESCE($6, edges),
       is_active = COALESCE($7, is_active), updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [name, description, trigger_type, trigger_config ? JSON.stringify(trigger_config) : null,
       nodes ? JSON.stringify(nodes) : null, edges ? JSON.stringify(edges) : null, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/workflows/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM scheduled_jobs WHERE workflow_id = $1', [req.params.id]);
    await pool.query('DELETE FROM workflow_executions WHERE workflow_id = $1', [req.params.id]);
    await pool.query('DELETE FROM workflows WHERE id = $1', [req.params.id]);
    res.json({ status: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Trigger Workflow Manually or via Webhook ───

app.post('/workflows/:id/execute', async (req, res) => {
  try {
    const workflow = (await pool.query('SELECT * FROM workflows WHERE id = $1', [req.params.id])).rows[0];
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
    if (!workflow.is_active) return res.status(400).json({ error: 'Workflow is inactive' });

    const executionId = uuidv4();
    await pool.query(
      'INSERT INTO workflow_executions (id, workflow_id, org_id, trigger_data, status) VALUES ($1, $2, $3, $4, $5)',
      [executionId, workflow.id, workflow.org_id, JSON.stringify(req.body.trigger_data || req.body), 'pending']
    );

    // Add to Bull Queue for async execution
    await workflowQueue.add({
      executionId,
      workflowId: workflow.id,
      triggerData: req.body.trigger_data || req.body,
    });

    res.json({ execution_id: executionId, status: 'queued' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Webhook Trigger Endpoint ───
app.post('/trigger/:workflow_id', async (req, res) => {
  try {
    const workflow = (await pool.query('SELECT * FROM workflows WHERE id = $1 AND is_active = true', [req.params.workflow_id])).rows[0];
    if (!workflow) return res.status(404).json({ error: 'Workflow not found or inactive' });

    // Validate API key if org has keys configured
    const orgKeys = (await pool.query('SELECT COUNT(*) as count FROM api_keys WHERE org_id = $1', [workflow.org_id])).rows[0];
    if (parseInt(orgKeys.count) > 0) {
      const apiKey = req.headers['x-api-key'] || req.query.api_key;
      if (!apiKey) return res.status(401).json({ error: 'API key required. Pass via X-API-Key header or api_key query param.' });
      const validKey = (await pool.query('SELECT id FROM api_keys WHERE key = $1 AND org_id = $2 AND is_active = true', [apiKey, workflow.org_id])).rows[0];
      if (!validKey) return res.status(403).json({ error: 'Invalid or inactive API key' });
      await pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [validKey.id]);
    }

    const executionId = uuidv4();
    await pool.query(
      'INSERT INTO workflow_executions (id, workflow_id, org_id, trigger_data, status) VALUES ($1, $2, $3, $4, $5)',
      [executionId, workflow.id, workflow.org_id, JSON.stringify(req.body), 'pending']
    );

    // Queue for execution
    await workflowQueue.add({
      executionId,
      workflowId: workflow.id,
      triggerData: req.body,
    });

    // Scan nodes for scheduled timing and create scheduled jobs
    if (workflow.trigger_type === 'webhook') {
      await createScheduledJobsFromNodes(workflow, req.body);
    }

    res.json({ execution_id: executionId, status: 'queued' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Schedule Jobs from Node Timing Config ───

function resolveTemplate(template, triggerData) {
  if (!template || typeof template !== 'string') return template;
  return template.replace(/\{trigger\.(\w+)\}/g, (_, key) => triggerData[key] || '');
}

async function createScheduledJobsFromNodes(workflow, triggerData) {
  const nodes = workflow.nodes || [];
  const scheduledNodes = nodes.filter(n => n.data?.config?.timing === 'scheduled');

  for (const node of scheduledNodes) {
    const config = node.data.config;
    const dateValue = resolveTemplate(config.run_at_date, triggerData);
    const timeValue = resolveTemplate(config.run_at_time, triggerData) || '10:00';
    const offsetDays = parseInt(config.offset_days || '0');

    if (!dateValue) {
      console.log(`[Schedule] Node ${node.data.label}: no date value, skipping`);
      continue;
    }

    let scheduledAt = new Date(`${dateValue}T${timeValue}:00+05:30`);
    if (offsetDays) {
      scheduledAt = new Date(scheduledAt.getTime() + offsetDays * 86400000);
    }

    const now = new Date();
    const delay = Math.max(0, scheduledAt.getTime() - now.getTime());

    // If more than 1 hour in the past, skip. Otherwise execute immediately (delay=0).
    if (scheduledAt.getTime() < now.getTime() - 3600000) {
      console.log(`[Schedule] Node ${node.data.label}: date ${scheduledAt} is too far in the past, skipping`);
      continue;
    }
    if (delay === 0) {
      console.log(`[Schedule] Node ${node.data.label}: date ${scheduledAt} is now/past, executing immediately`);
    }
    const jobId = uuidv4();

    // Store the node ID so the runner knows which node triggered this scheduled execution
    const jobTriggerData = { ...triggerData, _scheduled_node_id: node.id, _node_label: node.data.label };

    await pool.query(
      `INSERT INTO scheduled_jobs (id, workflow_id, org_id, trigger_data, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [jobId, workflow.id, workflow.org_id, JSON.stringify(jobTriggerData), scheduledAt]
    );

    const bullJob = await scheduleQueue.add(
      { jobId, workflowId: workflow.id, triggerData: jobTriggerData, orgId: workflow.org_id },
      { delay, jobId: `sched_${jobId}` }
    );

    await pool.query('UPDATE scheduled_jobs SET bull_job_id = $1, status = $2 WHERE id = $3',
      [bullJob.id, 'queued', jobId]);

    console.log(`[Schedule] Node "${node.data.label}" scheduled at ${scheduledAt.toISOString()} (delay: ${Math.round(delay/1000)}s)`);
  }
}

// ─── Legacy Schedule Jobs from trigger_config ───

async function createScheduledJobs(workflow, triggerData) {
  const scheduleConfig = workflow.trigger_config?.scheduled_actions || [];

  for (const action of scheduleConfig) {
    const dateField = action.date_field; // e.g. "checkin_date"
    // Support time from trigger data via time_field, or static time value
    const timeStr = (action.time_field && triggerData[action.time_field]) || action.time || "14:00";
    const dateValue = triggerData[dateField];

    if (!dateValue) continue;

    const scheduledAt = new Date(`${dateValue}T${timeStr}:00+05:30`); // IST
    const now = new Date();

    if (scheduledAt <= now) {
      console.log(`[Schedule] Skipping past date: ${scheduledAt}`);
      continue;
    }

    const delay = scheduledAt.getTime() - now.getTime();
    const jobId = uuidv4();

    // Save to PostgreSQL
    await pool.query(
      `INSERT INTO scheduled_jobs (id, workflow_id, org_id, trigger_data, scheduled_at, repeat_until, repeat_interval, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [jobId, workflow.id, workflow.org_id, JSON.stringify({ ...triggerData, _action: action }),
       scheduledAt, action.repeat_until ? new Date(`${triggerData[action.repeat_until]}T23:59:59+05:30`) : null,
       action.repeat_interval || null]
    );

    // Enqueue in Bull
    const bullJob = await scheduleQueue.add(
      { jobId, workflowId: workflow.id, triggerData: { ...triggerData, _action: action }, orgId: workflow.org_id },
      {
        delay,
        jobId: `sched_${jobId}`,
        ...(action.repeat_interval ? {
          repeat: {
            every: parseIntervalMs(action.repeat_interval),
            endDate: triggerData[action.repeat_until] ? new Date(`${triggerData[action.repeat_until]}T23:59:59+05:30`) : undefined,
          },
        } : {}),
      }
    );

    // Update with Bull job ID
    await pool.query('UPDATE scheduled_jobs SET bull_job_id = $1, status = $2 WHERE id = $3',
      [bullJob.id, 'queued', jobId]);

    console.log(`[Schedule] Job ${jobId} scheduled for ${scheduledAt} (delay: ${Math.round(delay / 60000)}min)`);
  }
}

function parseIntervalMs(interval) {
  const match = interval.match(/(\d+)\s*(day|hour|minute|min)/i);
  if (!match) return 86400000; // default 1 day
  const [, num, unit] = match;
  const multipliers = { day: 86400000, hour: 3600000, minute: 60000, min: 60000 };
  return parseInt(num) * (multipliers[unit.toLowerCase()] || 86400000);
}

// ─── Execution History ───

app.get('/workflows/:id/executions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM workflow_executions WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT 50',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Scheduled Jobs ───

app.get('/orgs/:org_id/scheduled-jobs', async (req, res) => {
  try {
    const { status, date } = req.query;
    const page  = Math.max(1, parseInt(req.query.page  || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    // Build the WHERE clause and parameter list incrementally
    const where = ['sj.org_id = $1'];
    const params = [req.params.org_id];
    if (status) {
      params.push(status);
      where.push(`sj.status = $${params.length}`);
    }
    if (date) {
      // Date filter: match against scheduled_at as it would appear in IST so the
      // editor's date picker matches what the user sees in the table.
      //
      // Rewritten as a timestamp range (instead of `(scheduled_at AT TIME ZONE 'IST')::date = X`)
      // so the (org_id, scheduled_at) btree index can serve the query at scale.
      // For YYYY-MM-DD = '2026-04-12' (IST), the UTC range is
      // [2026-04-11 18:30:00 UTC, 2026-04-12 18:30:00 UTC).
      //
      // `'2026-04-12'::date::timestamp AT TIME ZONE 'Asia/Kolkata'` interprets the
      // naive timestamp as IST and returns the corresponding UTC timestamptz, which
      // is exactly the start of the IST day. Adding 1 day to the date gives the
      // exclusive end. Both bounds are simple constants, so the index works.
      params.push(date);
      const dateParam = `$${params.length}::date`;
      where.push(
        `sj.scheduled_at >= (${dateParam}::timestamp AT TIME ZONE 'Asia/Kolkata') ` +
        `AND sj.scheduled_at < ((${dateParam} + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`
      );
    }
    const whereClause = where.join(' AND ');

    // Total count for pagination (uses the same filter)
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM scheduled_jobs sj WHERE ${whereClause}`,
      params
    );
    const total = countResult.rows[0].total;

    // Page of results
    const dataParams = [...params, limit, offset];
    const dataQuery = `
      SELECT sj.*, w.name as workflow_name
      FROM scheduled_jobs sj
      LEFT JOIN workflows w ON w.id = sj.workflow_id
      WHERE ${whereClause}
      ORDER BY sj.scheduled_at DESC, sj.created_at DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;
    const result = await pool.query(dataQuery, dataParams);

    // Always-on count of currently-actionable rows (queued + pending), regardless
    // of the user's filter — used for the tab badge in the editor.
    const activeResult = await pool.query(
      `SELECT COUNT(*)::int AS active FROM scheduled_jobs
       WHERE org_id = $1 AND status IN ('queued','pending')`,
      [req.params.org_id]
    );

    res.json({
      jobs:        result.rows,
      total,
      page,
      limit,
      totalPages:  Math.max(1, Math.ceil(total / limit)),
      activeCount: activeResult.rows[0].active,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel a scheduled job: remove the Bull job + mark cancelled in Postgres.
// Refuses if the job is currently active (worker is mid-execution).
app.delete('/scheduled-jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const lookup = await pool.query('SELECT id, status FROM scheduled_jobs WHERE id = $1', [id]);
    if (lookup.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const current = lookup.rows[0].status;
    if (current === 'executed') return res.status(409).json({ error: 'Already executed' });
    if (current === 'cancelled') return res.json({ status: 'already_cancelled' });

    const bullId = `sched_${id}`;
    const job = await scheduleQueue.getJob(bullId);
    let bullStateWas = null;
    if (job) {
      bullStateWas = await job.getState();
      if (bullStateWas === 'active') {
        return res.status(409).json({ error: 'Job is currently executing, cannot cancel' });
      }
      await job.remove();
    }

    await pool.query("UPDATE scheduled_jobs SET status = 'cancelled' WHERE id = $1", [id]);

    res.json({ status: 'cancelled', bull_state_was: bullStateWas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Channel Config ───

app.get('/orgs/:org_id/automation-config', async (req, res) => {
  try {
    let result = await pool.query('SELECT * FROM org_automation_config WHERE org_id = $1', [req.params.org_id]);
    if (result.rows.length === 0) {
      await pool.query('INSERT INTO org_automation_config (org_id) VALUES ($1)', [req.params.org_id]);
      result = await pool.query('SELECT * FROM org_automation_config WHERE org_id = $1', [req.params.org_id]);
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/orgs/:org_id/automation-config', async (req, res) => {
  try {
    const { automation_channel_limit } = req.body;
    await pool.query(
      'INSERT INTO org_automation_config (org_id, automation_channel_limit) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET automation_channel_limit = $2, updated_at = NOW()',
      [req.params.org_id, automation_channel_limit]
    );
    res.json({ status: 'updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bull Queue Processors ───

// Process ONE job at a time to enforce sequential execution with concurrency control
workflowQueue.process(1, async (job) => {
  const { executionId, workflowId, triggerData, requeueCount } = job.data;
  console.log(`[Queue] Processing workflow ${workflowId}, execution ${executionId}${requeueCount ? ` (requeue #${requeueCount})` : ''}`);

  let orgId = null;

  try {
    const workflow = (await pool.query('SELECT * FROM workflows WHERE id = $1', [workflowId])).rows[0];
    if (!workflow) throw new Error('Workflow not found');
    orgId = workflow.org_id;

    // STEP 1: Wait until live calls are under the concurrency limit
    const limit = await getOrgLimit(orgId);
    let liveCount = await getLiveCallCount(orgId);
    let waitAttempts = 0;
    const MAX_WAIT = 36; // max 3 minutes (36 * 5s) — prevents zombie lock

    while (liveCount >= limit && waitAttempts < MAX_WAIT) {
      waitAttempts++;
      if (waitAttempts % 6 === 1) { // Log every 30s
        console.log(`[Queue] Org ${orgId}: ${liveCount}/${limit} calls active, waiting... (${waitAttempts * 5}s)`);
      }
      await new Promise(r => setTimeout(r, 5000));
      liveCount = await getLiveCallCount(orgId);
    }

    console.log(`[Queue] Org ${orgId}: ${liveCount}/${limit} calls → executing workflow`);

    // STEP 2: Execute the workflow
    await pool.query('UPDATE workflow_executions SET status = $1 WHERE id = $2', ['running', executionId]);
    const countBefore = liveCount;
    const result = await executeWorkflow(workflow, triggerData, executionId);
    console.log(`[Queue] Workflow ${workflowId} ${result.success ? 'completed' : 'failed'}`);

    // STEP 3: Double-check after 5s and 10s to catch the call registering
    await new Promise(r => setTimeout(r, 5000));
    let currentCount = await getLiveCallCount(orgId);
    if (currentCount < limit) {
      await new Promise(r => setTimeout(r, 5000));
      currentCount = await getLiveCallCount(orgId);
    }

    // STEP 4: If at or over limit, wait until a slot opens (max 3 min to avoid zombie lock)
    if (currentCount >= limit) {
      console.log(`[Queue] At limit (${currentCount}/${limit}), waiting for a call to end...`);
      let waitForEnd = 0;
      const MAX_WAIT = 36; // 36 × 5s = 3 min max
      while (currentCount >= limit && waitForEnd < MAX_WAIT) {
        waitForEnd++;
        await new Promise(r => setTimeout(r, 5000));
        currentCount = await getLiveCallCount(orgId);
      }
      if (currentCount >= limit) {
        console.log(`[Queue] Timeout after 3min (${currentCount}/${limit}), proceeding anyway`);
      } else {
        console.log(`[Queue] Slot freed (${currentCount}/${limit}) after ${waitForEnd * 5}s`);
      }
    }

    return result;
  } catch (err) {
    console.error(`[Queue] Workflow ${workflowId} error:`, err.message);
    await pool.query('UPDATE workflow_executions SET status = $1, error = $2, completed_at = NOW() WHERE id = $3',
      ['failed', err.message, executionId]);
    throw err;
  }
});

scheduleQueue.process(2, async (job) => {
  const { jobId, workflowId, triggerData, orgId } = job.data;
  console.log(`[Schedule] Executing scheduled job ${jobId} for workflow ${workflowId}`);

  try {
    // Update job status
    await pool.query('UPDATE scheduled_jobs SET status = $1 WHERE id = $2', ['executed', jobId]);

    // Create execution and run
    const executionId = uuidv4();
    await pool.query(
      'INSERT INTO workflow_executions (id, workflow_id, org_id, trigger_data, status) VALUES ($1, $2, $3, $4, $5)',
      [executionId, workflowId, orgId, JSON.stringify(triggerData), 'pending']
    );

    await workflowQueue.add({ executionId, workflowId, triggerData });
  } catch (err) {
    console.error(`[Schedule] Job ${jobId} error:`, err.message);
  }
});

// ─── Startup Recovery ───

async function recoverScheduledJobs() {
  console.log('🔄 Recovering scheduled jobs...');
  const result = await pool.query(
    "SELECT * FROM scheduled_jobs WHERE status IN ('pending', 'queued') AND scheduled_at > NOW()"
  );

  for (const job of result.rows) {
    const delay = new Date(job.scheduled_at).getTime() - Date.now();
    if (delay <= 0) {
      // Past due — execute immediately
      console.log(`[Recovery] Job ${job.id} is past due, executing now`);
      await scheduleQueue.add({
        jobId: job.id, workflowId: job.workflow_id,
        triggerData: job.trigger_data, orgId: job.org_id,
      });
    } else {
      // Future — re-enqueue with delay
      const existingJob = await scheduleQueue.getJob(`sched_${job.id}`);
      if (!existingJob) {
        console.log(`[Recovery] Re-enqueuing job ${job.id} (${Math.round(delay / 60000)}min from now)`);
        await scheduleQueue.add(
          { jobId: job.id, workflowId: job.workflow_id, triggerData: job.trigger_data, orgId: job.org_id },
          { delay, jobId: `sched_${job.id}` }
        );
      }
    }
  }
  console.log(`✅ Recovered ${result.rows.length} scheduled jobs`);
}

// ─── Start Server ───

async function start() {
  await initDb();
  await recoverScheduledJobs();

  // Reset any stuck automation channel counts
  await pool.query('UPDATE org_automation_config SET current_automation_calls = 0');

  app.listen(PORT, () => {
    console.log(`🚀 Workflow Engine running on port ${PORT}`);
    console.log(`   Queue workers: ${process.env.MAX_CONCURRENT_WORKERS || 4}`);
    console.log(`   Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);
    console.log(`   PostgreSQL: ${process.env.PG_DATABASE || 'workflow_db'}`);

  });
}

start().catch((err) => {
  console.error('❌ Failed to start workflow engine:', err);
  process.exit(1);
});
