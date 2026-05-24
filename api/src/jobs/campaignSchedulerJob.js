'use strict';

const { createWorker, getQueue, SCHEDULER_QUEUE } = require('./campaignQueues');
const { Op, QueryTypes } = require('sequelize');
const { createLogger } = require('../services/campaign-logger');

const TICK_BATCH = 500;
const DEFER_MS = 30_000;
const logger = createLogger({ service: 'campaignScheduler' });

async function schedulerTick(job) {
  const tickStart = Date.now();
  // Lazy-require models so this module loads even before sequelize is ready.
  const { Campaign, CampaignLead, CampaignLeadRun, CampaignEvent, sequelize } = require('../models');
  const { tryAcquireCallSlot } = require('../services/campaign-concurrency');
  const { tryConsume } = require('../services/campaign-rate-limiter');
  const { getQueue: _gq, DISPATCH_QUEUE } = require('./campaignQueues');

  const campaigns = await Campaign.findAll({
    where: { status: 'running' },
    attributes: ['id', 'org_id', 'template_snapshot', 'max_concurrent_calls', 'max_sends_per_minute'],
    raw: true,
  });

  if (campaigns.length === 0) {
    logger.debug('tick: no running campaigns');
    return;
  }

  logger.info('tick start', { count: campaigns.length });
  let totalClaimed = 0;
  let totalEnqueued = 0;

  for (const campaign of campaigns) {
    try {
      const snapshot = campaign.template_snapshot;
      if (!snapshot || !Array.isArray(snapshot.days) || snapshot.days.length === 0) continue;

      const now = new Date();

      // Claim pending runs with SKIP LOCKED to allow multiple scheduler
      // replicas to coexist safely without double-dispatching.
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
          replacements: { campaignId: campaign.id, now, limit: TICK_BATCH },
          type: QueryTypes.SELECT,
          transaction: tx,
        });

        if (!rows || rows.length === 0) {
          await tx.rollback();
          continue;
        }

        claimedIds = rows.map((r) => r.id);

        // Lock the rows by marking them waiting immediately so no other
        // tick picks them up while we check concurrency/rate limits.
        // We may revert individual rows back to pending below if limits
        // are hit; the remainder proceed to the dispatch queue.
        await CampaignLeadRun.update(
          { status: 'waiting', locked_at: now, locked_by: 'scheduler' },
          { where: { id: claimedIds }, transaction: tx }
        );

        await tx.commit();
      } catch (txErr) {
        try { await tx.rollback(); } catch (_) { /* ignore */ }
        throw txErr;
      }

      totalClaimed += claimedIds.length;

      // Load the full run rows plus their leads.
      const runs = await CampaignLeadRun.findAll({
        where: { id: claimedIds },
        raw: true,
      });

      const leadIds = runs.map((r) => r.campaign_lead_id);
      const leads = await CampaignLead.findAll({
        where: { id: leadIds },
        attributes: ['id', 'status'],
        raw: true,
      });
      const leadById = Object.fromEntries(leads.map((l) => [l.id, l]));

      const dispatchQueue = _gq(DISPATCH_QUEUE);

      for (const run of runs) {
        const lead = leadById[run.campaign_lead_id];

        // DNC check: halt immediately.
        if (!lead || lead.status === 'dnc') {
          try {
            await CampaignLeadRun.update(
              { status: 'halted', halted_at: new Date() },
              { where: { id: run.id } }
            );
            await CampaignEvent.create({
              org_id: campaign.org_id,
              campaign_id: campaign.id,
              campaign_lead_id: run.campaign_lead_id,
              kind: 'halted',
              idempotency_key: `halted-dnc-${run.id}`,
              payload: { reason: 'dnc' },
            });
          } catch (haltErr) {
            logger.error('halt dnc run failed', { runId: run.id, error: haltErr.message });
          }
          continue;
        }

        const dayIdx = run.current_day_index;
        const actionIdx = run.current_action_index;
        const day = snapshot.days[dayIdx];
        if (!day || !Array.isArray(day.actions) || !day.actions[actionIdx]) {
          // Snapshot has drifted; mark failed.
          await CampaignLeadRun.update(
            { status: 'failed', last_error: 'snapshot_mismatch' },
            { where: { id: run.id } }
          ).catch(() => {});
          continue;
        }
        const action = day.actions[actionIdx];

        // Concurrency / rate-limit gates.
        if (action.type === 'call') {
          const acquired = await tryAcquireCallSlot(
            campaign.org_id,
            campaign.id,
            campaign.max_concurrent_calls || 10
          );
          if (!acquired) {
            await CampaignLeadRun.update(
              { status: 'pending', next_run_at: new Date(Date.now() + DEFER_MS), locked_at: null, locked_by: null },
              { where: { id: run.id } }
            ).catch(() => {});
            continue;
          }
        } else if (action.type === 'whatsapp') {
          const allowed = await tryConsume(campaign.org_id, 'whatsapp', campaign.max_sends_per_minute);
          if (!allowed) {
            await CampaignLeadRun.update(
              { status: 'pending', next_run_at: new Date(Date.now() + DEFER_MS), locked_at: null, locked_by: null },
              { where: { id: run.id } }
            ).catch(() => {});
            continue;
          }
        }

        // Insert the pre-dispatch event with idempotency_key to guard
        // against double-dispatch on scheduler crashes and restarts.
        const iKey = `dispatch-${run.id}-${dayIdx}-${actionIdx}-${run.attempts}`;
        const eventKind = action.type === 'call' ? 'call_started' : 'whatsapp_sent';
        try {
          await CampaignEvent.create({
            org_id: campaign.org_id,
            campaign_id: campaign.id,
            campaign_lead_id: run.campaign_lead_id,
            kind: eventKind,
            idempotency_key: iKey,
            payload: { action_type: action.type, day_index: dayIdx, action_index: actionIdx },
          });
        } catch (evtErr) {
          // Unique constraint violation — already dispatched; skip enqueue.
          if (evtErr.name === 'SequelizeUniqueConstraintError' || (evtErr.original && evtErr.original.code === 'ER_DUP_ENTRY')) {
            await CampaignLeadRun.update(
              { status: 'pending', locked_at: null, locked_by: null },
              { where: { id: run.id } }
            ).catch(() => {});
            continue;
          }
          throw evtErr;
        }

        // Enqueue dispatch job. jobId is stable so BullMQ deduplicates if
        // we crash between insert and enqueue and retry on restart.
        try {
          await dispatchQueue.add(
            'dispatch',
            {
              runId: run.id,
              orgId: campaign.org_id,
              campaignId: campaign.id,
              leadId: run.campaign_lead_id,
              actionType: action.type,
              action,
              campaignRow: {
                id: campaign.id,
                org_id: campaign.org_id,
                max_concurrent_calls: campaign.max_concurrent_calls,
                max_sends_per_minute: campaign.max_sends_per_minute,
                template_snapshot: snapshot,
              },
            },
            {
              jobId: `dispatch-${run.id}`,
              removeOnComplete: { age: 86400, count: 1000 },
              removeOnFail: { age: 7 * 86400 },
            }
          );
          totalEnqueued += 1;
        } catch (enqErr) {
          logger.error('enqueue run failed', { runId: run.id, error: enqErr.message });
          // Revert to pending so the next tick retries.
          await CampaignLeadRun.update(
            { status: 'pending', locked_at: null, locked_by: null },
            { where: { id: run.id } }
          ).catch(() => {});
        }
      }
    } catch (campaignErr) {
      logger.error('campaign processing error', { campaignId: campaign.id, error: campaignErr.message });
    }
  }

  const ms = Date.now() - tickStart;
  logger.info('tick done', { totalClaimed, totalEnqueued, durationMs: ms });
}

async function startSchedulerWorker() {
  const { sequelize } = require('../models');

  // MariaDB <10.6 lacks SKIP LOCKED — refuse to arm the scheduler.
  const [versionRows] = await sequelize.query('SELECT VERSION() AS v', { type: sequelize.constructor.QueryTypes.SELECT });
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
  const q = getQueue(SCHEDULER_QUEUE);
  await q.add('tick', {}, {
    repeat: { every: 5 * 60 * 1000 },
    jobId: 'scheduler-tick',
  });
  logger.info('scheduler armed', { interval: '5 min', system: 'BullMQ repeatable tick' });
  return worker;
}

module.exports = { startSchedulerWorker };
