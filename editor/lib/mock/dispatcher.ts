// Pattern-matches incoming mock requests → seeded data from `./data.ts`.
// Only returns a Response when we have a specific mapping; otherwise falls back
// to a shape-safe default so unmapped pages render empty instead of crashing.
//
// Contract:
//   dispatch({ upstream, segments, method, url, body }) → Response
//   - upstream: "pbx" | "gateway" | "workflow"
//   - segments: path parts AFTER the upstream prefix, e.g. ["users", "<id>"]

import {
  mockUsers,
  mockOrgs,
  mockTrunks,
  mockQueues,
  mockDids,
  mockGreetings,
  mockMoh,
  mockCompanies,
  mockContacts,
  mockDeals,
  mockActivities,
  mockCrmStats,
  mockLeadStages,
  mockDealStages,
  mockCustomFields,
  mockCalls,
  mockCallStats,
  mockLiveCalls,
  mockWebhooks,
  mockTicketWhatsappConfig,
  MOCK_ORG_ID,
} from "./data";

type Upstream = "pbx" | "gateway" | "workflow";

export interface MockCtx {
  upstream: Upstream;
  segments: string[];
  method: string;
  url: URL;
  body: unknown;
}

export async function dispatch(ctx: MockCtx): Promise<Response> {
  if (ctx.upstream === "pbx") {
    const res = pbx(ctx);
    if (res) return res;
  }
  if (ctx.upstream === "workflow") {
    const res = workflow(ctx);
    if (res) return res;
  }
  return fallback(ctx);
}

// ─── PBX mappings ─────────────────────────────────────────────────────────

function pbx(ctx: MockCtx): Response | null {
  const { method, segments, url, body } = ctx;
  const path = "/" + segments.join("/");

  // auth -----------------------------------------------------------------
  // Accept any email/password in mock mode — we just need a valid session
  // so dashboard/[orgId]/layout.tsx lets the page render.
  if (method === "POST" && path === "/auth/user-login") {
    const email = ((body as { email?: string })?.email) || "dev@example.com";
    return json({
      token: "mock_jwt_" + Math.random().toString(36).slice(2),
      user: {
        id: mockUsers[0].id,
        email,
        org_id: MOCK_ORG_ID,
        org_name: mockOrgs[0].name,
        role: "owner",
        full_name: mockUsers[0].full_name,
        permissions: ["*"],
      },
    });
  }
  if (method === "POST" && path === "/auth/register")    return json({ message: "Account created! You can now sign in." });
  if (method === "POST" && path === "/auth/request-org") return json({ ok: true, message: "Request submitted" });

  // calls ----------------------------------------------------------------
  if (method === "GET" && path === "/calls/stats") return json(mockCallStats);
  if (method === "GET" && path === "/calls/count") return json({ count: mockLiveCalls.length });
  if (method === "GET" && path === "/calls/live")  return json({ count: mockLiveCalls.length, calls: mockLiveCalls });
  if (method === "GET" && path === "/calls/history") {
    const limit = Number(url.searchParams.get("limit") || 50);
    const page  = Number(url.searchParams.get("page")  || 1);
    const direction = url.searchParams.get("direction");
    const filtered = direction ? mockCalls.filter((c) => c.direction === direction) : mockCalls;
    const items = filtered.slice((page - 1) * limit, page * limit).map(toHistoryItem);
    return json({ items, total: filtered.length, page, pages: Math.max(1, Math.ceil(filtered.length / limit)), hasMore: page * limit < filtered.length });
  }

  // users, orgs, trunks, queues, dids, greetings, webhooks ---------------
  if (method === "GET" && path === "/users")     return json(mockUsers);
  if (method === "GET" && path === "/trunks")    return json(mockTrunks);
  if (method === "GET" && path === "/queues")    return json(mockQueues);
  if (method === "GET" && path === "/dids")      return json(mockDids);
  if (method === "GET" && path === "/greetings") return json(mockGreetings);
  if (method === "GET" && path === "/webhooks")  return json(mockWebhooks);
  if (method === "GET" && path === "/moh")       return json(mockMoh);
  if (method === "GET" && path === "/organizations")       return json(mockOrgs);
  if (method === "GET" && /^\/organizations\/[^/]+$/.test(path)) return json(mockOrgs[0]);

  // CRM -------------------------------------------------------------------
  // Client expects Paginated<T> = { data, total, page, pages } for list endpoints.
  if (method === "GET" && path === "/crm/companies")  return json(paginate(mockCompanies, url));
  if (method === "GET" && path === "/crm/contacts") {
    const company_id = url.searchParams.get("company_id");
    const lead_status = url.searchParams.get("lead_status");
    let rows = mockContacts;
    if (company_id)  rows = rows.filter((r) => r.company_id === company_id);
    if (lead_status) rows = rows.filter((r) => r.lead_status === lead_status);
    return json(paginate(rows, url));
  }
  if (method === "GET" && path === "/crm/deals") {
    const stage = url.searchParams.get("stage");
    const company_id = url.searchParams.get("company_id");
    const contact_id = url.searchParams.get("contact_id");
    let rows = mockDeals;
    if (stage)      rows = rows.filter((r) => r.stage === stage);
    if (company_id) rows = rows.filter((r) => r.company_id === company_id);
    if (contact_id) rows = rows.filter((r) => r.contact_id === contact_id);
    return json(paginate(rows, url));
  }
  if (method === "GET" && path === "/crm/activities") {
    const contact_id = url.searchParams.get("contact_id");
    const company_id = url.searchParams.get("company_id");
    const deal_id    = url.searchParams.get("deal_id");
    const type       = url.searchParams.get("type");
    let rows = mockActivities as typeof mockActivities;
    if (contact_id) rows = rows.filter((r) => r.contact_id === contact_id);
    if (company_id) rows = rows.filter((r) => r.company_id === company_id);
    if (deal_id)    rows = rows.filter((r) => r.deal_id === deal_id);
    if (type)       rows = rows.filter((r) => r.type === type);
    return json(paginate(rows, url));
  }
  if (method === "GET" && path === "/crm/stats")          return json(mockCrmStats);
  if (method === "GET" && path === "/crm/custom-fields") {
    const entity_type = url.searchParams.get("entity_type");
    const rows = entity_type ? mockCustomFields.filter((f) => f.entity_type === entity_type) : mockCustomFields;
    return json(rows);
  }
  if (method === "GET" && path === "/crm/pipelines/lead") return json(mockLeadStages);
  if (method === "GET" && path === "/crm/pipelines/deal") return json(mockDealStages);

  // Settings / compliance / tickets --------------------------------------
  if (method === "GET" && path === "/compliance") return json({
    org_id: MOCK_ORG_ID, recording_consent: "announcement",
    retention_cdr_days: 365, retention_recording_days: 180, pii_masking: false,
  });
  if (method === "GET" && path === "/tickets/whatsapp-config") return json(mockTicketWhatsappConfig);
  if (method === "GET" && path === "/tickets")       return json([]);
  if (method === "GET" && path === "/tickets/stats") return json({ total: 0, open: 0, in_progress: 0, closed: 0 });

  // DID pool (onboarding banner) -----------------------------------------
  if (method === "GET" && path === "/did-pool/my")        return json({ assigned: mockDids, pending: [] });
  if (method === "GET" && path === "/did-pool/available") return json([]);

  // server-info (used by SIP QR dialog) ----------------------------------
  if (method === "GET" && path === "/server-info") return json({
    sip_server: "sip.example.com", sip_port: 5060, websocket_url: "wss://sip.example.com/ws",
  });

  // PBX API keys (webhooks page) -----------------------------------------
  if (method === "GET"  && path === "/api-keys") return json({ keys: [] });
  if (method === "POST" && path === "/api-keys") return json({
    id: "mock_key_" + Math.random().toString(36).slice(2, 8),
    name: (body as { name?: string })?.name || "Default",
    api_key: "ak_mock_" + Math.random().toString(36).slice(2, 14),
    api_secret: "as_mock_" + Math.random().toString(36).slice(2, 26),
    permissions: (body as { permissions?: string[] })?.permissions || [],
    status: "active", last_used_at: null, created_by: null,
    createdAt: new Date().toISOString(),
  });

  return null;
}

// ─── Workflow-engine mappings ─────────────────────────────────────────────

function workflow(ctx: MockCtx): Response | null {
  const { method, segments } = ctx;
  const path = "/" + segments.join("/");

  if (method === "GET" && path === "/workflows") return json([]);
  if (method === "GET" && /^\/orgs\/[^/]+\/automation-config$/.test(path)) {
    return json({ automation_channel_limit: 10, current_automation_calls: 0 });
  }
  if (method === "GET" && /^\/orgs\/[^/]+\/scheduled-jobs/.test(path)) {
    return json({ jobs: [], total: 0, page: 1, limit: 20, totalPages: 0, activeCount: 0 });
  }
  if (method === "GET" && path === "/api-keys") return json([]);
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function paginate<T>(rows: T[], url: URL) {
  const page  = Number(url.searchParams.get("page")  || 1);
  const limit = Number(url.searchParams.get("limit") || 50);
  const search = (url.searchParams.get("search") || "").toLowerCase();
  const filtered = search
    ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(search))
    : rows;
  const data = filtered.slice((page - 1) * limit, page * limit);
  return { data, total: filtered.length, page, pages: Math.max(1, Math.ceil(filtered.length / limit)) };
}

function toHistoryItem(c: (typeof mockCalls)[number]) {
  return {
    id: c.id,
    org_id: MOCK_ORG_ID,
    call_id: c.call_id,
    from_number: c.from_number,
    to_number: c.to_number,
    direction: c.direction,
    status: c.status,
    duration: c.duration,
    talk_time: c.talk_time,
    started_at: c.started_at,
    ended_at: c.ended_at,
    recording_file: null,
    recording_url: null,
    linkedid: c.call_id,
  };
}

function fallback(ctx: MockCtx): Response {
  const { method, segments } = ctx;
  if (method !== "GET") {
    if (method === "DELETE") return json(null, 204);
    return json({ ok: true, id: "mock_" + Math.random().toString(36).slice(2, 10) });
  }
  const tail = segments[segments.length - 1] || "";
  const plural = /s$|list$|live$|stats?$|history$/i.test(tail);
  return json(plural ? [] : {});
}

export function json(data: unknown, status = 200): Response {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
