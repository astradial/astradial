'use strict';

const { CampaignLead, CampaignLeadRun, CampaignEvent, Campaign, sequelize } = require('../models');
const { Op } = require('sequelize');
const { createLogger } = require('./campaign-logger');

const logger = createLogger({ service: 'campaignReplyHandler' });

// Collect all interest_keywords from actions of the given type in the snapshot.
// Scans ALL days/actions (not just the current one) so the full keyword vocabulary
// is available regardless of where in the cadence the lead currently is.
// actionType: 'whatsapp' | 'call' | null (null = collect from all types)
function extractKeywords(snapshot, actionType = null) {
  const keywords = [];
  if (!snapshot || !Array.isArray(snapshot.days)) return keywords;
  for (const day of snapshot.days) {
    if (!Array.isArray(day.actions)) continue;
    for (const action of day.actions) {
      if (actionType && action.type !== actionType) continue;
      if (Array.isArray(action.interest_keywords)) {
        keywords.push(...action.interest_keywords);
      }
    }
  }
  return keywords;
}

// Returns true if any keyword appears (case-insensitive substring) in the message.
function matchesKeywords(message, keywords) {
  const msgLower = (message || '').toLowerCase();
  return keywords.some((kw) => msgLower.includes(kw.toLowerCase()));
}

// Called when a MSG91 inbound webhook fires for a lead's phone.
//
// Classification logic:
//   • If the campaign's WhatsApp actions define interest_keywords and the
//     reply matches ≥1 keyword → mark lead "interested", halt the run.
//   • If keywords are configured but none match → mark lead "engaged" (if
//     currently raw/contacted), record a whatsapp_replied event, leave run
//     running so outreach continues.
//   • If no keywords are configured anywhere → treat any reply as "interested"
//     and halt (backwards-compatible default).
//
// Only the ONE most-recently-touched active run for this phone is affected —
// a phone enrolled in multiple campaigns is NOT mass-halted.
async function markInterestedAndHalt(orgId, phone, message = '') {
  const log = createLogger({ service: 'campaignReplyHandler', orgId, phone });

  const activeRun = await CampaignLeadRun.findOne({
    where: {
      org_id: orgId,
      status: { [Op.in]: ['pending', 'waiting'] },
    },
    include: [
      {
        model: CampaignLead,
        as: 'lead',
        where: { org_id: orgId, phone },
        required: true,
      },
    ],
    order: [[{ model: CampaignLead, as: 'lead' }, 'last_touch_at', 'DESC']],
  });

  if (!activeRun) {
    log.info('inbound reply: no active run found for phone', { phone });
    return { halted: 0, classified: null };
  }

  const lead = activeRun.lead;

  // Load the campaign snapshot for keyword matching.
  const campaign = await Campaign.findByPk(lead.campaign_id, {
    attributes: ['template_snapshot'],
    raw: true,
  });

  const snapshot = campaign && campaign.template_snapshot;
  const keywords = extractKeywords(snapshot, 'whatsapp');
  const hasKeywords = keywords.length > 0;

  // Determine classification: interested (halt) vs engaged (continue).
  const isInterested = !hasKeywords || matchesKeywords(message, keywords);

  if (isInterested) {
    const tx = await sequelize.transaction();
    try {
      await lead.update({ status: 'interested' }, { transaction: tx });
      await activeRun.update(
        { status: 'halted', halted_at: new Date() },
        { transaction: tx }
      );
      await CampaignEvent.create({
        org_id: orgId,
        campaign_id: lead.campaign_id,
        campaign_lead_id: lead.id,
        kind: 'halted',
        idempotency_key: `halted-reply-${activeRun.id}`,
        payload: { reason: 'inbound_reply', ...(message && { message }) },
      }, { transaction: tx });
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
      log.error('failed to halt interested lead', { leadId: lead.id, error: e.message });
      return { halted: 0, classified: null };
    }

    log.info('lead marked interested, run halted', { leadId: lead.id, campaignId: lead.campaign_id });
    return { halted: 1, classified: 'interested' };
  }

  // Non-matching reply → engaged: record event, bump lead status if early-stage.
  const tx = await sequelize.transaction();
  try {
    const EARLY_STATUSES = new Set(['raw', 'contacted']);
    if (EARLY_STATUSES.has(lead.status)) {
      await lead.update({ status: 'engaged' }, { transaction: tx });
    }
    await CampaignEvent.create({
      org_id: orgId,
      campaign_id: lead.campaign_id,
      campaign_lead_id: lead.id,
      kind: 'whatsapp_replied',
      idempotency_key: `engaged-reply-${activeRun.id}-${Date.now()}`,
      payload: { ...(message && { message }) },
    }, { transaction: tx });
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* ignore */ }
    log.error('failed to record engaged reply', { leadId: lead.id, error: e.message });
    return { halted: 0, classified: null };
  }

  log.info('lead marked engaged on non-matching reply', { leadId: lead.id, campaignId: lead.campaign_id });
  return { halted: 0, classified: 'engaged' };
}

// Called when the pipecat bot POSTs /webhooks/call-result with a transcript.
//
// Classification logic (mirrors markInterestedAndHalt for WhatsApp):
//   • Call actions define interest_keywords → transcript substring match ≥1 → interested + halt
//   • Keywords configured but none match → engaged (if raw/contacted), run continues
//   • No keywords configured on any call action → treat any completed call as interested + halt
//
// campaignLeadId is known from the channel variable set at originate time,
// so no phone-based lookup is needed.
async function markCallResult(orgId, campaignLeadId, transcript = '', campaignId) {
  const log = createLogger({ service: 'campaignReplyHandler', orgId, campaignLeadId });

  const lead = await CampaignLead.findOne({
    where: { id: campaignLeadId, org_id: orgId },
  });
  if (!lead) {
    log.info('call result: lead not found', { campaignLeadId });
    return { halted: 0, classified: null };
  }

  // Also catch recently-completed runs: advance() can complete the run (last action
  // of last day) before the pipecat webhook arrives. In that case we still want to
  // classify and update the lead status — just don't try to halt an already-done run.
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const activeRun = await CampaignLeadRun.findOne({
    where: {
      campaign_lead_id: campaignLeadId,
      org_id: orgId,
      [Op.or]: [
        { status: { [Op.in]: ['pending', 'waiting', 'queued'] } },
        { status: 'completed', updated_at: { [Op.gte]: fiveMinAgo } },
      ],
    },
    order: [['updated_at', 'DESC']],
  });

  if (!activeRun) {
    log.info('call result: no active run found', { campaignLeadId });
    return { halted: 0, classified: null };
  }

  const isAlreadyCompleted = activeRun.status === 'completed';

  const campaign = await Campaign.findByPk(campaignId || lead.campaign_id, {
    attributes: ['id', 'template_snapshot'],
    raw: true,
  });

  const snapshot = campaign && campaign.template_snapshot;
  const keywords = extractKeywords(snapshot, 'call');
  const hasKeywords = keywords.length > 0;

  const isInterested = !hasKeywords || matchesKeywords(transcript, keywords);

  if (isInterested) {
    const tx = await sequelize.transaction();
    try {
      await lead.update({ status: 'interested' }, { transaction: tx });
      // Don't flip a run that advance() already marked completed — it finished cleanly.
      if (!isAlreadyCompleted) {
        await activeRun.update(
          { status: 'halted', halted_at: new Date(), asterisk_channel_id: null },
          { transaction: tx }
        );
      }
      await CampaignEvent.create({
        org_id: orgId,
        campaign_id: lead.campaign_id,
        campaign_lead_id: lead.id,
        kind: 'call_interested',
        idempotency_key: `call-interested-${activeRun.id}`,
        payload: {
          reason: 'call_keyword_match',
          ...(isAlreadyCompleted && { note: 'classified_after_run_completed' }),
          ...(transcript && { transcript: transcript.slice(0, 500) }),
        },
      }, { transaction: tx });
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
      log.error('failed to halt interested lead (call)', { leadId: lead.id, error: e.message });
      return { halted: 0, classified: null };
    }

    log.info('call: lead marked interested, run halted', { leadId: lead.id, isAlreadyCompleted });
    return { halted: isAlreadyCompleted ? 0 : 1, classified: 'interested' };
  }

  // No keyword match → engaged: record event, bump status if early-stage.
  const tx = await sequelize.transaction();
  try {
    const EARLY_STATUSES = new Set(['raw', 'contacted']);
    if (EARLY_STATUSES.has(lead.status)) {
      await lead.update({ status: 'engaged' }, { transaction: tx });
    }
    await CampaignEvent.create({
      org_id: orgId,
      campaign_id: lead.campaign_id,
      campaign_lead_id: lead.id,
      kind: 'call_engaged',
      idempotency_key: `call-engaged-${activeRun.id}-${Date.now()}`,
      payload: { ...(transcript && { transcript: transcript.slice(0, 500) }) },
    }, { transaction: tx });
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* ignore */ }
    log.error('failed to record engaged call', { leadId: lead.id, error: e.message });
    return { halted: 0, classified: null };
  }

  log.info('call: lead marked engaged (no keyword match)', { leadId: lead.id });
  return { halted: 0, classified: 'engaged' };
}

module.exports = {
  markInterestedAndHalt,
  markCallResult,
};
