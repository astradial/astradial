'use strict';

const express = require('express');
const router = express.Router();
const { makeHmacVerify } = require('../middleware/hmac-verify');
const { Campaign, CampaignLead, CampaignLeadRun, CampaignEvent, sequelize } = require('../models');

// POST /webhooks/msg91-inbound
// Payload from MSG91: { from: '919812345678', message: '...', ... }
router.post('/msg91-inbound',
  makeHmacVerify('MSG91_WEBHOOK_SECRET'),
  async (req, res) => {
    // Respond immediately — MSG91 retries on non-2xx.
    res.json({ received: true });

    try {
      const raw = String(req.body.from || '');
      const phone = raw.replace(/^\+/, '').replace(/\D/g, '');
      if (!phone) return;

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
          await markInterestedAndHalt(org_id, phone);
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
// Payload: { org_id, campaign_id, campaign_lead_id, call_id, duration_seconds, status }
router.post('/call-completed',
  makeHmacVerify('CAMPAIGN_WEBHOOK_SECRET'),
  async (req, res) => {
    // Respond immediately — caller retries on non-2xx.
    res.json({ received: true });

    const { org_id, campaign_id, campaign_lead_id, call_id, duration_seconds, status } = req.body;

    try {
      const { releaseCallSlot } = require('../services/campaign-concurrency');
      try {
        await releaseCallSlot(org_id, campaign_id);
      } catch (err) {
        // Non-fatal: Redis may be unavailable.
        console.warn('[call-completed] releaseCallSlot failed:', err.message);
      }

      const campaign = await Campaign.findOne({ where: { id: campaign_id, org_id } });
      if (!campaign) {
        console.error(`[call-completed] campaign not found: ${campaign_id}`);
        return;
      }

      if (status === 'completed' && duration_seconds > 0) {
        const oldAvg = campaign.avg_call_seconds || 180;
        const newAvg = Math.round((oldAvg * 9 + duration_seconds) / 10);
        await campaign.update({ avg_call_seconds: newAvg });
      }

      const eventKind = status === 'completed' ? 'call_completed' : 'call_failed';
      const idempotencyKey = `call-completed-${call_id}`;

      try {
        await CampaignEvent.create({
          org_id,
          campaign_id,
          campaign_lead_id,
          kind: eventKind,
          idempotency_key: idempotencyKey,
          payload: { call_id, duration_seconds, status },
        });
      } catch (err) {
        // Unique constraint means this event was already recorded — idempotent, skip.
        if (err.name !== 'SequelizeUniqueConstraintError') {
          console.error('[call-completed] CampaignEvent.create failed:', err.message);
        }
      }

      const run = await CampaignLeadRun.findOne({
        where: { campaign_lead_id, status: 'waiting' },
      });

      if (!run) return;

      const snapshot = campaign.template_snapshot;
      const days = snapshot && Array.isArray(snapshot.days) ? snapshot.days : [];

      const dayIndex = run.current_day_index;
      const actionIndex = run.current_action_index;
      const currentDay = days[dayIndex];

      if (!currentDay) {
        await run.update({ status: 'completed' });
      } else {
        const actions = Array.isArray(currentDay.actions) ? currentDay.actions : [];
        const isLastAction = actionIndex >= actions.length - 1;
        const isLastDay = dayIndex >= days.length - 1;

        if (!isLastAction) {
          await run.update({
            current_action_index: actionIndex + 1,
            status: 'pending',
            next_run_at: new Date(),
          });
        } else if (!isLastDay) {
          const nextDay = days[dayIndex + 1];
          const gapMs = ((nextDay && nextDay.gap) || 0) * 86400000;
          await run.update({
            current_day_index: dayIndex + 1,
            current_action_index: 0,
            status: 'pending',
            next_run_at: new Date(Date.now() + gapMs),
          });
        } else {
          await run.update({ status: 'completed' });
        }
      }

      // Mark lead as contacted once all runs are finished.
      const pendingRuns = await CampaignLeadRun.count({
        where: {
          campaign_lead_id,
          status: ['pending', 'waiting'],
        },
      });

      if (pendingRuns === 0) {
        await CampaignLead.update(
          { status: 'contacted' },
          { where: { id: campaign_lead_id, status: 'raw' } }
        );
      }
    } catch (err) {
      console.error('[call-completed] error:', err.message, err.stack);
    }
  }
);

module.exports = router;
