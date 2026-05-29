'use strict';

// Phase D scheduler — pure enqueuer.
//
// One repeatable BullMQ job per running campaign:
//   jobId:  'tick-{campaignId}'
//   repeat: { every: 60_000 }  (every 1 minute)
//
// Each tick claims ≤500 pending runs for THAT campaign, determines the
// action type from the template snapshot, enqueues to the appropriate
// channel queue (campaign-calls or campaign-whatsapp), and marks the run
// 'queued'.  No concurrency checking here — that lives in the workers.
//
// DNC re-check is retained: runs whose lead is in a stop-status are
// halted with a CampaignEvent before enqueuing.
//
// FOR UPDATE SKIP LOCKED ensures multiple scheduler replicas can coexist
// without double-dispatching (requires MariaDB ≥ 10.6).

const { createWorker, getQueue, SCHEDULER_QUEUE, CALLS_QUEUE, WHATSAPP_QUEUE } = require('./campaignQueues');
const { Op, QueryTypes } = require('sequelize');
const { createLogger } = require('../services/campaign-logger');

const TICK_BATCH = 500;
const TICK_INTERVAL_MS = 60_000; // 1 minute per-campaign tick

const logger = createLogger({ service: 'campaignScheduler' });

// ─── Per-campaign tick processor ─────────────────────────────────────────────

async function schedulerTick(job) {
  const { campaignId } = job.data;
  if (!campaignId) {
    logger.warn('tick: missing campaignId in job data', { jobId: job.id });
    return;
  }

  const { Campaign, CampaignLead, CampaignLeadRun, CampaignEvent, sequelize } = require('../models');
  const callsQueue = getQueue(CALLS_QUEUE);
  const waQueue = getQueue(WHATSAPP_QUEUE);

  const campaign = await Campaign.findByPk(campaignId, {
    attributes: ['id', 'org_id', 'status', 'template_snapshot'],
    raw: true,
  });

  if (!campaign || campaign.status !== 'running') {
    logger.debug('tick: campaign not running, skipping', { campaignId, status: campaign?.status });
    return;
  }

  const snapshot = campaign.template_snapshot;
  if (!snapshot || !Array.isArray(snapshot.days) || snapshot.days.length === 0) return;

  const now = new Date();

  // Claim pending runs with SKIP LOCKED so multiple scheduler replicas
  // don't double-dispatch the same run.
  const claimSql = `
    SELECT id FROM campaign_lead_runs
    WHERE campaign_id = :campaignId
      AND status = 'pending'
      AND next_run_at <= :now
    LIMIT :limit
    FOR UPDATE SKIP LOCKED
  `;

  let claimedIds;
  const tx = await sequelize.transaction();
  try {
    const rows = await sequelize.query(claimSql, {
      replacements: { campaignId, now, limit: TICK_BATCH },
      type: QueryTypes.SELECT,
      transaction: tx,
    });

    if (!rows || rows.length === 0) {
      await tx.rollback();
      return;
    }

    claimedIds = rows.map((r) => r.id);

    // Mark claimed runs 'queued' immediately so no other tick picks them up.
    await CampaignLeadRun.update(
      { status: 'queued', locked_at: now, locked_by: 'scheduler' },
      { where: { id: claimedIds }, transaction: tx }
    );

    await tx.commit();
  } catch (txErr) {
    try { await tx.rollback(); } catch (_) { /* ignore */ }
    logger.error('claim tx failed', { campaignId, error: txErr.message });
    throw txErr;
  }

  // Load run rows and their leads.
  const runs = await CampaignLeadRun.findAll({ where: { id: claimedIds }, raw: true });
  const leadIds = runs.map((r) => r.campaign_lead_id);
  const leads = await CampaignLead.findAll({
    where: { id: leadIds },
    attributes: ['id', 'status'],
    raw: true,
  });
  const leadById = Object.fromEntries(leads.map((l) => [l.id, l]));

  const STOP_STATUSES = new Set(['dnc', 'interested', 'disqualified']);
  const toDefer = [];
  let enqueued = 0;

  for (const run of runs) {
    const lead = leadById[run.campaign_lead_id];

    // DNC / missing lead — halt transactionally and record an event.
    if (!lead || STOP_STATUSES.has(lead.status)) {
      const haltReason = !lead ? 'lead_missing' : lead.status;
      try {
        const haltTx = await sequelize.transaction();
        try {
          if (lead && lead.status === 'dnc') {
            await CampaignLead.update({ status: 'dnc' }, { where: { id: lead.id }, transaction: haltTx });
          }
          await CampaignLeadRun.update(
            { status: 'halted', halted_at: new Date() },
            { where: { id: run.id }, transaction: haltTx }
          );
          await CampaignEvent.create({
            org_id: campaign.org_id,
            campaign_id: campaignId,
            campaign_lead_id: run.campaign_lead_id,
            kind: 'halted',
            idempotency_key: `halted-${haltReason}-${run.id}`,
            payload: { reason: haltReason },
          }, { transaction: haltTx });
          await haltTx.commit();
        } catch (e) {
          try { await haltTx.rollback(); } catch (_) { /* ignore */ }
          throw e;
        }
      } catch (haltErr) {
        logger.error('halt run failed', { runId: run.id, error: haltErr.message });
        toDefer.push(run.id);
      }
      continue;
    }

    const dayIdx = run.current_day_index;
    const actionIdx = run.current_action_index;
    const day = snapshot.days[dayIdx];
    if (!day || !Array.isArray(day.actions) || !day.actions[actionIdx]) {
      // Snapshot mismatch — mark failed so it doesn't loop.
      await CampaignLeadRun.update(
        { status: 'failed', last_error: 'snapshot_mismatch' },
        { where: { id: run.id } }
      ).catch(() => {});
      continue;
    }
    const action = day.actions[actionIdx];
    const queueName = action.type === 'call' ? CALLS_QUEUE : WHATSAPP_QUEUE;
    const queue = action.type === 'call' ? callsQueue : waQueue;

    // Stable jobId so BullMQ deduplicates on scheduler restart.
    const jobId = `run-${run.id}-d${dayIdx}-a${actionIdx}`;

    try {
      await queue.add(
        'run',
        {
          runId: run.id,
          orgId: campaign.org_id,
          campaignId,
          leadId: run.campaign_lead_id,
          actionType: action.type,
          action,
        },
        {
          jobId,
          attempts: 5,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 7 * 86400 },
        }
      );
      enqueued++;
    } catch (enqErr) {
      logger.error('enqueue failed', { runId: run.id, error: enqErr.message });
      toDefer.push(run.id);
    }
  }

  if (toDefer.length > 0) {
    await CampaignLeadRun.update(
      { status: 'pending', next_run_at: new Date(Date.now() + 30_000), locked_at: null, locked_by: null },
      { where: { id: toDefer } }
    ).catch((e) => logger.error('bulk defer failed', { campaignId, error: e.message }));
  }

  logger.info('tick done', { campaignId, claimed: claimedIds.length, enqueued, deferred: toDefer.length });
}

// ─── Arm / disarm per-campaign repeatable tick ────────────────────────────────

async function armCampaignTick(campaignId) {
  const q = getQueue(SCHEDULER_QUEUE);
  await q.add(
    'tick',
    { campaignId },
    {
      jobId: `tick-${campaignId}`,
      repeat: { every: TICK_INTERVAL_MS },
      removeOnComplete: { age: 86400, count: 100 },
      removeOnFail: { age: 7 * 86400 },
    }
  );
  logger.info('campaign tick armed', { campaignId });
}

async function disarmCampaignTick(campaignId) {
  const q = getQueue(SCHEDULER_QUEUE);
  try {
    await q.removeRepeatable('tick', { every: TICK_INTERVAL_MS, jobId: `tick-${campaignId}` });
    logger.info('campaign tick disarmed', { campaignId });
  } catch (err) {
    // Not fatal if the tick was already removed.
    logger.warn('disarmCampaignTick: removeRepeatable failed (already gone?)', {
      campaignId, error: err.message,
    });
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function startSchedulerWorker() {
  const { sequelize } = require('../models');

  // MariaDB <10.6 lacks SKIP LOCKED — refuse to arm.
  const [versionRows] = await sequelize.query('SELECT VERSION() AS v', {
    type: sequelize.constructor.QueryTypes.SELECT,
  });
  const version = versionRows?.v || '';
  const match = version.match(/^(\d+)\.(\d+)/);
  if (match) {
    const [, major, minor] = match.map(Number);
    if (major < 10 || (major === 10 && minor < 6)) {
      logger.error('scheduler refused: unsupported MariaDB version', { version });
      return null;
    }
  }

  const worker = createWorker(SCHEDULER_QUEUE, schedulerTick, { concurrency: 1 });

  // Arm ticks for all campaigns that are currently running.
  // BullMQ ignores duplicate repeatable jobIds, so this is idempotent.
  const { Campaign } = require('../models');
  const running = await Campaign.findAll({
    where: { status: 'running' },
    attributes: ['id'],
    raw: true,
  });
  for (const { id } of running) {
    await armCampaignTick(id).catch((e) =>
      logger.error('boot: arm tick failed', { campaignId: id, error: e.message })
    );
  }

  logger.info('scheduler armed', {
    interval: '1 min per campaign',
    runningCampaigns: running.length,
  });
  return worker;
}

module.exports = { startSchedulerWorker, armCampaignTick, disarmCampaignTick };
