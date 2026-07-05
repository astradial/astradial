'use strict';

/**
 * Seeds ONE "Hotel Calls" campaign management demo for the first org:
 *   • 1 CampaignBot   — "Hotel Booking Voice Bot" (resolves the call `script`)
 *   • 1 CampaignTemplate (published) — 3 days, each day = [outbound call, WhatsApp]
 *   • 1 Campaign (DRAFT)            — snapshot of the template
 *   • 1 CampaignLead               — Hotel Guest, +91 99444 21125
 *   • 1 CampaignLeadRun            — scheduler entry (day 0 / action 0, pending)
 *
 * WhatsApp template is a PLACEHOLDER (hotel_booking_confirmation /
 * hotel_confirmations_v1) — the live MSG91 authkey is IP-restricted, so swap in
 * the real approved template + namespace once this server's IP is whitelisted.
 *
 * Idempotent by name/phone — safe to re-run.
 *
 * Usage (inside the api container):  node scripts/seed-hotel-campaign.js
 */

const {
  sequelize,
  Organization,
  CampaignBot,
  CampaignTemplate,
  Campaign,
  CampaignLead,
  CampaignLeadRun,
} = require('../src/models');

const BOT_NAME = 'Hotel Booking Voice Bot';
const TEMPLATE_NAME = 'Hotel Calls — 3-Day Booking Confirmation';
const CAMPAIGN_NAME = 'Hotel Calls – Booking Confirmation (Jun 2026)';
const LEAD_PHONE = '+919944421125';

// Real APPROVED MSG91 templates on integrated number 15558897024 (Grand Estancia
// hotel brand). Namespace is shared across this account's templates.
const WA_NAMESPACE = 'ab7728b6_9e3c_4160_b51e_958e57f151e0';
const WA_LANG = 'en';

function waAction(id, template) {
  return {
    id,
    type: 'whatsapp',
    template,
    namespace: WA_NAMESPACE,
    language: WA_LANG,
    interest_keywords: ['confirm', 'yes', 'booking', 'thanks', 'check-in'],
    options: {},
  };
}

function callAction(id, intent) {
  return {
    id,
    type: 'call',
    script: BOT_NAME, // resolved to the CampaignBot by name
    callerId: 'hotel-desk',
    interest_keywords: ['confirm', 'book', 'yes', 'reschedule', 'cancel'],
    options: { intent },
  };
}

// 3 days, each day fires an outbound CALL then a WhatsApp. gap = days to wait.
const WORKFLOW = {
  meta: { vertical: 'hospitality', goal: 'booking_confirmation', name: TEMPLATE_NAME },
  days: [
    {
      id: 'day-1',
      gap: 0,
      actions: [
        callAction('d1-call', 'welcome_confirm_booking'),
        waAction('d1-wa', 'ge_welcome'),
      ],
    },
    {
      id: 'day-2',
      gap: 1,
      actions: [
        callAction('d2-call', 'reminder_pre_arrival'),
        waAction('d2-wa', 'grand_estancia_uti'),
      ],
    },
    {
      id: 'day-3',
      gap: 1,
      actions: [
        callAction('d3-call', 'final_confirmation'),
        waAction('d3-wa', 'grand_estancia'),
      ],
    },
  ],
};

async function main() {
  await sequelize.authenticate();
  console.log('[hotel-seed] DB connection OK');

  const org = await Organization.findOne({ order: [['created_at', 'ASC']] });
  if (!org) {
    console.error('[hotel-seed] No organization found — create one first.');
    process.exit(1);
  }
  console.log(`[hotel-seed] org "${org.name}" (${org.id})`);

  // 1) Voice bot (referenced by call actions' `script`)
  let [bot] = await CampaignBot.findOrCreate({
    where: { org_id: org.id, name: BOT_NAME },
    defaults: {
      org_id: org.id,
      name: BOT_NAME,
      language: 'en',
      keywords: ['confirm', 'book', 'reschedule', 'cancel', 'check-in'],
      max_words: 3,
      call_timeout: 8,
    },
  });
  console.log(`[hotel-seed] bot ${bot.name} (${bot.id})`);

  // 2) Published template
  let template = await CampaignTemplate.findOne({ where: { org_id: org.id, name: TEMPLATE_NAME } });
  if (!template) {
    template = await CampaignTemplate.create({
      org_id: org.id,
      name: TEMPLATE_NAME,
      description: '3-day hotel booking-confirmation cadence: an outbound AI call + a WhatsApp every day.',
      status: 'published',
      version: 1,
      workflow: WORKFLOW,
    });
    console.log(`[hotel-seed] + template ${template.name} (${template.id})`);
  } else {
    await template.update({ workflow: WORKFLOW, status: 'published' });
    console.log(`[hotel-seed] = template exists, refreshed workflow (${template.id})`);
  }

  // 3) Campaign (DRAFT) with frozen snapshot
  const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  let campaign = await Campaign.findOne({ where: { org_id: org.id, name: CAMPAIGN_NAME } });
  if (!campaign) {
    campaign = await Campaign.create({
      org_id: org.id,
      name: CAMPAIGN_NAME,
      description: 'Demo: 3-day hotel calls + WhatsApp flow for a single lead.',
      template_id: template.id,
      template_snapshot: WORKFLOW,
      status: 'draft',
      start_at: startAt,
      stats: { total: 0, contacted: 0, engaged: 0, interested: 0, qualified: 0 },
    });
    console.log(`[hotel-seed] + campaign ${campaign.name} (${campaign.id}) [draft]`);
  } else {
    await campaign.update({ template_id: template.id, template_snapshot: WORKFLOW, start_at: startAt });
    console.log(`[hotel-seed] = campaign exists, refreshed snapshot (${campaign.id})`);
  }

  // 4) Lead
  let [lead] = await CampaignLead.findOrCreate({
    where: { org_id: org.id, campaign_id: campaign.id, phone: LEAD_PHONE },
    defaults: {
      org_id: org.id,
      campaign_id: campaign.id,
      name: 'Hotel Guest',
      phone: LEAD_PHONE,
      country: 'IN',
      business: 'Grand Hotel',
      source: 'manual',
      status: 'raw',
      custom_fields: { room_type: 'Deluxe', check_in: '2026-07-01', notes: 'Seed lead for Hotel Calls demo' },
      enrolled_at: new Date(),
    },
  });
  console.log(`[hotel-seed] lead ${lead.name} ${lead.phone} (${lead.id})`);

  // 5) Scheduler run (day 0 / action 0, pending) — campaign is draft so it won't fire until launch
  let [run] = await CampaignLeadRun.findOrCreate({
    where: { org_id: org.id, campaign_id: campaign.id, campaign_lead_id: lead.id },
    defaults: {
      org_id: org.id,
      campaign_id: campaign.id,
      campaign_lead_id: lead.id,
      current_day_index: 0,
      current_action_index: 0,
      next_run_at: startAt,
      status: 'pending',
    },
  });
  console.log(`[hotel-seed] run ${run.id} (status=${run.status})`);

  // 6) Refresh stats.total
  const total = await CampaignLead.count({ where: { campaign_id: campaign.id } });
  await campaign.update({ stats: { ...campaign.stats, total } });

  console.log(`\n[hotel-seed] DONE.`);
  console.log(`  campaign_id = ${campaign.id}`);
  console.log(`  org_id      = ${org.id}`);
  console.log(`  status      = draft  (leads=${total})  days=${WORKFLOW.days.length} (call+whatsapp each)`);
  await sequelize.close();
}

main().catch((err) => {
  console.error('[hotel-seed] FAILED:', err);
  process.exit(1);
});
