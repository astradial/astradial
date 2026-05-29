'use strict';

const { createLogger } = require('../services/campaign-logger');

const POLL_INTERVAL_MS = 5_000;
const ORIGINATE_GRACE_MS = 10_000;
const DEFAULT_MAX_CONCURRENT = 30;

const logger = createLogger({ service: 'campaignCallWorker' });

function phoneFromChannel(channelName) {
  const m = channelName.match(/^(?:PJSIP|SIP|Local)\/([^@!]+)/i);
  return m ? m[1] : null;
}

function buildActivePhoneSet(channelNames) {
  const set = new Set();
  for (const name of channelNames) {
    const phone = phoneFromChannel(name);
    if (phone) set.add(phone);
  }
  return set;
}

async function runPoll() {
  const { Campaign, CampaignLead, CampaignLeadRun, Organization, sequelize } = require('../models');
  const { Op } = require('sequelize');
  const { advance } = require('../services/campaign-advance');
  const { runCall } = require('../services/campaign-actions');
  const AsteriskManager = require('../services/asterisk/asteriskManager');

  const runningCampaigns = await Campaign.findAll({
    where: { status: 'running' },
    attributes: ['id', 'org_id', 'template_snapshot', 'avg_call_seconds'],
    raw: true,
  });
  if (runningCampaigns.length === 0) return;

  const orgIds = [...new Set(runningCampaigns.map((c) => c.org_id))];
  const orgs = await Organization.findAll({
    where: { id: orgIds },
    attributes: ['id', 'context_prefix', 'settings'],
    raw: true,
  });
  const orgById = Object.fromEntries(orgs.map((o) => [o.id, o]));
  const campaignById = Object.fromEntries(runningCampaigns.map((c) => [c.id, c]));

  for (const orgId of orgIds) {
    const org = orgById[orgId];
    if (!org) continue;

    const maxConcurrent = org.settings?.campaign_max_concurrent_calls || DEFAULT_MAX_CONCURRENT;

    const ami = new AsteriskManager();
    let activeChannels = [];
    try {
      await ami.connect();
      activeChannels = await ami.getActiveChannels(org.context_prefix);
    } catch (amiErr) {
      logger.warn('AMI unavailable', { orgId, error: amiErr.message });
      try { await ami.disconnect(); } catch (_) {}
      continue;
    }

    const activePhones = buildActivePhoneSet(activeChannels);
    const liveCount = activeChannels.length;

    // Phase 1: Advance completed calls
    const graceThreshold = new Date(Date.now() - ORIGINATE_GRACE_MS);
    const waitingRuns = await CampaignLeadRun.findAll({
      where: { org_id: orgId, status: 'waiting', updated_at: { [Op.lt]: graceThreshold } },
      include: [{ model: CampaignLead, as: 'lead', attributes: ['id', 'phone', 'status'], required: true }],
    });

    for (const run of waitingRuns) {
      const phone = run.lead?.phone || run.asterisk_channel_id;
      if (!phone) continue;
      const normalizedPhone = phone.replace(/[^\d+]/g, '');
      const stillActive = activePhones.has(phone) || activePhones.has(normalizedPhone);
      if (stillActive) continue;
      const campaign = campaignById[run.campaign_id];
      if (!campaign) continue;
      
      const TIMEOUT_MS = 15 * 60 * 1000;
      if (Date.now() - run.updated_at.getTime() > TIMEOUT_MS) {
        try {
          logger.warn('call worker timeout: no completion webhook received, advancing as failed', { runId: run.id });
          await advance(run, campaign, false);
        } catch (err) {
          logger.error('advance failed', { runId: run.id, error: err.message });
        }
      }
    }

    // Phase 2: Originate queued runs from DB
    const freeSlots = Math.max(0, maxConcurrent - liveCount);
    if (freeSlots <= 0) {
      try { await ami.disconnect(); } catch (_) {}
      continue;
    }

    const queuedRuns = await CampaignLeadRun.findAll({
      where: { org_id: orgId, status: 'queued' },
      limit: freeSlots,
      order: [['next_run_at', 'ASC']],
      include: [{ model: CampaignLead, as: 'lead', attributes: ['id', 'phone', 'status'], required: true }],
    });
    console.log("[CALLWORKER] found queued:", queuedRuns.length, "freeSlots:", freeSlots);

    let dequeued = 0;
    for (const run of queuedRuns) {
      const lead = run.lead;
      if (!lead || ['dnc', 'interested', 'disqualified'].includes(lead.status)) {
        await run.update({ status: 'halted', halted_at: new Date(), locked_at: null, locked_by: null });
        continue;
      }

      const campaign = campaignById[run.campaign_id];
      if (!campaign) continue;

      const snapshot = campaign.template_snapshot;
      if (!snapshot || !Array.isArray(snapshot.days)) continue;
      const day = snapshot.days[run.current_day_index];
      if (!day || !Array.isArray(day.actions)) continue;
      const action = day.actions[run.current_action_index];
      if (!action || action.type !== 'call') continue;

      try {
        logger.info('originating call', { runId: run.id, phone: lead.phone, campaignId: run.campaign_id });
        const result = await runCall({ orgId, campaignId: run.campaign_id, lead, run, action, campaignRow: campaign });

        if (result.ok) {
          await run.update({ status: 'waiting', asterisk_channel_id: lead.phone, locked_at: new Date(), locked_by: 'call-worker' });
          dequeued++;
          logger.info('call originated', { runId: run.id, phone: lead.phone });
        } else {
          await run.update({ status: 'failed', last_error: result.error || 'originate failed' });
          logger.error('originate not ok', { runId: run.id, error: result.error });
        }
      } catch (err) {
        logger.error('call originate error', { runId: run.id, error: err.message });
        await run.update({ status: 'failed', last_error: err.message });
      }
    }

    try { await ami.disconnect(); } catch (_) {}

    if (dequeued > 0 || waitingRuns.length > 0) {
      logger.debug('poll tick done', { orgId, liveCount, freeSlots, dequeued, advancedCompleted: waitingRuns.length });
    }
  }
}

let _intervalId = null;

function startCallWorker() {
  if (_intervalId) return;
  logger.info('call worker started', { pollIntervalMs: POLL_INTERVAL_MS });
  _intervalId = setInterval(() => {
    runPoll().catch((err) => logger.error('poll tick threw', { error: err.message, stack: err.stack }));
  }, POLL_INTERVAL_MS);
  runPoll().catch((err) => logger.error('poll tick threw (initial)', { error: err.message }));
}

function stopCallWorker() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
    logger.info('call worker stopped');
  }
}

module.exports = { startCallWorker, stopCallWorker, runPoll };
