'use strict';

// Phase D call worker — drives all outbound campaign calls.
//
// Design: a single setInterval fires every 5 seconds (not BullMQ auto-poll).
// Each tick executes two phases:
//
//   Phase 1 — Advance completed calls
//     Query all 'waiting' campaign_lead_runs for every org that has a
//     running campaign.  For each run, check whether the stored
//     asterisk_channel_id (= lead's phone) still appears in Asterisk's
//     active channel list (CoreShowChannels via AMI).  If the channel is
//     gone the call has ended → call advance(run, campaign).
//     Grace period: runs marked 'waiting' in the last 10 s are skipped
//     so a freshly originated call has time to appear in Asterisk.
//
//   Phase 2 — Dequeue new calls
//     Count live channels for each org (from CoreShowChannels).
//     freeSlots = org.settings.campaign_max_concurrent_calls − liveCount
//     Dequeue up to freeSlots jobs from campaign-calls queue and originate
//     them via AMI.  On success, store asterisk_channel_id = lead.phone
//     and mark run 'waiting'.  On failure, BullMQ exponential retry handles
//     the backoff (attempts: 5, delay: 60 s → 2 m → 4 m → 8 m → 16 m).
//
// The call-completed webhook in webhooks.js is retained as a crash-recovery
// fallback; it calls the same advance() function which is idempotent.

const { createLogger } = require('../services/campaign-logger');

const POLL_INTERVAL_MS = 5_000;
const ORIGINATE_GRACE_MS = 10_000; // don't advance a run marked waiting < 10 s ago
const DEFAULT_MAX_CONCURRENT = 30;

const logger = createLogger({ service: 'campaignCallWorker' });

// Extract the destination phone from an Asterisk channel name.
// e.g. "PJSIP/+919812345678@trunk1-00000001" → "+919812345678"
//      "Local/+919812345678@org_abc_outbound-00000001" → "+919812345678"
function phoneFromChannel(channelName) {
  const m = channelName.match(/^(?:PJSIP|SIP|Local)\/([^@!]+)/i);
  return m ? m[1] : null;
}

// Build a Set<phone> of all active phones visible in an org's Asterisk context.
function buildActivePhoneSet(channelNames) {
  const set = new Set();
  for (const name of channelNames) {
    const phone = phoneFromChannel(name);
    if (phone) set.add(phone);
  }
  return set;
}

async function runPoll() {
  const {
    Campaign, CampaignLead, CampaignLeadRun, Organization, sequelize,
  } = require('../models');
  const { Op } = require('sequelize');
  const { getQueue, CALLS_QUEUE } = require('./campaignQueues');
  const { advance } = require('../services/campaign-advance');
  const { runCall } = require('../services/campaign-actions');
  const AsteriskManager = require('../services/asterisk/asteriskManager');

  // Load all orgs that have at least one running campaign.
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
  const campaignsByOrg = {};
  for (const c of runningCampaigns) {
    (campaignsByOrg[c.org_id] = campaignsByOrg[c.org_id] || []).push(c);
  }

  for (const orgId of orgIds) {
    const org = orgById[orgId];
    if (!org) continue;

    const maxConcurrent = (
      org.settings?.campaign_max_concurrent_calls
      || DEFAULT_MAX_CONCURRENT
    );

    // Open one AMI connection per org per poll tick.
    const ami = new AsteriskManager();
    let activeChannels = [];
    try {
      await ami.connect();
      activeChannels = await ami.getActiveChannels(org.context_prefix);
    } catch (amiErr) {
      logger.warn('AMI unavailable for org, skipping poll', { orgId, error: amiErr.message });
      try { await ami.disconnect(); } catch (_) { /* ignore */ }
      continue;
    }

    const activePhones = buildActivePhoneSet(activeChannels);
    const liveCount = activeChannels.length;

    // ── Phase 1: Advance completed calls ──────────────────────────────────
    const graceThreshold = new Date(Date.now() - ORIGINATE_GRACE_MS);
    const waitingRuns = await CampaignLeadRun.findAll({
      where: {
        org_id: orgId,
        status: 'waiting',
        updated_at: { [Op.lt]: graceThreshold },
      },
      include: [
        {
          model: CampaignLead,
          as: 'lead',
          attributes: ['id', 'phone', 'status'],
          required: true,
        },
      ],
    });

    for (const run of waitingRuns) {
      const phone = run.lead?.phone || run.asterisk_channel_id;
      if (!phone) continue;
      // Normalize: strip non-digit/non-plus for comparison with what Asterisk shows.
      const normalizedPhone = phone.replace(/[^\d+]/g, '');
      const stillActive = activePhones.has(phone) || activePhones.has(normalizedPhone);
      if (stillActive) continue; // call still in progress

      const campaign = campaignById[run.campaign_id];
      if (!campaign) continue;

      try {
        await advance(run, campaign);
      } catch (err) {
        logger.error('advance failed for completed call', { runId: run.id, error: err.message });
      }
    }

    // ── Phase 2: Dequeue new calls ────────────────────────────────────────
    const freeSlots = Math.max(0, maxConcurrent - liveCount);
    if (freeSlots <= 0) {
      try { await ami.disconnect(); } catch (_) { /* ignore */ }
      continue;
    }

    const callsQueue = getQueue(CALLS_QUEUE);
    let dequeued = 0;

    for (let i = 0; i < freeSlots; i++) {
      // BullMQ getNextJob() atomically dequeues the oldest waiting job.
      const job = await callsQueue.getNextJob().catch(() => null);
      if (!job) break;

      const { runId, campaignId, leadId, action } = job.data;
      const campaign = campaignById[campaignId];

      try {
        // Re-fetch run to ensure it's still queued (idempotency guard).
        const run = await CampaignLeadRun.findByPk(runId);
        if (!run || run.status !== 'queued') {
          await job.moveToCompleted('stale', job.token, false).catch(() => {});
          continue;
        }

        const lead = await CampaignLead.findByPk(leadId, { attributes: ['id', 'phone', 'status'] });
        if (!lead || ['dnc', 'interested', 'disqualified'].includes(lead.status)) {
          await run.update({ status: 'halted', halted_at: new Date(), locked_at: null, locked_by: null });
          await job.moveToCompleted('lead_stopped', job.token, false).catch(() => {});
          continue;
        }

        const result = await runCall({
          orgId,
          campaignId,
          lead,
          run,
          action,
          campaignRow: campaign,
        });

        if (result.ok) {
          // Store the lead's phone as the Asterisk correlation key.
          await run.update({
            status: 'waiting',
            asterisk_channel_id: lead.phone,
            locked_at: new Date(),
            locked_by: 'call-worker',
          });
          await job.moveToCompleted('originated', job.token, false).catch(() => {});
          dequeued++;
        } else {
          // Originate failed — let BullMQ handle exponential retry.
          await run.update({
            status: 'queued', // stays queued; BullMQ will retry the job
            last_error: result.error || 'originate failed',
          });
          throw new Error(result.error || 'originate failed');
        }
      } catch (err) {
        logger.error('call originate error', { runId, error: err.message });
        // BullMQ will retry the job with exponential backoff (configured on enqueue).
        await job.moveToFailed({ message: err.message }, job.token, false).catch(() => {});
      }
    }

    try { await ami.disconnect(); } catch (_) { /* ignore */ }

    if (dequeued > 0 || waitingRuns.length > 0) {
      logger.debug('poll tick done', {
        orgId,
        liveCount,
        freeSlots,
        dequeued,
        advancedCompleted: waitingRuns.length,
      });
    }
  }
}

let _intervalId = null;

function startCallWorker() {
  if (_intervalId) return; // already running
  logger.info('call worker started', { pollIntervalMs: POLL_INTERVAL_MS });
  _intervalId = setInterval(() => {
    runPoll().catch((err) =>
      logger.error('poll tick threw', { error: err.message, stack: err.stack })
    );
  }, POLL_INTERVAL_MS);
  // Run immediately on boot rather than waiting for the first interval.
  runPoll().catch((err) =>
    logger.error('poll tick threw (initial)', { error: err.message })
  );
}

function stopCallWorker() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
    logger.info('call worker stopped');
  }
}

module.exports = { startCallWorker, stopCallWorker };
