'use strict';

const { createWorker, DISPATCH_QUEUE } = require('./campaignQueues');
const { createLogger } = require('../services/campaign-logger');

async function dispatchJob(job) {
  const { runId, orgId, campaignId, leadId, actionType, action, campaignRow } = job.data;
  const log = createLogger({ service: 'campaignDispatch', runId, campaignId, leadId, actionType });

  const { Campaign, CampaignLead, CampaignLeadRun, CampaignEvent, sequelize } = require('../models');
  const { runWhatsApp, runCall } = require('../services/campaign-actions');
  const { releaseCallSlot } = require('../services/campaign-concurrency');

  const [run, lead, campaign] = await Promise.all([
    CampaignLeadRun.findByPk(runId),
    CampaignLead.findByPk(leadId),
    Campaign.findByPk(campaignId),
  ]);

  if (!run || run.status !== 'waiting') {
    log.debug('run not in waiting state', { runStatus: run?.status });
    return;
  }

  if (!campaign || campaign.status === 'paused') {
    log.info('campaign paused, deferring run');
    await run.update({
      status: 'pending',
      next_run_at: new Date(Date.now() + 30_000),
      locked_at: null,
      locked_by: null,
    });
    return;
  }

  if (!lead || lead.status === 'dnc') {
    log.info('lead dnc, halting run');
    await run.update({ status: 'halted', halted_at: new Date() });
    await CampaignEvent.create({
      org_id: orgId,
      campaign_id: campaignId,
      campaign_lead_id: leadId,
      kind: 'halted',
      idempotency_key: `halted-dispatch-${runId}`,
      payload: { reason: 'dnc' },
    }).catch(() => {});
    return;
  }

  const snapshot = (campaign.template_snapshot) || campaignRow.template_snapshot;
  const dayIdx = run.current_day_index;
  const actionIdx = run.current_action_index;

  let result;
  try {
    if (actionType === 'call') {
      result = await runCall({ orgId, campaignId, lead, run, action, campaignRow: campaign });
    } else {
      result = await runWhatsApp({ orgId, campaignId, lead, run, action, campaignRow: campaign });
    }
  } catch (err) {
    result = { ok: false, transient: true, error: err.message };
    log.error('action threw', { error: err.message });
  }

  if (result.ok) {
    log.info('action success');
    // Advance the run to the next action or next day.
    const day = snapshot && snapshot.days && snapshot.days[dayIdx];
    const hasNextAction = day && Array.isArray(day.actions) && actionIdx + 1 < day.actions.length;
    const hasNextDay = snapshot && Array.isArray(snapshot.days) && dayIdx + 1 < snapshot.days.length;

    if (hasNextAction) {
      await run.update({
        status: 'pending',
        current_action_index: actionIdx + 1,
        next_run_at: new Date(),
        locked_at: null,
        locked_by: null,
        last_error: null,
      });
    } else if (hasNextDay) {
      const nextDay = snapshot.days[dayIdx + 1];
      // gap_days on the next day node; fall back to 1 day if absent.
      const gapMs = ((nextDay && nextDay.gap_days) || 1) * 86_400_000;
      await run.update({
        status: 'pending',
        current_day_index: dayIdx + 1,
        current_action_index: 0,
        next_run_at: new Date(Date.now() + gapMs),
        locked_at: null,
        locked_by: null,
        last_error: null,
      });
    } else {
      await run.update({
        status: 'completed',
        locked_at: null,
        locked_by: null,
        last_error: null,
      });
    }

    // Promote lead from raw to contacted on first successful touch.
    if (lead.status === 'raw') {
      await lead.update({ status: 'contacted', last_touch_at: new Date() }).catch(() => {});
    }

    if (actionType === 'call') {
      await releaseCallSlot(orgId, campaignId).catch(() => {});
    }
    return;
  }

  // Failure path.
  if (actionType === 'call') {
    await releaseCallSlot(orgId, campaignId).catch(() => {});
  }

  const attempts = (run.attempts || 0) + 1;
  const failKind = actionType === 'call' ? 'call_failed' : 'whatsapp_sent';

  if (result.transient && attempts < 3) {
    const delayMs = attempts === 1 ? 5 * 60_000 : 30 * 60_000;
    log.info('transient failure, retrying', { attempts, delayMs, error: result.error });
    await run.update({
      status: 'pending',
      attempts,
      next_run_at: new Date(Date.now() + delayMs),
      locked_at: null,
      locked_by: null,
      last_error: result.error || null,
    });
  } else {
    log.warn('action failed permanently', { attempts, transient: result.transient, error: result.error });
    await run.update({
      status: 'failed',
      attempts,
      locked_at: null,
      locked_by: null,
      last_error: result.error || null,
    });
    await CampaignEvent.create({
      org_id: orgId,
      campaign_id: campaignId,
      campaign_lead_id: leadId,
      kind: failKind,
      idempotency_key: `fail-${runId}-${dayIdx}-${actionIdx}-${attempts}`,
      payload: { error: result.error, attempts },
    }).catch(() => {});
  }
}

function startDispatchWorker() {
  return createWorker(DISPATCH_QUEUE, dispatchJob, { concurrency: 5 });
}

module.exports = { startDispatchWorker };
