'use strict';

// Phase D WhatsApp worker — BullMQ concurrency 10.
//
// Before each job: check the Redis sliding-window rate limiter
//   (org + 60 s window).  If the org is at campaign_max_whatsapp_per_minute
//   (default 60), throw a retryable error — BullMQ re-queues with delay.
//
// On success: increment the rate-limiter counter, call advance(run, campaign)
// to move the run to the next action or next day.
//
// On failure: BullMQ exponential retry handles backoff
//   (attempts: 5, delay: 60 s → 2 m → 4 m → 8 m → 16 m).

'use strict';

const { createWorker, WHATSAPP_QUEUE } = require('./campaignQueues');
const { createLogger } = require('../services/campaign-logger');

const DEFAULT_MAX_WPM = 60;

const logger = createLogger({ service: 'campaignWhatsAppWorker' });

async function processWhatsAppJob(job) {
  const { runId, orgId, campaignId, leadId, action } = job.data;
  const log = createLogger({ service: 'campaignWhatsAppWorker', runId, campaignId, leadId });

  const { Campaign, CampaignLead, CampaignLeadRun, CampaignEvent } = require('../models');
  const { runWhatsApp } = require('../services/campaign-actions');
  const { tryConsume } = require('../services/campaign-rate-limiter');
  const { advance } = require('../services/campaign-advance');
  const { Organization } = require('../models');

  // Re-fetch everything for idempotency (job may be a BullMQ retry).
  const [run, lead, campaign, org] = await Promise.all([
    CampaignLeadRun.findByPk(runId),
    CampaignLead.findByPk(leadId, { attributes: ['id', 'phone', 'status'] }),
    Campaign.findByPk(campaignId),
    Organization.findByPk(orgId, { attributes: ['id', 'settings'] }),
  ]);

  if (!run || run.status !== 'queued') {
    log.debug('whatsapp job: run not in queued state, skipping', { runStatus: run?.status });
    return;
  }

  if (!campaign || campaign.status === 'paused') {
    log.info('whatsapp job: campaign paused, deferring run');
    await run.update({ status: 'pending', next_run_at: new Date(Date.now() + 30_000), locked_at: null, locked_by: null });
    return;
  }

  if (!lead || ['dnc', 'interested', 'disqualified'].includes(lead.status)) {
    log.info('whatsapp job: lead stopped, halting run', { leadStatus: lead?.status });
    await run.update({ status: 'halted', halted_at: new Date(), locked_at: null, locked_by: null });
    return;
  }

  // Rate-limit check: org-level WhatsApp per-minute cap.
  const maxWpm = org?.settings?.campaign_max_whatsapp_per_minute ?? DEFAULT_MAX_WPM;
  const allowed = await tryConsume(orgId, 'whatsapp', maxWpm);
  if (!allowed) {
    // Throw so BullMQ re-queues with exponential delay.
    const err = new Error(`WA rate limit reached for org ${orgId} (max ${maxWpm}/min)`);
    err.retryable = true;
    throw err;
  }

  const result = await runWhatsApp({ orgId, campaignId, lead, run, action, campaignRow: campaign });

  if (result.ok) {
    log.info('whatsapp sent', { requestId: result.requestId });

    // Save Timeline event
    try {
      const idempotencyKey = `whatsapp-sent-${run.id}-d${run.current_day_index}-a${run.current_action_index}`;
      await CampaignEvent.create({
        org_id: orgId,
        campaign_id: campaignId,
        campaign_lead_id: leadId,
        kind: 'whatsapp_sent',
        idempotency_key: idempotencyKey,
        payload: {
          direction: 'outbound',
          channel: 'whatsapp',
          template_name: action.template,
          send_status: 'sent',
          request_id: result.requestId || null,
          detail: `Sent WhatsApp template: ${action.template}`
        }
      });
    } catch (eventErr) {
      if (eventErr.name === 'SequelizeUniqueConstraintError') {
        log.info('whatsapp campaign event already created (idempotency match), skipping create');
      } else {
        log.warn('Failed to log campaign event for whatsapp send', { error: eventErr.message });
      }
    }

    await advance(run, campaign, true);
    return;
  }

  // Failure path.
  if (result.transient) {
    log.warn('whatsapp transient failure, will retry', { error: result.error });
    throw new Error(result.error || 'transient whatsapp failure');
  }

  // Permanent failure — mark failed, don't retry via BullMQ.
  log.warn('whatsapp permanent failure', { error: result.error });
  await run.update({
    status: 'failed',
    last_error: result.error || 'permanent whatsapp failure',
    locked_at: null,
    locked_by: null,
  });
  // Returning normally so BullMQ marks the job "completed" (the run itself is "failed").
}

function startWhatsAppWorker() {
  return createWorker(WHATSAPP_QUEUE, processWhatsAppJob, {
    concurrency: 10,
    // Exponential retry: 60s → 2m → 4m → 8m → 16m (5 attempts total).
    settings: {
      backoffStrategy: (attemptsMade) => Math.pow(2, attemptsMade - 1) * 60_000,
    },
  });
}

module.exports = { startWhatsAppWorker };
