'use strict';

/**
 * Seeds ONE WhatsApp-only campaign for manual launch testing:
 *   • 1 published CampaignTemplate — single day, single WhatsApp action using
 *     the real APPROVED, no-variable hotel template `grand_estancia_uti`
 *     (no variables = no risk of a variable-mismatch send error).
 *   • 1 Campaign (DRAFT) — pinned to integrated number 15558897024.
 *   • 20 CampaignLeads, ALL with the same number 919944421125 (digits only,
 *     the format MSG91 expects), each with a CampaignLeadRun (pending).
 *
 * No call actions. Left as DRAFT — the operator launches it manually, which
 * fires 20 WhatsApp sends to that number (org WA rate limit default 60/min).
 *
 * Usage (inside the api container):  node scripts/seed-whatsapp-blast.js
 */

const {
  sequelize,
  Organization,
  CampaignTemplate,
  Campaign,
  CampaignLead,
  CampaignLeadRun,
} = require('../src/models');

const TEMPLATE_NAME = 'WhatsApp Test – Grand Estancia (no-var)';
const CAMPAIGN_NAME = 'WhatsApp Blast Test – 20 leads (Jun 2026)';
const LEAD_PHONE = '919944421125'; // digits only — MSG91 `to` format
const LEAD_COUNT = 20;
const INTEGRATED_NUMBER = '15558897024';

const WA_TEMPLATE = 'grand_estancia_uti';
const WA_NAMESPACE = 'ab7728b6_9e3c_4160_b51e_958e57f151e0';

const WORKFLOW = {
  meta: { vertical: 'hospitality', goal: 'whatsapp_test', name: TEMPLATE_NAME },
  days: [
    {
      id: 'day-1',
      gap: 0,
      actions: [
        {
          id: 'd1-wa',
          type: 'whatsapp',
          template: WA_TEMPLATE,
          namespace: WA_NAMESPACE,
          language: 'en',
          interest_keywords: ['yes', 'interested', 'book', 'confirm'],
          options: {},
        },
      ],
    },
  ],
};

async function main() {
  await sequelize.authenticate();
  console.log('[wa-seed] DB connection OK');

  const org = await Organization.findOne({ order: [['created_at', 'ASC']] });
  if (!org) { console.error('[wa-seed] No organization found.'); process.exit(1); }
  console.log(`[wa-seed] org "${org.name}" (${org.id})`);

  // 1) Published template (whatsapp-only)
  let template = await CampaignTemplate.findOne({ where: { org_id: org.id, name: TEMPLATE_NAME } });
  if (!template) {
    template = await CampaignTemplate.create({
      org_id: org.id, name: TEMPLATE_NAME,
      description: 'WhatsApp-only test flow: single send of grand_estancia_uti (no variables).',
      status: 'published', version: 1, workflow: WORKFLOW,
    });
    console.log(`[wa-seed] + template ${template.name} (${template.id}) [published]`);
  } else {
    await template.update({ workflow: WORKFLOW, status: 'published' });
    console.log(`[wa-seed] = template refreshed (${template.id})`);
  }

  // 2) Campaign (DRAFT) — operator launches manually
  const startAt = new Date();
  let campaign = await Campaign.findOne({ where: { org_id: org.id, name: CAMPAIGN_NAME } });
  if (!campaign) {
    campaign = await Campaign.create({
      org_id: org.id, name: CAMPAIGN_NAME,
      description: 'WhatsApp-only blast test: 20 leads, same number. Launch manually.',
      template_id: template.id, template_snapshot: WORKFLOW,
      status: 'draft', start_at: startAt,
      options: { msg91_integrated_number: INTEGRATED_NUMBER },
      stats: { total: 0, contacted: 0, engaged: 0, interested: 0, qualified: 0 },
    });
    console.log(`[wa-seed] + campaign ${campaign.name} (${campaign.id}) [draft]`);
  } else {
    await campaign.update({
      template_id: template.id, template_snapshot: WORKFLOW, start_at: startAt,
      options: { msg91_integrated_number: INTEGRATED_NUMBER },
    });
    console.log(`[wa-seed] = campaign refreshed (${campaign.id})`);
  }

  // 3) 20 leads (same number) — idempotent: top up to LEAD_COUNT
  const existing = await CampaignLead.count({ where: { campaign_id: campaign.id } });
  const toCreate = Math.max(0, LEAD_COUNT - existing);
  const leadRows = [];
  for (let i = existing; i < existing + toCreate; i++) {
    leadRows.push({
      org_id: org.id, campaign_id: campaign.id,
      name: `Test Lead ${i + 1}`, phone: LEAD_PHONE, country: 'IN',
      business: 'Grand Estancia', source: 'manual', status: 'raw',
      custom_fields: { batch: 'wa-blast', idx: i + 1 }, enrolled_at: new Date(),
    });
  }
  const createdLeads = leadRows.length ? await CampaignLead.bulkCreate(leadRows, { returning: true }) : [];
  console.log(`[wa-seed] leads: ${existing} existing + ${createdLeads.length} created`);

  // 4) One pending run per new lead
  const runRows = createdLeads.map((l) => ({
    org_id: org.id, campaign_id: campaign.id, campaign_lead_id: l.id,
    current_day_index: 0, current_action_index: 0,
    next_run_at: startAt, status: 'pending',
  }));
  if (runRows.length) await CampaignLeadRun.bulkCreate(runRows);
  console.log(`[wa-seed] + ${runRows.length} runs (pending)`);

  // 5) stats.total
  const total = await CampaignLead.count({ where: { campaign_id: campaign.id } });
  await campaign.update({ stats: { ...campaign.stats, total } });

  console.log(`\n[wa-seed] DONE.`);
  console.log(`  campaign_id = ${campaign.id}  status=draft  leads=${total}`);
  console.log(`  template    = ${WA_TEMPLATE} (no variables)  sender=${INTEGRATED_NUMBER}`);
  console.log(`  → Launch manually in the UI; ${total} WhatsApp sends will fire to ${LEAD_PHONE}.`);
  await sequelize.close();
}

main().catch((err) => { console.error('[wa-seed] FAILED:', err); process.exit(1); });
