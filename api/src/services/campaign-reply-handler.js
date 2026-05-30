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

// Returns true if any keyword matches exactly (case-insensitive, trimmed) as a whole word/phrase in the message.
function matchesKeywordsExact(message, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  const cleanMsg = (message || '').trim().toLowerCase();
  if (!cleanMsg) return false;

  // Split cleanMsg by whitespace to check for exact word matching.
  // Strip leading and trailing punctuation from words to handle standard punctuation (e.g. "yes!" -> "yes").
  // We preserve Tamil or other non-ASCII characters by stripping punctuation specifically instead of using \w.
  const messageWords = cleanMsg
    .split(/\s+/)
    .map(w => w.replace(/^[.,!?;:"'-]+|[.,!?;:"'-]+$/g, ''))
    .filter(Boolean);

  return keywords.some(kw => {
    const cleanKw = (kw || '').trim().toLowerCase();
    if (!cleanKw) return false;

    if (cleanKw.includes(' ')) {
      // Multi-word phrase keyword.
      // Check if it appears as a full phrase in the message.
      // A full phrase means it is preceded and followed by either whitespace, punctuation, or start/end of string.
      const index = cleanMsg.indexOf(cleanKw);
      if (index !== -1) {
        const beforeChar = index > 0 ? cleanMsg[index - 1] : ' ';
        const afterChar = index + cleanKw.length < cleanMsg.length ? cleanMsg[index + cleanKw.length] : ' ';
        const isBeforeWordBoundary = /\s|[.,!?;:"'-]/.test(beforeChar);
        const isAfterWordBoundary = /\s|[.,!?;:"'-]/.test(afterChar);
        return isBeforeWordBoundary && isAfterWordBoundary;
      }
      return false;
    } else {
      // Single word keyword. Must match one of the message words exactly.
      return messageWords.includes(cleanKw);
    }
  });
}

// Called when a MSG91 inbound webhook fires for a lead's phone.
//
// Classification logic:
//   • If the reply matches an interested keyword -> move lead to interested.
//   • If the reply does not match a keyword -> move lead to engaged.
//   • Halt future outreach only when the lead becomes interested.
//   • Do not halt future outreach for a normal non-keyword engaged reply.
//   • Do not downgrade lead status.
//
// Only the ONE most-recently-touched run for this phone is affected.
async function handleWhatsAppInboundReply(orgId, phone, message = '', messageId = null) {
  const log = createLogger({ service: 'campaignReplyHandler', orgId, phone });

  const activeRun = await CampaignLeadRun.findOne({
    where: {
      org_id: orgId,
      status: { [Op.in]: ['pending', 'waiting', 'queued', 'completed', 'halted'] },
    },
    include: [
      {
        model: CampaignLead,
        as: 'lead',
        where: { org_id: orgId, phone },
        required: true,
      },
    ],
    order: [['updated_at', 'DESC']],
  });

  if (!activeRun) {
    log.info('inbound reply: no run found for phone', { phone });
    return { halted: 0, classified: null };
  }

  const lead = activeRun.lead;
  const currentStatus = lead.status;

  // Load the campaign snapshot for keyword matching.
  const campaign = await Campaign.findByPk(lead.campaign_id, {
    attributes: ['template_snapshot'],
    raw: true,
  });

  const snapshot = campaign && campaign.template_snapshot;
  const keywords = extractKeywords(snapshot, 'whatsapp');
  const hasKeywords = keywords.length > 0;

  // Exact keyword matching logic
  const isMatched = hasKeywords && matchesKeywordsExact(message, keywords);

  // Target status determination:
  // If no keywords are configured, treat any reply as "interested" (backwards-compatible default)
  const isInterested = !hasKeywords || isMatched;
  const targetStatus = isInterested ? 'interested' : 'engaged';

  // Precedence check to avoid downgrading
  const STATUS_PRECEDENCE = {
    raw: 0,
    contacted: 1,
    engaged: 2,
    interested: 3,
    qualified: 4,
    disqualified: 5,
    dnc: 5
  };
  const currentPrec = STATUS_PRECEDENCE[currentStatus] !== undefined ? STATUS_PRECEDENCE[currentStatus] : 0;
  const targetPrec = STATUS_PRECEDENCE[targetStatus] !== undefined ? STATUS_PRECEDENCE[targetStatus] : 0;
  const shouldUpdateStatus = targetPrec > currentPrec;

  // Find exact matched keyword if matched
  let matchedKeyword = null;
  if (isMatched) {
    matchedKeyword = keywords.find(kw => matchesKeywordsExact(message, [kw])) || null;
  }

  // Idempotency key construction
  let idempotencyKey;
  if (messageId) {
    idempotencyKey = `whatsapp-reply-${messageId}`;
  } else {
    const roundedTime = Math.floor(Date.now() / (5 * 60 * 1000)); // 5-minute bucket
    const cleanText = (message || '').trim().toLowerCase().slice(0, 100);
    idempotencyKey = `whatsapp-reply-${phone}-${cleanText}-${roundedTime}`;
  }

  const tx = await sequelize.transaction();
  try {
    // 1. Create CampaignEvent activity log (kind: whatsapp_replied)
    await CampaignEvent.create({
      org_id: orgId,
      campaign_id: lead.campaign_id,
      campaign_lead_id: lead.id,
      kind: 'whatsapp_replied',
      idempotency_key: idempotencyKey,
      payload: {
        direction: 'inbound',
        channel: 'whatsapp',
        text: message,
        matched_keyword: matchedKeyword,
        status_result: shouldUpdateStatus ? targetStatus : currentStatus,
        detail: matchedKeyword
          ? `Customer replied with interested keyword: ${matchedKeyword}`
          : 'Customer replied on WhatsApp',
      },
    }, { transaction: tx });

    // 2. Update lead status if it is an upgrade
    if (shouldUpdateStatus) {
      await lead.update({ status: targetStatus }, { transaction: tx });
    }

    // 3. Halt run if final status is 'interested' and lead becomes interested
    let halted = 0;
    const finalStatus = shouldUpdateStatus ? targetStatus : currentStatus;
    if (finalStatus === 'interested' && currentStatus !== 'interested' && activeRun.status !== 'halted' && activeRun.status !== 'completed') {
      await activeRun.update({
        status: 'halted',
        halted_at: new Date()
      }, { transaction: tx });
      halted = 1;
    }

    await tx.commit();
    log.info('inbound reply processed successfully', { leadId: lead.id, finalStatus, halted });
    return { halted, classified: finalStatus };
  } catch (err) {
    await tx.rollback();
    if (err.name === 'SequelizeUniqueConstraintError') {
      log.info('inbound reply: duplicate event (idempotency key matched), skipping update');
      return { halted: 0, classified: currentStatus };
    }
    log.error('failed to process inbound reply', { leadId: lead.id, error: err.message });
    throw err;
  }
}

// Wrapper for backwards compatibility
async function markInterestedAndHalt(orgId, phone, message = '') {
  return handleWhatsAppInboundReply(orgId, phone, message);
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
  handleWhatsAppInboundReply,
  markInterestedAndHalt,
  markCallResult,
};
