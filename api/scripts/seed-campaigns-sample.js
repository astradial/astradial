'use strict';

/**
 * Seeds 5 campaign templates, 5 campaigns, and 50 leads per campaign
 * for the first organization in the database.
 *
 * Idempotent-ish: skips templates/campaigns whose `name` already exists
 * for the org. Lead phones include a random suffix so reruns just add
 * more leads if the campaign already exists.
 *
 * Usage (inside the api container):
 *   node scripts/seed-campaigns-sample.js
 */

const {
  sequelize,
  Organization,
  CampaignTemplate,
  Campaign,
  CampaignLead,
} = require('../src/models');

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function indianPhone() {
  // E.164-ish: +91 followed by 10 digits starting with 6-9
  const first = pick(['6', '7', '8', '9']);
  let rest = '';
  for (let i = 0; i < 9; i++) rest += Math.floor(Math.random() * 10);
  return `+91${first}${rest}`;
}

// --- Five distinct template workflows -----------------------------------

const TEMPLATES = [
  {
    name: 'Real Estate – Site Visit Booking',
    description:
      '3-day cadence pushing prospects toward a weekend site visit. WhatsApp → call → final WhatsApp nudge.',
    workflow: {
      meta: { vertical: 'real_estate', goal: 'site_visit' },
      days: [
        {
          id: 'day-1',
          gap: 0,
          actions: [
            {
              id: 'wa-1',
              type: 'whatsapp',
              template: 'realestate_intro_v2',
              interest_keywords: ['interested', 'yes', 'visit', 'schedule', 'price'],
              options: { greeting: 'Hi {{name}}, exclusive 3BHK launch this weekend.' },
            },
          ],
        },
        {
          id: 'day-2',
          gap: 1,
          actions: [
            {
              id: 'call-1',
              type: 'call',
              script: 'realestate_qualifier_v1',
              callerId: 'sales-mumbai',
              interest_keywords: ['schedule', 'book', 'visit', 'interested', 'tomorrow'],
              options: { tone: 'consultative' },
            },
          ],
        },
        {
          id: 'day-3',
          gap: 2,
          actions: [
            {
              id: 'wa-2',
              type: 'whatsapp',
              template: 'realestate_lastnudge_v1',
              interest_keywords: ['ok', 'sure', 'send', 'details'],
              options: {},
            },
          ],
        },
      ],
    },
  },
  {
    name: 'EdTech – Demo Class Outreach',
    description:
      '4-day funnel: intro WhatsApp, follow-up call, reminder WhatsApp, final qualifying call.',
    workflow: {
      meta: { vertical: 'edtech', goal: 'demo_booking' },
      days: [
        {
          id: 'd1',
          gap: 0,
          actions: [
            {
              id: 'a1',
              type: 'whatsapp',
              template: 'edtech_demo_invite_v1',
              interest_keywords: ['demo', 'register', 'interested', 'class'],
              options: {},
            },
          ],
        },
        {
          id: 'd2',
          gap: 1,
          actions: [
            {
              id: 'a2',
              type: 'call',
              script: 'edtech_demo_qualifier',
              callerId: 'admissions',
              interest_keywords: ['demo', 'tomorrow', 'enroll', 'price', 'fees'],
            },
          ],
        },
        {
          id: 'd3',
          gap: 2,
          actions: [
            {
              id: 'a3',
              type: 'whatsapp',
              template: 'edtech_demo_reminder',
              interest_keywords: ['yes', 'remind', 'attend'],
            },
          ],
        },
        {
          id: 'd4',
          gap: 3,
          actions: [
            {
              id: 'a4',
              type: 'call',
              script: 'edtech_final_close',
              callerId: 'admissions',
              interest_keywords: ['enroll', 'pay', 'admit', 'interested'],
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Insurance – Renewal Reminder',
    description:
      'Two-touch renewal flow: WhatsApp reminder + AI call to confirm renewal intent.',
    workflow: {
      meta: { vertical: 'insurance', goal: 'policy_renewal' },
      days: [
        {
          id: 'r-1',
          gap: 0,
          actions: [
            {
              id: 'r1a',
              type: 'whatsapp',
              template: 'insurance_renewal_v3',
              interest_keywords: ['renew', 'pay', 'continue', 'yes'],
            },
          ],
        },
        {
          id: 'r-2',
          gap: 2,
          actions: [
            {
              id: 'r2a',
              type: 'call',
              script: 'renewal_confirmation',
              callerId: 'retention',
              interest_keywords: ['renew', 'continue', 'pay', 'process'],
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Healthcare – Appointment Booking',
    description:
      'Patient outreach for annual check-up: WhatsApp invite, call to book, reminder day-of.',
    workflow: {
      meta: { vertical: 'healthcare', goal: 'appointment' },
      days: [
        {
          id: 'h1',
          gap: 0,
          actions: [
            {
              id: 'h1w',
              type: 'whatsapp',
              template: 'checkup_invite_v1',
              interest_keywords: ['book', 'appointment', 'doctor', 'yes'],
            },
          ],
        },
        {
          id: 'h2',
          gap: 1,
          actions: [
            {
              id: 'h2c',
              type: 'call',
              script: 'appointment_booker_v1',
              callerId: 'reception',
              interest_keywords: ['book', 'tomorrow', 'morning', 'evening', 'slot'],
            },
          ],
        },
        {
          id: 'h3',
          gap: 5,
          actions: [
            {
              id: 'h3w',
              type: 'whatsapp',
              template: 'appointment_reminder_v1',
              interest_keywords: ['confirm', 'yes', 'coming'],
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Fintech – Loan Pre-Approval',
    description:
      'Pre-approved loan funnel: WhatsApp offer, AI call qualifier, follow-up WhatsApp with link.',
    workflow: {
      meta: { vertical: 'fintech', goal: 'loan_application' },
      days: [
        {
          id: 'l-1',
          gap: 0,
          actions: [
            {
              id: 'l1a',
              type: 'whatsapp',
              template: 'loan_preapproved_v2',
              interest_keywords: ['interested', 'apply', 'amount', 'rate', 'yes'],
            },
          ],
        },
        {
          id: 'l-2',
          gap: 1,
          actions: [
            {
              id: 'l2a',
              type: 'call',
              script: 'loan_qualifier_v3',
              callerId: 'loans-desk',
              interest_keywords: ['apply', 'process', 'documents', 'submit'],
            },
          ],
        },
        {
          id: 'l-3',
          gap: 3,
          actions: [
            {
              id: 'l3a',
              type: 'whatsapp',
              template: 'loan_followup_link',
              interest_keywords: ['link', 'send', 'apply'],
            },
          ],
        },
      ],
    },
  },
];

// --- Lead generators ----------------------------------------------------

const FIRST_NAMES = [
  'Rahul', 'Priya', 'Arjun', 'Ananya', 'Vikram', 'Sneha', 'Karan', 'Pooja',
  'Aditya', 'Riya', 'Rohan', 'Neha', 'Manish', 'Kavya', 'Saurabh', 'Divya',
  'Nikhil', 'Meera', 'Aakash', 'Shreya', 'Sandeep', 'Ishita', 'Tarun', 'Aarti',
  'Rajesh', 'Sunita', 'Amit', 'Deepa', 'Vivek', 'Asha',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Kumar', 'Singh', 'Reddy', 'Iyer', 'Mehta',
  'Joshi', 'Nair', 'Gupta', 'Agarwal', 'Bhat', 'Kapoor', 'Rao', 'Desai',
  'Pillai', 'Khanna', 'Malhotra', 'Chopra',
];
const BUSINESSES = [
  'Apex Realty', 'BrightLearn Academy', 'SecureSure Insurance',
  'CareFirst Clinic', 'QuickCash Finance', 'Horizon Properties',
  'EduSpark', 'SafeNest', 'WellLife Hospital', 'FinEdge',
  null, null, null, // some leads have no business
];
const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Pune', 'Chennai', 'Hyderabad', 'Kolkata', 'Ahmedabad'];

function makeLead(orgId, campaignId, i) {
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  return {
    org_id: orgId,
    campaign_id: campaignId,
    name: `${first} ${last}`,
    phone: indianPhone(),
    country: 'IN',
    business: pick(BUSINESSES),
    source: pick(['csv', 'manual', 'webform', 'api']),
    status: 'raw',
    custom_fields: {
      city: pick(CITIES),
      lead_score: Math.floor(Math.random() * 100),
      notes: `Sample lead #${i + 1}`,
    },
    enrolled_at: new Date(),
  };
}

// --- Main ---------------------------------------------------------------

async function main() {
  await sequelize.authenticate();
  console.log('[seed] DB connection OK');

  const org = await Organization.findOne({ order: [['created_at', 'ASC']] });
  if (!org) {
    console.error('[seed] No organization found — create one first.');
    process.exit(1);
  }
  console.log(`[seed] Seeding into org "${org.name}" (${org.id})`);

  const createdTemplates = [];
  for (const t of TEMPLATES) {
    const existing = await CampaignTemplate.findOne({
      where: { org_id: org.id, name: t.name },
    });
    if (existing) {
      console.log(`[seed] template exists: ${t.name}`);
      createdTemplates.push(existing);
      continue;
    }
    const tpl = await CampaignTemplate.create({
      org_id: org.id,
      name: t.name,
      description: t.description,
      status: 'published',
      version: 1,
      workflow: t.workflow,
    });
    console.log(`[seed] + template ${tpl.name} (${tpl.id})`);
    createdTemplates.push(tpl);
  }

  // Campaign names paired 1:1 with templates.
  const CAMPAIGN_NAMES = [
    'Weekend Site Visit Push – May',
    'Demo Day Outreach – Batch 17',
    'Q2 Renewal Drive',
    'Annual Check-up Campaign 2026',
    'Pre-Approved Loan Wave 3',
  ];

  for (let i = 0; i < createdTemplates.length; i++) {
    const tpl = createdTemplates[i];
    const name = CAMPAIGN_NAMES[i];

    let campaign = await Campaign.findOne({
      where: { org_id: org.id, name },
    });

    if (!campaign) {
      campaign = await Campaign.create({
        org_id: org.id,
        name,
        description: `Sample campaign generated by seed-campaigns-sample.js (${uid()})`,
        template_id: tpl.id,
        template_snapshot: tpl.workflow,
        status: pick(['draft', 'scheduled', 'paused', 'running']),
        start_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        avg_call_seconds: pick([120, 150, 180, 210, 240]),
        stats: { total: 0, contacted: 0, engaged: 0, interested: 0, qualified: 0 },
      });
      console.log(`[seed] + campaign ${campaign.name} (${campaign.id})`);
    } else {
      console.log(`[seed] campaign exists: ${campaign.name}`);
    }

    const leads = [];
    for (let j = 0; j < 50; j++) {
      leads.push(makeLead(org.id, campaign.id, j));
    }
    await CampaignLead.bulkCreate(leads);
    console.log(`[seed]   + 50 leads for ${campaign.name}`);

    const total = await CampaignLead.count({ where: { campaign_id: campaign.id } });
    campaign.stats = { ...campaign.stats, total };
    await campaign.save();
  }

  console.log('[seed] done.');
  await sequelize.close();
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
