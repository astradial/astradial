'use strict';

// Shared run-advancement logic called by both channel workers and the
// call-completed webhook (crash-recovery fallback).
//
// Idempotency: advance() re-fetches run.status and lead.status before
// doing any writes.  If the run is already halted/completed by the time
// we arrive (e.g. reply handler fired concurrently), it's a silent no-op.
//
// Same-day sequential multi-action:
//   Next action in the SAME day → enqueue directly to the appropriate
//   channel queue (campaign-calls or campaign-whatsapp) and mark the run
//   'queued'.  No scheduler tick wait — actions in a single day execute
//   back-to-back as fast as each worker can complete them.
//
// Cross-day transition:
//   All actions for the current day done → run becomes 'pending' with
//   next_run_at = NOW() + nextDay.gap_days * 24h.  The per-campaign
//   1-minute tick picks it up when the gap elapses.
//
// Done:
//   Last action of last day → run 'completed'.  If no more pending runs
//   exist for this campaign, disarmCampaignTick() is called so the
//   repeatable BullMQ job stops firing.

const { createLogger } = require('./campaign-logger');

const logger = createLogger({ service: 'campaignAdvance' });

async function advance(run, campaign, touchSucceeded) {
  if (typeof touchSucceeded !== 'boolean') {
    throw new Error('touchSucceeded must be passed explicitly as a boolean to advance()');
  }

  const { CampaignLead, CampaignLeadRun, CampaignEvent } = require('../models');
  const { getQueue, CALLS_QUEUE, WHATSAPP_QUEUE } = require('../jobs/campaignQueues');
  const { disarmCampaignTick } = require('../jobs/campaignSchedulerJob');

  const log = createLogger({
    service: 'campaignAdvance',
    runId: run.id,
    campaignId: campaign.id,
  });

  // --- Idempotency guard: re-fetch current state ---
  const freshRun = await CampaignLeadRun.findByPk(run.id, {
    attributes: ['id', 'status', 'current_day_index', 'current_action_index', 'campaign_lead_id'],
  });
  if (!freshRun) {
    log.warn('advance: run not found (deleted?)');
    return;
  }
  if (!['pending', 'waiting', 'queued'].includes(freshRun.status)) {
    log.debug('advance: run already in terminal state, skipping', { status: freshRun.status });
    return;
  }

  const freshLead = await CampaignLead.findByPk(freshRun.campaign_lead_id, {
    attributes: ['id', 'status'],
  });
  if (!freshLead) {
    log.warn('advance: lead not found');
    return;
  }

  const STOP_STATUSES = ['interested', 'dnc', 'disqualified'];
  let updateFields = {};
  let isHalted = false;
  let isQueued = false;
  let isPending = false;
  let isCompleted = false;
  let nextAction = null;
  let nextActionIdx = 0;
  let dayIdx = freshRun.current_day_index;

  if (STOP_STATUSES.includes(freshLead.status)) {
    isHalted = true;
    updateFields = {
      status: 'halted',
      halted_at: new Date(),
      asterisk_channel_id: null,
      locked_at: null,
      locked_by: null,
    };
  } else {
    const snapshot = campaign.template_snapshot;
    const days = (snapshot && Array.isArray(snapshot.days)) ? snapshot.days : [];
    const actionIdx = freshRun.current_action_index;
    const currentDay = days[dayIdx];

    if (!currentDay) {
      isCompleted = true;
      updateFields = {
        status: 'completed',
        asterisk_channel_id: null,
        locked_at: null,
        locked_by: null,
      };
    } else {
      const actions = Array.isArray(currentDay.actions) ? currentDay.actions : [];
      nextActionIdx = actionIdx + 1;
      const hasNextAction = nextActionIdx < actions.length;
      const hasNextDay = dayIdx + 1 < days.length;

      if (hasNextAction) {
        isQueued = true;
        nextAction = actions[nextActionIdx];
        updateFields = {
          status: 'queued',
          current_action_index: nextActionIdx,
          asterisk_channel_id: null,
          locked_at: null,
          locked_by: null,
          last_error: null,
        };
      } else if (hasNextDay) {
        isPending = true;
        const nextDay = days[dayIdx + 1];
        const gapMs = ((nextDay && nextDay.gap_days) || 1) * 86_400_000;
        updateFields = {
          status: 'pending',
          current_day_index: dayIdx + 1,
          current_action_index: 0,
          next_run_at: new Date(Date.now() + gapMs),
          asterisk_channel_id: null,
          locked_at: null,
          locked_by: null,
          last_error: null,
        };
      } else {
        isCompleted = true;
        updateFields = {
          status: 'completed',
          asterisk_channel_id: null,
          locked_at: null,
          locked_by: null,
          last_error: null,
        };
      }
    }
  }

  // --- Atomically claim and progress the run state ---
  const [affectedCount] = await CampaignLeadRun.update(updateFields, {
    where: { id: freshRun.id, status: freshRun.status }
  });

  if (affectedCount === 0) {
    log.info('advance: run status updated concurrently, aborting side effects', { runId: freshRun.id });
    return;
  }

  // --- Execute side-effects only for successful claimant ---
  if (isQueued && nextAction) {
    const queueName = nextAction.type === 'call' ? CALLS_QUEUE : WHATSAPP_QUEUE;
    const queue = getQueue(queueName);
    await queue.add(
      'run',
      {
        runId: freshRun.id,
        orgId: campaign.org_id,
        campaignId: campaign.id,
        leadId: freshRun.campaign_lead_id,
        actionType: nextAction.type,
        action: nextAction,
      },
      {
        jobId: `run-${freshRun.id}-d${dayIdx}-a${nextActionIdx}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 7 * 86400 },
      }
    );
    log.info('advance: same-day next action enqueued', { queue: queueName, nextActionIdx });
  }

  if (isCompleted) {
    log.info('advance: run completed');
    await _maybeDisarm(campaign, disarmCampaignTick, log);
  }

  if (isHalted) {
    log.info('advance: run halted due to lead status stop');
  }

  // Promote lead from 'raw' to 'contacted' on first successful touch.
  if (touchSucceeded && freshLead.status === 'raw') {
    await CampaignLead.update(
      { status: 'contacted', last_touch_at: new Date() },
      { where: { id: freshLead.id } }
    ).catch(() => {});
  }
}

// Disarm the per-campaign tick if there are no more pending/queued runs.
async function _maybeDisarm(campaign, disarmFn, log) {
  const { CampaignLeadRun } = require('../models');
  const { Op } = require('sequelize');
  const remaining = await CampaignLeadRun.count({
    where: {
      campaign_id: campaign.id,
      status: { [Op.in]: ['pending', 'queued'] },
    },
  });
  if (remaining === 0) {
    log.info('advance: no more pending runs, disarming campaign tick', { campaignId: campaign.id });
    await disarmFn(campaign.id).catch((e) =>
      log.warn('advance: disarmCampaignTick failed', { error: e.message })
    );
  }
}

module.exports = { advance };
