'use strict';

const { CampaignLead, CampaignLeadRun, CampaignEvent, sequelize } = require('../models');
const { Op } = require('sequelize');
const { createLogger } = require('./campaign-logger');

const logger = createLogger({ service: 'campaignReplyHandler' });

// Called when a MSG91 inbound webhook fires for a lead's phone.
// Marks lead.status='interested', halts the active lead run.
// All writes are inside a single transaction per lead so a crash between
// the two writes does not leave one updated and the other stale.
async function markInterestedAndHalt(orgId, phone) {
  const log = createLogger({ service: 'campaignReplyHandler', orgId, phone });
  const leads = await CampaignLead.findAll({
    where: { org_id: orgId, phone },
  });

  let halted = 0;

  for (const lead of leads) {
    const tx = await sequelize.transaction();
    try {
      await lead.update({ status: 'interested' }, { transaction: tx });

      const run = await CampaignLeadRun.findOne({
        where: {
          org_id: orgId,
          campaign_lead_id: lead.id,
          status: { [Op.in]: ['pending', 'waiting'] },
        },
        transaction: tx,
      });

      if (run) {
        await run.update(
          { status: 'halted', halted_at: new Date() },
          { transaction: tx }
        );
      }

      await CampaignEvent.create({
        org_id: orgId,
        campaign_id: lead.campaign_id,
        campaign_lead_id: lead.id,
        kind: 'halted',
        payload: { reason: 'inbound_reply' },
      }, { transaction: tx });

      await tx.commit();
      halted += 1;
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
      log.error('failed to halt lead', { leadId: lead.id, error: e.message });
    }
  }

  log.info('halted leads', { count: halted });

  return { halted };
}

module.exports = {
  markInterestedAndHalt,
};
