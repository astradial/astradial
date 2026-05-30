'use strict';

const express = require('express');
const router = express.Router();
const { makeHmacVerify } = require('../middleware/hmac-verify');
const { Campaign, CampaignLead, CampaignLeadRun, CampaignEvent } = require('../models');

// Helper to mask phone numbers for safe logging
function maskPhone(p) {
  if (!p) return '';
  const clean = String(p).replace(/[^\d+]/g, '');
  if (clean.length <= 4) return clean;
  return '*'.repeat(clean.length - 4) + clean.slice(-4);
}

// POST /webhooks/msg91-inbound
// Payload from MSG91: support from, sender, customerNumber, mobile, etc.
router.post('/msg91-inbound',
  makeHmacVerify('MSG91_WEBHOOK_SECRET'),
  async (req, res) => {
    // Respond immediately — MSG91 retries on non-2xx.
    res.json({ received: true });

    try {
      // 1. Parse Phone Number
      const rawFrom = req.body.from || req.body.sender || req.body.customerNumber || req.body.mobile || '';
      const phone = String(rawFrom).replace(/[^\d+]/g, '');
      if (!phone) {
        console.log('[msg91-inbound] Received webhook with no valid phone number. Keys:', Object.keys(req.body || {}));
        return;
      }

      // 2. Parse Message Text (including nested message body/text)
      let message = req.body.message || req.body.text || '';
      if (typeof message === 'object' && message !== null) {
        message = message.text || message.body || '';
      }
      message = String(message);

      // 3. Parse Message/Event ID
      let messageId = req.body.messageId || req.body.msgId || req.body.id || req.body.eventId || null;
      if (typeof req.body.message === 'object' && req.body.message !== null) {
        messageId = messageId || req.body.message.id || req.body.message.messageId || null;
      }
      if (messageId) messageId = String(messageId);

      // Safe logging of keys and masked phone
      console.log(`[msg91-inbound] Webhook payload keys: ${JSON.stringify(Object.keys(req.body || {}))} | Phone: ${maskPhone(phone)} | MessageId: ${messageId || 'none'}`);

      const leads = await CampaignLead.findAll({
        where: { phone },
        attributes: ['org_id'],
        group: ['org_id'],
        raw: true,
      });

      if (!leads.length) {
        console.log(`[msg91-inbound] No campaign lead found for phone ${maskPhone(phone)}`);
        return;
      }

      const { handleWhatsAppInboundReply } = require('../services/campaign-reply-handler');

      for (const { org_id } of leads) {
        try {
          await handleWhatsAppInboundReply(org_id, phone, message, messageId);
        } catch (err) {
          console.error(`[msg91-inbound] handleWhatsAppInboundReply failed org=${org_id} phone=${maskPhone(phone)}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[msg91-inbound] error:', err.message);
    }
  }
);

// POST /webhooks/call-completed
// Crash-recovery fallback only — the primary run-advancement path is the
// 5-second Asterisk poll in campaignCallWorker.js.  This webhook fires when
// the AI call platform signals completion; if the call worker already advanced
// the run, advance() is a no-op (idempotency guard on run.status).
//
// Payload: { org_id, campaign_id, campaign_lead_id, call_id, duration_seconds, status }
router.post('/call-completed',
  makeHmacVerify('CAMPAIGN_WEBHOOK_SECRET'),
  async (req, res) => {
    res.json({ received: true });

    const { org_id, campaign_id, campaign_lead_id, call_id, duration_seconds, status } = req.body;

    try {
      const campaign = await Campaign.findOne({ where: { id: campaign_id, org_id } });
      if (!campaign) {
        console.error(`[call-completed] campaign not found: ${campaign_id}`);
        return;
      }

      // Rolling 10-sample average of call duration — used for ETA estimates.
      if (status === 'completed' && duration_seconds > 0) {
        const oldAvg = campaign.avg_call_seconds || 180;
        const newAvg = Math.round((oldAvg * 9 + duration_seconds) / 10);
        await campaign.update({ avg_call_seconds: newAvg });
      }

      // Record the event for the audit log.
      const eventKind = status === 'completed' ? 'call_completed' : 'call_failed';
      try {
        await CampaignEvent.create({
          org_id,
          campaign_id,
          campaign_lead_id,
          kind: eventKind,
          idempotency_key: `call-completed-${call_id}`,
          payload: { call_id, duration_seconds, status },
        });
      } catch (err) {
        if (err.name !== 'SequelizeUniqueConstraintError') {
          console.error('[call-completed] CampaignEvent.create failed:', err.message);
        }
      }

      // Advance the run via the shared service.  If the 5-s poll already
      // advanced it, advance() detects the non-waiting status and returns
      // without doing anything (idempotent).
      const run = await CampaignLeadRun.findOne({
        where: { campaign_lead_id, status: 'waiting' },
      });
      if (!run) return;

      const { advance } = require('../services/campaign-advance');
      await advance(run, campaign, status === 'completed');
    } catch (err) {
      console.error('[call-completed] error:', err.message, err.stack);
    }
  }
);

// POST /webhooks/call-result
// Sent by the pipecat AI bot at the end of every campaign call.
// Payload: { org_id, campaign_id, campaign_lead_id, call_id, transcript, duration_seconds, status }
//
// Classification mirrors the MSG91 inbound-reply handler:
//   • Call actions have interest_keywords → transcript match → interested + halt
//   • Keywords configured, no match → engaged + continues
//   • No keywords configured → interested + halt (default)
router.post('/call-result',
  makeHmacVerify('CAMPAIGN_WEBHOOK_SECRET'),
  async (req, res) => {
    res.json({ received: true });

    const { org_id, campaign_id, campaign_lead_id, call_id, transcript, duration_seconds, status } = req.body;

    if (!org_id || !campaign_lead_id) {
      console.error('[call-result] missing org_id or campaign_lead_id');
      return;
    }

    try {
      // Update rolling average call duration on the campaign row.
      if (status === 'completed' && duration_seconds > 0) {
        const campaign = await Campaign.findOne({ where: { id: campaign_id, org_id } });
        if (campaign) {
          const oldAvg = campaign.avg_call_seconds || 180;
          const newAvg = Math.round((oldAvg * 9 + duration_seconds) / 10);
          await campaign.update({ avg_call_seconds: newAvg });
        }
      }

      const { markCallResult } = require('../services/campaign-reply-handler');
      await markCallResult(org_id, campaign_lead_id, transcript || '', campaign_id);
    } catch (err) {
      console.error('[call-result] error:', err.message, err.stack);
    }
  }
);

module.exports = router;
