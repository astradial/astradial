'use strict';

const express = require('express');
const router = express.Router();
const { makeHmacVerify } = require('../middleware/hmac-verify');
const { Campaign, CampaignLead, CampaignLeadRun, CampaignEvent } = require('../models');

// POST /webhooks/msg91-inbound
// Payload from MSG91: { from: '919812345678', message: '...', ... }
router.post('/msg91-inbound',
  makeHmacVerify('MSG91_WEBHOOK_SECRET'),
  async (req, res) => {
    // Respond immediately — MSG91 retries on non-2xx.
    res.json({ received: true });

    try {
      // Match normPhone() in campaign-csv-importer: keep digits and leading '+'.
      const raw = String(req.body.from || '');
      const phone = raw.replace(/[^\d+]/g, '');
      if (!phone) return;

      const message = String(req.body.message || req.body.text || '');

      const leads = await CampaignLead.findAll({
        where: { phone },
        attributes: ['org_id'],
        group: ['org_id'],
        raw: true,
      });

      if (!leads.length) return;

      const { markInterestedAndHalt } = require('../services/campaign-reply-handler');

      for (const { org_id } of leads) {
        try {
          await markInterestedAndHalt(org_id, phone, message);
        } catch (err) {
          console.error(`[msg91-inbound] markInterestedAndHalt failed org=${org_id} phone=${phone}:`, err.message);
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
      await advance(run, campaign);
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
