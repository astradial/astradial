// Mock data for dev-only UI fallback (sourced from seed.sql / seed_cdr.sql).
// NOT imported in production — see lib/mock/dispatcher.ts (gated by NODE_ENV).

export const MOCK_ORG_ID = "d247b87d-5c25-4b80-89bb-9c0edc72ea04";
const PREFIX = "org_mo3yhd1r_";
const now = () => new Date().toISOString();
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;

// ─── Orgs ───

export const mockOrgs = [
  {
    id: MOCK_ORG_ID,
    name: "Sample Org",
    context_prefix: PREFIX,
    api_key: "ak_prod_sample_1234567890abcdef",
    status: "active",
    settings: {},
    limits: { max_users: 50, max_channels: 30 },
    contact_info: { email: "admin@example.com", phone: "+18005550000" },
    createdAt: now(),
    updatedAt: now(),
  },
];

// ─── Users ───

const U = [1, 2, 3, 4, 5, 6].map((i) => `20000000-0000-0000-0000-00000000000${i}`);
export const mockUsers = [
  { id: U[0], username: `${PREFIX}1001`, email: "alice@example.com", extension: "1001", full_name: "Alice Johnson", role: "agent",      recording_enabled: true  },
  { id: U[1], username: `${PREFIX}1002`, email: "bob@example.com",   extension: "1002", full_name: "Bob Smith",      role: "agent",      recording_enabled: false },
  { id: U[2], username: `${PREFIX}1003`, email: "carol@example.com", extension: "1003", full_name: "Carol White",    role: "agent",      recording_enabled: true  },
  { id: U[3], username: `${PREFIX}1004`, email: "dan@example.com",   extension: "1004", full_name: "Dan Lee",        role: "supervisor", recording_enabled: true  },
  { id: U[4], username: `${PREFIX}1005`, email: "emma@example.com",  extension: "1005", full_name: "Emma Davis",     role: "supervisor", recording_enabled: false },
  { id: U[5], username: `${PREFIX}1006`, email: "frank@example.com", extension: "1006", full_name: "Frank Brown",    role: "admin",      recording_enabled: false },
].map((u) => ({
  ...u,
  org_id: MOCK_ORG_ID,
  status: "active" as const,
  sip_password: `sip_${u.extension}`,
  asterisk_endpoint: `${PREFIX}${u.extension}`,
  routing_type: "sip" as const,
  routing_destination: null,
  phone_number: null,
  ring_target: "ext" as const,
  createdAt: now(),
}));

// ─── Trunks ───

const T = [1, 2, 3].map((i) => `10000000-0000-0000-0000-00000000000${i}`);
export const mockTrunks = [
  { id: T[0], name: "Twilio Primary", host: "sip.twilio.com",  username: "twilio_user", transport: "udp", trunk_type: "outbound",  max_channels: 30, status: "active",   registration_status: "registered" },
  { id: T[1], name: "Vonage Backup",  host: "sip.vonage.com",  username: "vonage_user", transport: "tcp", trunk_type: "outbound",  max_channels: 20, status: "active",   registration_status: "registered" },
  { id: T[2], name: "ACME VoIP",      host: "voip.acme.com",   username: "acme_user",   transport: "udp", trunk_type: "peer2peer", max_channels: 10, status: "inactive", registration_status: "unregistered" },
].map((t) => ({ ...t, org_id: MOCK_ORG_ID, port: 5060, createdAt: now() }));

// ─── Queues ───

const Q = [1, 2, 3].map((i) => `30000000-0000-0000-0000-00000000000${i}`);
const queueMembers = (qid: string, uids: { id: string; full_name: string; ext: string; penalty?: number; paused?: boolean }[]) =>
  uids.map((u, idx) => ({
    id: `31000000-0000-0000-0000-${String(qid.slice(-2) + (idx + 1).toString().padStart(2, "0")).padStart(12, "0")}`,
    queue_id: qid,
    user_id: u.id,
    penalty: u.penalty ?? 0,
    paused: u.paused ?? false,
    user: { id: u.id, full_name: u.full_name, extension: u.ext },
  }));

export const mockQueues = [
  {
    id: Q[0], name: "Sales",   number: "2001", strategy: "ringall",
    members: queueMembers(Q[0], [
      { id: U[0], full_name: "Alice Johnson", ext: "1001" },
      { id: U[1], full_name: "Bob Smith",     ext: "1002" },
    ]),
  },
  {
    id: Q[1], name: "Support", number: "2002", strategy: "roundrobin",
    members: queueMembers(Q[1], [
      { id: U[2], full_name: "Carol White", ext: "1003" },
      { id: U[1], full_name: "Bob Smith",   ext: "1002", penalty: 1 },
    ]),
  },
  {
    id: Q[2], name: "Billing", number: "2003", strategy: "leastrecent",
    members: queueMembers(Q[2], [
      { id: U[0], full_name: "Alice Johnson", ext: "1001" },
      { id: U[3], full_name: "Dan Lee",       ext: "1004", paused: true },
    ]),
  },
].map((q) => ({
  ...q,
  org_id: MOCK_ORG_ID,
  timeout: 30,
  max_wait_time: 300,
  music_on_hold: "default",
  greeting_id: null,
  status: "active" as const,
  createdAt: now(),
}));

// ─── DIDs ───

export const mockDids = [
  { id: "40000000-0000-0000-0000-000000000001", trunk_id: T[0], number: "+18005551001",  description: "Sales line",   routing_type: "queue",     routing_destination: "2001", call_limit: 10 },
  { id: "40000000-0000-0000-0000-000000000002", trunk_id: T[0], number: "+18005551002",  description: "Support line", routing_type: "queue",     routing_destination: "2002", call_limit: 10 },
  { id: "40000000-0000-0000-0000-000000000003", trunk_id: T[1], number: "+18005551003",  description: "Main IVR",     routing_type: "ivr",       routing_destination: "9000", call_limit: 20 },
  { id: "40000000-0000-0000-0000-000000000004", trunk_id: T[1], number: "+919876543210", description: "India line",   routing_type: "extension", routing_destination: "1001", call_limit: 5  },
].map((d) => ({ ...d, org_id: MOCK_ORG_ID, status: "active" as const, recording_enabled: true, createdAt: now() }));

// ─── Greetings ───

export const mockGreetings = [
  { id: "60000000-0000-0000-0000-000000000001", name: "Main Welcome", text: "Welcome to Sample Org. Press 1 for sales, 2 for support, 3 for billing.", status: "active"   },
  { id: "60000000-0000-0000-0000-000000000002", name: "After Hours",  text: "We are currently closed. Please call back Monday through Friday 9 to 6.", status: "active"   },
  { id: "60000000-0000-0000-0000-000000000003", name: "Holiday",      text: "We are closed for the holiday. Wishing you a happy season.",              status: "inactive" },
].map((g) => ({ ...g, org_id: MOCK_ORG_ID, language: "en-IN", voice: "en-IN-Wavenet-D", audio_file: null, createdAt: now() }));

// ─── MoH ───

export const mockMoh = {
  org_classes: [
    { class: "default", moh_class_name: "default", file_count: 2, files: [
      { filename: "holdtune1.wav", size: 120_000, uploaded_at: now() },
      { filename: "holdtune2.wav", size: 98_000,  uploaded_at: now() },
    ]},
  ],
  system_classes: ["default", "none"],
};

// ─── CRM: companies ───

const C = [1, 2, 3, 4, 5].map((i) => `c0000000-0000-0000-0000-00000000000${i}`);
export const mockCompanies = [
  { id: C[0], name: "Acme Corporation", industry: "Manufacturing", size: "201-500", phone: "+18005550101", email: "info@acme.com",        website: "https://acme.com",       address: "100 Industrial Way, Detroit", notes: "Key account, renewed 2026" },
  { id: C[1], name: "TechInnovate",     industry: "Software",      size: "51-200",  phone: "+18005550102", email: "hello@techinnovate.io", website: "https://techinnovate.io", address: "San Francisco HQ",            notes: "Hot lead, demo scheduled"  },
  { id: C[2], name: "Global Logistics", industry: "Shipping",      size: "500+",    phone: "+18005550103", email: "contact@globallog.com", website: "https://globallog.com",   address: "Rotterdam",                   notes: "Multi-region contract"     },
  { id: C[3], name: "Bright Solutions", industry: "Consulting",    size: "11-50",   phone: "+18005550104", email: "sales@bright.co",       website: "https://bright.co",       address: "Austin TX",                   notes: "Onboarding in progress"    },
  { id: C[4], name: "NovaWare",         industry: "SaaS",          size: "1-10",    phone: "+18005550105", email: "hi@novaware.app",       website: "https://novaware.app",    address: "Remote-first, Europe",        notes: "Churn risk — flag Dan"     },
].map((c) => ({ ...c, org_id: MOCK_ORG_ID, assigned_to: null, created_by: "admin@example.com", createdAt: now(), updatedAt: now() }));

// ─── CRM: contacts ───

const CT = Array.from({ length: 10 }, (_, i) => `c1000000-0000-0000-0000-0000000000${(i + 1).toString().padStart(2, "0")}`);
export const mockContacts = [
  { id: CT[0], company_id: C[0], first_name: "Jane",   last_name: "Doe",        email: "jane.doe@acme.com",     phone: "+18005550201", job_title: "VP Operations", lead_source: "referral",      lead_status: "qualified"   },
  { id: CT[1], company_id: C[0], first_name: "Marcus", last_name: "Lee",        email: "marcus@acme.com",       phone: "+18005550202", job_title: "IT Director",   lead_source: "website",       lead_status: "contacted"   },
  { id: CT[2], company_id: C[1], first_name: "Priya",  last_name: "Sharma",     email: "priya@techinnovate.io", phone: "+18005550203", job_title: "CTO",           lead_source: "event",         lead_status: "qualified"   },
  { id: CT[3], company_id: C[1], first_name: "Oliver", last_name: "Brown",      email: "oliver@techinnovate.io",phone: "+18005550204", job_title: "Head of Eng",   lead_source: "website",       lead_status: "new"         },
  { id: CT[4], company_id: C[2], first_name: "Ingrid", last_name: "van Dijk",   email: "ingrid@globallog.com",  phone: "+18005550205", job_title: "Logistics Mgr", lead_source: "cold_call",     lead_status: "contacted"   },
  { id: CT[5], company_id: C[2], first_name: "Kenji",  last_name: "Tanaka",     email: "kenji@globallog.com",   phone: "+18005550206", job_title: "Regional Dir",  lead_source: "referral",      lead_status: "new"         },
  { id: CT[6], company_id: C[3], first_name: "Sofia",  last_name: "Alvarez",    email: "sofia@bright.co",       phone: "+18005550207", job_title: "CEO",           lead_source: "social",        lead_status: "qualified"   },
  { id: CT[7], company_id: C[3], first_name: "David",  last_name: "Nguyen",     email: "david@bright.co",       phone: "+18005550208", job_title: "Ops Lead",      lead_source: "website",       lead_status: "contacted"   },
  { id: CT[8], company_id: C[4], first_name: "Lena",   last_name: "Petrov",     email: "lena@novaware.app",     phone: "+18005550209", job_title: "Founder",       lead_source: "event",         lead_status: "lost"        },
  { id: CT[9], company_id: C[4], first_name: "Amir",   last_name: "Khoury",     email: "amir@novaware.app",     phone: "+18005550210", job_title: "Growth Lead",   lead_source: "advertisement", lead_status: "new"         },
].map((c) => ({
  ...c,
  org_id: MOCK_ORG_ID,
  notes: null,
  assigned_to: null,
  created_by: "admin@example.com",
  createdAt: now(), updatedAt: now(),
  company: mockCompanies.find((co) => co.id === c.company_id) ? { id: c.company_id, name: mockCompanies.find((co) => co.id === c.company_id)!.name } : null,
}));

// ─── CRM: deals ───

const D = [1, 2, 3, 4, 5, 6].map((i) => `d0000000-0000-0000-0000-00000000000${i}`);
export const mockDeals = [
  { id: D[0], company_id: C[0], contact_id: CT[0], title: "Acme — Call Center Expansion",  stage: "negotiation", amount: 120000, currency: "USD", expected_close: "2026-05-15", notes: "Decision by EOQ"        },
  { id: D[1], company_id: C[1], contact_id: CT[2], title: "TechInnovate — Annual License", stage: "proposal",    amount: 48000,  currency: "USD", expected_close: "2026-05-30", notes: "Waiting on procurement" },
  { id: D[2], company_id: C[2], contact_id: CT[4], title: "Global Logistics — EU Region",  stage: "lead",        amount: 280000, currency: "EUR", expected_close: "2026-07-01", notes: "Early stage"            },
  { id: D[3], company_id: C[3], contact_id: CT[6], title: "Bright — Upgrade",              stage: "won",         amount: 32000,  currency: "USD", expected_close: "2026-04-10", notes: "Closed last week"       },
  { id: D[4], company_id: C[4], contact_id: CT[9], title: "NovaWare — Starter Plan",       stage: "lost",        amount: 6000,   currency: "USD", expected_close: "2026-03-20", notes: "Went with competitor"   },
  { id: D[5], company_id: C[0], contact_id: CT[1], title: "Acme — IT Services Add-on",     stage: "proposal",    amount: 18000,  currency: "USD", expected_close: "2026-06-10", notes: "Upsell on existing"     },
].map((d) => ({
  ...d,
  org_id: MOCK_ORG_ID,
  assigned_to: null, created_by: "admin@example.com",
  createdAt: now(), updatedAt: now(),
  company: mockCompanies.find((c) => c.id === d.company_id) ? { id: d.company_id, name: mockCompanies.find((c) => c.id === d.company_id)!.name } : null,
  contact: mockContacts.find((c) => c.id === d.contact_id) ? (() => { const c = mockContacts.find((c) => c.id === d.contact_id)!; return { id: c.id, first_name: c.first_name, last_name: c.last_name }; })() : null,
}));

// ─── CRM: activities ───

const relDay = (d: number) => iso(d * DAY);
export const mockActivities = [
  { contact_id: CT[0], company_id: C[0], deal_id: D[0], type: "call",    subject: "Discovery call",            body: "Initial scoping call — 45 min",    due_date: relDay(-10), completed: true  },
  { contact_id: CT[0], company_id: C[0], deal_id: D[0], type: "email",   subject: "Proposal sent",             body: "Sent v2 pricing deck",             due_date: relDay(-7),  completed: true  },
  { contact_id: CT[0], company_id: C[0], deal_id: D[0], type: "meeting", subject: "Negotiation call",          body: "Review terms with procurement",    due_date: relDay(3),   completed: false },
  { contact_id: CT[2], company_id: C[1], deal_id: D[1], type: "call",    subject: "Demo call",                 body: "Product demo for CTO + team",      due_date: relDay(-4),  completed: true  },
  { contact_id: CT[2], company_id: C[1], deal_id: D[1], type: "task",    subject: "Send MSA draft",            body: null,                                due_date: relDay(1),   completed: false },
  { contact_id: CT[4], company_id: C[2], deal_id: D[2], type: "email",   subject: "Intro email",               body: "Sent intro + capabilities deck",   due_date: relDay(-2),  completed: true  },
  { contact_id: CT[4], company_id: C[2], deal_id: D[2], type: "call",    subject: "Discovery call scheduled",  body: null,                                due_date: relDay(5),   completed: false },
  { contact_id: CT[6], company_id: C[3], deal_id: D[3], type: "meeting", subject: "Kickoff",                   body: "Kickoff with Bright Solutions",    due_date: relDay(-14), completed: true  },
  { contact_id: CT[6], company_id: C[3], deal_id: D[3], type: "note",    subject: "Contract signed",           body: "DocuSign completed by Sofia",      due_date: relDay(-12), completed: true  },
  { contact_id: CT[9], company_id: C[4], deal_id: D[4], type: "call",    subject: "Loss review",               body: "Went with cheaper competitor",     due_date: relDay(-20), completed: true  },
  { contact_id: CT[1], company_id: C[0], deal_id: D[5], type: "email",   subject: "Upsell pitch",              body: null,                                due_date: relDay(-1),  completed: true  },
  { contact_id: CT[1], company_id: C[0], deal_id: D[5], type: "task",    subject: "Follow up in 3 days",       body: null,                                due_date: relDay(3),   completed: false },
  { contact_id: CT[3], company_id: C[1], deal_id: null, type: "note",    subject: "Warm handoff from Priya",   body: "Oliver is technical champion",     due_date: now(),       completed: false },
  { contact_id: CT[7], company_id: C[3], deal_id: null, type: "call",    subject: "Onboarding check-in",       body: "Ops going well",                    due_date: relDay(-5),  completed: true  },
  { contact_id: CT[5], company_id: C[2], deal_id: D[2], type: "email",   subject: "NDA sent",                  body: null,                                due_date: relDay(2),   completed: false },
].map((a, i) => ({
  ...a,
  id: `e0000000-0000-0000-0000-0000000000${(i + 1).toString().padStart(2, "0")}`,
  org_id: MOCK_ORG_ID,
  assigned_to: null, created_by: "admin@example.com",
  createdAt: now(),
}));

// ─── CRM: stats ───

export const mockCrmStats = {
  companies: mockCompanies.length,
  contacts: mockContacts.length,
  deals: mockDeals.length,
  open_deals: mockDeals.filter((d) => d.stage !== "won" && d.stage !== "lost").length,
  pipeline_value: mockDeals.filter((d) => d.stage !== "won" && d.stage !== "lost").reduce((s, d) => s + (d.amount || 0), 0),
  won_value: mockDeals.filter((d) => d.stage === "won").reduce((s, d) => s + (d.amount || 0), 0),
};

// ─── CRM: pipeline stages ───

export const mockLeadStages = [
  { id: "b0000000-0000-0000-0000-000000000001", stage_key: "new",         stage_label: "New",         sort_order: 1 },
  { id: "b0000000-0000-0000-0000-000000000002", stage_key: "contacted",   stage_label: "Contacted",   sort_order: 2 },
  { id: "b0000000-0000-0000-0000-000000000003", stage_key: "qualified",   stage_label: "Qualified",   sort_order: 3 },
  { id: "b0000000-0000-0000-0000-000000000004", stage_key: "unqualified", stage_label: "Unqualified", sort_order: 4 },
];
export const mockDealStages = [
  { id: "b0000000-0000-0000-0000-000000000005", stage_key: "lead",        stage_label: "Lead",        sort_order: 1 },
  { id: "b0000000-0000-0000-0000-000000000006", stage_key: "proposal",    stage_label: "Proposal",    sort_order: 2 },
  { id: "b0000000-0000-0000-0000-000000000007", stage_key: "negotiation", stage_label: "Negotiation", sort_order: 3 },
  { id: "b0000000-0000-0000-0000-000000000008", stage_key: "won",         stage_label: "Won",         sort_order: 4 },
  { id: "b0000000-0000-0000-0000-000000000009", stage_key: "lost",        stage_label: "Lost",        sort_order: 5 },
];

// ─── CRM: custom fields ───

export const mockCustomFields = [
  { id: "f0000000-0000-0000-0000-000000000001", entity_type: "contact", field_name: "preferred_contact_time", field_label: "Preferred Contact Time", field_type: "select", options: ["Morning", "Afternoon", "Evening"], required: false, sort_order: 1 },
  { id: "f0000000-0000-0000-0000-000000000002", entity_type: "company", field_name: "tier",                   field_label: "Account Tier",           field_type: "select", options: ["Platinum", "Gold", "Silver"],     required: false, sort_order: 2 },
  { id: "f0000000-0000-0000-0000-000000000003", entity_type: "deal",    field_name: "competitor",             field_label: "Competitor",             field_type: "text",   options: null,                               required: false, sort_order: 3 },
].map((f) => ({ ...f, org_id: MOCK_ORG_ID }));

// ─── Call history ───

interface CallRow {
  id: string;
  call_id: string;
  channel_id: string;
  from_number: string;
  to_number: string;
  caller_id_name: string;
  direction: "inbound" | "outbound" | "internal";
  status: string;
  trunk_id: string | null;
  user_id: string | null;
  queue_id: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string;
  duration: number;
  talk_time: number;
  wait_time: number;
  hangup_cause: string;
  cost: number;
}

const rows: Omit<CallRow, "id" | "call_id" | "channel_id" | "started_at" | "answered_at" | "ended_at">[] = [
  { from_number: "+18005552001", to_number: "+18005551001", caller_id_name: "Customer 1",  direction: "inbound",  status: "ANSWERED",  trunk_id: T[0], user_id: U[0], queue_id: Q[0], duration: 420, talk_time: 410, wait_time: 10, hangup_cause: "NORMAL_CLEARING",    cost: 0.15 },
  { from_number: "+18005552002", to_number: "+18005551001", caller_id_name: "Customer 2",  direction: "inbound",  status: "ANSWERED",  trunk_id: T[0], user_id: U[1], queue_id: Q[0], duration: 540, talk_time: 525, wait_time: 15, hangup_cause: "NORMAL_CLEARING",    cost: 0.21 },
  { from_number: "+18005552003", to_number: "+18005551002", caller_id_name: "Customer 3",  direction: "inbound",  status: "ANSWERED",  trunk_id: T[0], user_id: U[2], queue_id: Q[1], duration: 420, talk_time: 410, wait_time: 10, hangup_cause: "NORMAL_CLEARING",    cost: 0.15 },
  { from_number: "+18005552004", to_number: "+18005551001", caller_id_name: "Customer 4",  direction: "inbound",  status: "NO ANSWER", trunk_id: T[0], user_id: null, queue_id: Q[0], duration: 30,  talk_time: 0,   wait_time: 30, hangup_cause: "NO_ANSWER",           cost: 0    },
  { from_number: "+18005552005", to_number: "+18005551002", caller_id_name: "Customer 5",  direction: "inbound",  status: "BUSY",      trunk_id: T[0], user_id: null, queue_id: Q[1], duration: 5,   talk_time: 0,   wait_time: 5,  hangup_cause: "USER_BUSY",           cost: 0    },
  { from_number: "+18005551001", to_number: "+18005552006", caller_id_name: "Alice J",     direction: "outbound", status: "ANSWERED",  trunk_id: T[0], user_id: U[0], queue_id: null, duration: 300, talk_time: 290, wait_time: 10, hangup_cause: "NORMAL_CLEARING",    cost: 0.12 },
  { from_number: "+18005551001", to_number: "+18005552007", caller_id_name: "Bob S",       direction: "outbound", status: "ANSWERED",  trunk_id: T[0], user_id: U[1], queue_id: null, duration: 540, talk_time: 525, wait_time: 15, hangup_cause: "NORMAL_CLEARING",    cost: 0.21 },
  { from_number: "+18005551002", to_number: "+18005552008", caller_id_name: "Carol W",     direction: "outbound", status: "FAILED",    trunk_id: T[1], user_id: U[2], queue_id: null, duration: 10,  talk_time: 0,   wait_time: 10, hangup_cause: "UNALLOCATED_NUMBER", cost: 0    },
  { from_number: "1001",         to_number: "1004",         caller_id_name: "Alice J",     direction: "internal", status: "ANSWERED",  trunk_id: null, user_id: U[0], queue_id: null, duration: 240, talk_time: 235, wait_time: 5,  hangup_cause: "NORMAL_CLEARING",    cost: 0    },
  { from_number: "1005",         to_number: "1006",         caller_id_name: "Emma D",      direction: "internal", status: "ANSWERED",  trunk_id: null, user_id: U[4], queue_id: null, duration: 180, talk_time: 175, wait_time: 5,  hangup_cause: "NORMAL_CLEARING",    cost: 0    },
  { from_number: "+18005552011", to_number: "+18005551001", caller_id_name: "Customer 11", direction: "inbound",  status: "ANSWERED",  trunk_id: T[0], user_id: U[0], queue_id: Q[0], duration: 540, talk_time: 525, wait_time: 15, hangup_cause: "NORMAL_CLEARING",    cost: 0.21 },
  { from_number: "+18005552012", to_number: "+18005551001", caller_id_name: "Customer 12", direction: "inbound",  status: "ANSWERED",  trunk_id: T[0], user_id: U[1], queue_id: Q[0], duration: 540, talk_time: 525, wait_time: 15, hangup_cause: "NORMAL_CLEARING",    cost: 0.21 },
  { from_number: "+18005552013", to_number: "+18005551002", caller_id_name: "Customer 13", direction: "inbound",  status: "ANSWERED",  trunk_id: T[0], user_id: U[2], queue_id: Q[1], duration: 480, talk_time: 465, wait_time: 15, hangup_cause: "NORMAL_CLEARING",    cost: 0.18 },
  { from_number: "+18005552014", to_number: "+18005551003", caller_id_name: "Customer 14", direction: "inbound",  status: "ANSWERED",  trunk_id: T[1], user_id: U[0], queue_id: null, duration: 540, talk_time: 530, wait_time: 10, hangup_cause: "NORMAL_CLEARING",    cost: 0.21 },
  { from_number: "+18005552015", to_number: "+18005551001", caller_id_name: "Customer 15", direction: "inbound",  status: "FAILED",    trunk_id: T[0], user_id: null, queue_id: Q[0], duration: 8,   talk_time: 0,   wait_time: 8,  hangup_cause: "NORMAL_CLEARING",    cost: 0    },
];
export const mockCalls: CallRow[] = rows.map((r, idx) => {
  const hoursAgo = 2 + idx;
  const started = Date.now() - hoursAgo * HR;
  return {
    ...r,
    id: `ca000000-0000-0000-0000-0000000000${(idx + 1).toString().padStart(2, "0")}`,
    call_id: `call_${String(idx + 1).padStart(3, "0")}`,
    channel_id: `PJSIP/1001-${String(idx + 1).padStart(4, "0")}`,
    started_at: new Date(started).toISOString(),
    answered_at: r.talk_time > 0 ? new Date(started + r.wait_time * 1000).toISOString() : null,
    ended_at: new Date(started + r.duration * 1000).toISOString(),
  };
});

// ─── Call stats ───

export const mockCallStats = {
  weekly: Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * DAY);
    return { date: d.toISOString().slice(0, 10), inbound: 8 + i, outbound: 4 + (i % 3) };
  }),
  totals: {
    total_calls: 30,
    inbound: 19,
    outbound: 8,
    answered: 23,
    missed: 4,
    avg_duration: 380,
  },
};

export const mockLiveCalls: Record<string, unknown>[] = [];

// ─── Webhooks (for /webhooks page) ───

export const mockWebhooks = [
  { id: "90000000-0000-0000-0000-000000000001", org_id: MOCK_ORG_ID, url: "https://hooks.example.com/crm",   events: ["call.ended", "call.answered"], secret: "whsec_abc123", active: true, retry_count: 3, timeout: 30, description: "CRM sync",     createdAt: now() },
  { id: "90000000-0000-0000-0000-000000000002", org_id: MOCK_ORG_ID, url: "https://hooks.example.com/slack", events: ["call.missed"],                  secret: null,           active: true, retry_count: 3, timeout: 15, description: "Slack alerts", createdAt: now() },
];

// ─── Ticket WhatsApp Config (default/empty) ───

export const mockTicketWhatsappConfig = {
  enabled: false,
  sender_number: "",
  statuses: {
    open:        { enabled: false, template_name: "", template_language: "en", variable_mapping: {} },
    in_progress: { enabled: false, template_name: "", template_language: "en", variable_mapping: {} },
    closed:      { enabled: false, template_name: "", template_language: "en", variable_mapping: {} },
  },
};
