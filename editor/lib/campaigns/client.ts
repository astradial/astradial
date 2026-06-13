import { handleUnauthorized } from "@/lib/auth/authStore";

import type {
  ApprovalStatus,
  Campaign,
  CampaignApproval,
  CampaignEvent,
  CampaignImportJob,
  CampaignLead,
  CampaignLeadField,
  CampaignStatus,
  CampaignTemplate,
  CreateImportResponse,
  DashboardSummary,
  EventKind,
  ImportJobMode,
  ImportJobStatus,
  LeadFieldType,
  LeadStatus,
  Paginated,
  TemplateStatus,
  TranscriptPayload,
  Workflow,
} from "./types";

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export interface CreateCampaignResponse {
  campaign: Campaign;
  import: ImportResult | null;
}

export type ImportMode = "skip_duplicates" | "upsert" | "fail_on_conflict";

const BASE = "/api/pbx/campaigns";

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("pbx_org_token") || "";
}

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  const key = typeof window !== "undefined" ? localStorage.getItem("pbx_api_key") || "" : "";
  if (!t && key) h["X-API-Key"] = key;
  return h;
}

// Custom error class carries status — TanStack Query reads err.status
// in its retry policy to skip retries on 4xx (see CampaignsLayout).
export class CampaignsApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, msg?: string) {
    super(msg ?? `${status}: ${body}`);
    this.name = "CampaignsApiError";
    this.status = status;
    this.body = body;
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: headers() });
  if (res.status === 401) {
    handleUnauthorized("campaigns 401");
    throw new CampaignsApiError(401, "", "Session expired");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new CampaignsApiError(res.status, body);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// Multipart variant — Content-Type is set by fetch with the boundary.
async function reqMultipart<T>(path: string, form: FormData, method = "POST"): Promise<T> {
  const h: HeadersInit = {};
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  const key = typeof window !== "undefined" ? localStorage.getItem("pbx_api_key") || "" : "";
  if (!t && key) h["X-API-Key"] = key;
  const res = await fetch(`${BASE}${path}`, { method, body: form, headers: h });
  if (res.status === 401) {
    handleUnauthorized("campaigns 401");
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

function qs(params: object): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v != null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── Templates ──

export const templates = {
  list: (params: { page?: number; limit?: number; status?: TemplateStatus; q?: string } = {}) =>
    req<Paginated<CampaignTemplate>>(`/templates${qs(params)}`),
  get: (id: string) => req<CampaignTemplate>(`/templates/${id}`),
  create: (data: { name: string; description?: string }) =>
    req<CampaignTemplate>("/templates", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; description?: string | null; workflow?: Workflow }) =>
    req<CampaignTemplate>(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  publish: (id: string) => req<CampaignTemplate>(`/templates/${id}/publish`, { method: "POST" }),
  archive: (id: string) => req<CampaignTemplate>(`/templates/${id}/archive`, { method: "POST" }),
  delete: (id: string) => req<void>(`/templates/${id}`, { method: "DELETE" }),
};

// ── Campaigns ──

export interface CreateCampaignInput {
  name: string;
  description?: string;
  template_id?: string;
  owner_user_id?: string;
  start_at?: string; // ISO
  leads_csv?: File | null;
  column_mapping?: Record<string, string>;
  mode?: ImportMode;
}

export const campaigns = {
  list: (params: { page?: number; limit?: number; status?: CampaignStatus; q?: string } = {}) =>
    req<Paginated<Campaign>>(`/${qs(params)}`),
  get: (id: string) => req<Campaign>(`/${id}`),
  create: (input: CreateCampaignInput) => {
    const fd = new FormData();
    fd.append("name", input.name);
    if (input.description) fd.append("description", input.description);
    if (input.template_id) fd.append("template_id", input.template_id);
    if (input.owner_user_id) fd.append("owner_user_id", input.owner_user_id);
    if (input.start_at) fd.append("start_at", input.start_at);
    if (input.column_mapping) fd.append("column_mapping", JSON.stringify(input.column_mapping));
    if (input.leads_csv) fd.append("leads_csv", input.leads_csv);
    const path = input.mode ? `/?mode=${input.mode}` : "/";
    return reqMultipart<CreateCampaignResponse>(path, fd);
  },
  update: (
    id: string,
    data: {
      name?: string;
      description?: string | null;
      owner_user_id?: string | null;
      start_at?: string | null;
      max_concurrent_calls?: number | null;
      max_sends_per_minute?: number | null;
      avg_call_seconds?: number;
    }
  ) => req<Campaign>(`/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  launch: (id: string) => req<Campaign>(`/${id}/launch`, { method: "POST" }),
  pause: (id: string) => req<Campaign>(`/${id}/pause`, { method: "POST" }),
  resume: (id: string) => req<Campaign>(`/${id}/resume`, { method: "POST" }),
  delete: (id: string) => req<void>(`/${id}`, { method: "DELETE" }),
  importLeads: (
    id: string,
    file: File,
    columnMapping: Record<string, string>,
    mode: ImportMode = "skip_duplicates"
  ) => {
    const fd = new FormData();
    fd.append("leads_csv", file);
    fd.append("column_mapping", JSON.stringify(columnMapping));
    return reqMultipart<ImportResult>(`/${id}/leads/import?mode=${mode}`, fd);
  },
};

// ── Campaign voice bots (org-scoped by auth) ──

export interface CampaignBot {
  id: string;
  org_id: string;
  name: string;
  language: string;
  keywords: string[];
  max_words: number;
  call_timeout: number;
  webhook_url: string | null;
  intro_audio_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignBotInput {
  name: string;
  language?: string;
  keywords?: string[];
  max_words?: number;
  call_timeout?: number;
  webhook_url?: string | null;
}

export const campaignBots = {
  list: (orgId: string) => {
    void orgId;
    return req<{ data: CampaignBot[]; total: number }>("/bots");
  },
  get: (orgId: string, id: string) => {
    void orgId;
    return req<CampaignBot>(`/bots/${id}`);
  },
  create: (orgId: string, data: CampaignBotInput) => {
    void orgId;
    return req<CampaignBot>("/bots", { method: "POST", body: JSON.stringify(data) });
  },
  update: (orgId: string, id: string, data: Partial<CampaignBotInput>) => {
    void orgId;
    return req<CampaignBot>(`/bots/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  },
  delete: (orgId: string, id: string) => {
    void orgId;
    return req<void>(`/bots/${id}`, { method: "DELETE" });
  },
  uploadAudio: (orgId: string, id: string, file: File) => {
    void orgId;
    const fd = new FormData();
    fd.append("audio", file);
    return reqMultipart<{ message: string; path: string }>(`/bots/${id}/upload-audio`, fd);
  },
};

// ── Leads (nested under a campaign) ──

export interface LeadsListParams {
  page?: number;
  limit?: number;
  status?: LeadStatus | "all";
  q?: string;
  // sort=lastTouch:desc, status:asc, name:asc — server whitelists.
  sort?: string;
}

export interface OverviewLeadsParams {
  page?: number;
  limit?: number;
  status?: LeadStatus | "all";
  q?: string;
  sort?: string;
  campaign_ids?: string;
  include_draft?: boolean;
}

export interface OverviewLeadsResponse {
  data: (CampaignLead & { campaign_name: string | null; score: number })[];
  counts: Record<LeadStatus, number>;
  total: number;
  page: number;
  pages: number;
}

export const leads = {
  list: (campaignId: string, params: LeadsListParams = {}, opts: { signal?: AbortSignal } = {}) =>
    req<Paginated<CampaignLead>>(`/${campaignId}/leads${qs(params)}`, {
      signal: opts.signal,
    }),
  overview: (params: OverviewLeadsParams = {}, opts: { signal?: AbortSignal } = {}) =>
    req<OverviewLeadsResponse>(`/leads${qs(params)}`, {
      signal: opts.signal,
    }),
  get: (campaignId: string, leadId: string, opts: { signal?: AbortSignal } = {}) =>
    req<CampaignLead>(`/${campaignId}/leads/${leadId}`, { signal: opts.signal }),
  update: (
    campaignId: string,
    leadId: string,
    data: Partial<
      Pick<
        CampaignLead,
        "name" | "country" | "business" | "status" | "intent_score" | "custom_fields"
      >
    >
  ) =>
    req<CampaignLead>(`/${campaignId}/leads/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (campaignId: string, leadId: string) =>
    req<void>(`/${campaignId}/leads/${leadId}`, { method: "DELETE" }),
  // PR 4: lead-drawer timeline + transcript modal
  timeline: (
    campaignId: string,
    leadId: string,
    params: { limit?: number } = {},
    opts: { signal?: AbortSignal } = {}
  ) =>
    req<{ data: CampaignEvent[] }>(`/${campaignId}/leads/${leadId}/timeline${qs(params)}`, {
      signal: opts.signal,
    }),
  transcript: (
    campaignId: string,
    leadId: string,
    eventId: string,
    opts: { signal?: AbortSignal } = {}
  ) =>
    req<TranscriptPayload>(`/${campaignId}/leads/${leadId}/transcript/${eventId}`, {
      signal: opts.signal,
    }),
};

// ── PR 4: per-campaign dashboard summary ──
export const dashboard = {
  get: (campaignId: string, opts: { signal?: AbortSignal } = {}) =>
    req<DashboardSummary>(`/${campaignId}/dashboard`, { signal: opts.signal }),
};

// ── PR 5: concurrency live-count ──
export const concurrency = {
  getLive: (campaignId: string) =>
    req<{ liveCount: number; orgLiveCount: number }>(`/${campaignId}/concurrency`),
};

// ── Events (read-only timeline) ──

export const events = {
  list: (
    campaignId: string,
    params: { page?: number; limit?: number; campaign_lead_id?: string; kind?: EventKind } = {}
  ) => req<Paginated<CampaignEvent>>(`/${campaignId}/events${qs(params)}`),
};

// ── Approvals (org-scoped queue, not per-campaign) ──

export const approvals = {
  list: (
    params: { page?: number; limit?: number; status?: ApprovalStatus; campaign_id?: string } = {}
  ) => req<Paginated<CampaignApproval>>(`/approvals${qs(params)}`),
  get: (id: string) => req<CampaignApproval>(`/approvals/${id}`),
  decide: (id: string, decision: "approved" | "rejected", editedDraft?: string) =>
    req<CampaignApproval>(`/approvals/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision, edited_draft: editedDraft }),
    }),
  count: () => req<{ count: number }>(`/approvals/count`),
};

// SSE subscription for the sidebar badge. Falls back to a polling client on
// browsers without EventSource. Returns an unsubscribe function. The token /
// API key is appended as a query param because EventSource cannot set headers.
export function subscribeToApprovalsCount(
  onCount: (n: number) => void,
  onError?: (e: Event | Error) => void
): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      approvals
        .count()
        .then((r) => !cancelled && onCount(r.count))
        .catch((e) => onError?.(e));
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }
  const tok = getToken();
  const key = localStorage.getItem("pbx_api_key") || "";
  const auth = tok
    ? `token=${encodeURIComponent(tok)}`
    : key
      ? `apiKey=${encodeURIComponent(key)}`
      : "";
  const url = `${BASE}/approvals/stream${auth ? `?${auth}` : ""}`;
  const es = new EventSource(url, { withCredentials: false });
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (typeof data.count === "number") onCount(data.count);
    } catch {
      /* ignore malformed payloads */
    }
  };
  es.onerror = (e) => onError?.(e);
  return () => es.close();
}

// ── Lead-field configuration (org-wide) ──

export interface CreateLeadFieldInput {
  id: string;
  label: string;
  type: LeadFieldType;
  description?: string;
  options?: string[];
  required?: boolean;
  sort_order?: number;
}

export const leadFields = {
  list: (params: { include_deleted?: 0 | 1 } = {}) =>
    req<{ data: CampaignLeadField[] }>(`/lead-fields${qs(params)}`),
  create: (data: CreateLeadFieldInput) =>
    req<CampaignLeadField>(`/lead-fields`, { method: "POST", body: JSON.stringify(data) }),
  update: (
    id: string,
    data: Partial<
      Pick<CampaignLeadField, "label" | "description" | "options" | "required" | "sort_order">
    >
  ) =>
    req<CampaignLeadField>(`/lead-fields/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => req<void>(`/lead-fields/${id}`, { method: "DELETE" }),
  reorder: (ids: string[]) =>
    req<{ ok: true; count: number }>(`/lead-fields/reorder`, {
      method: "PUT",
      body: JSON.stringify({ ids }),
    }),
};

// ── Async CSV imports ──
// Backend: api/src/routes/campaigns.js — POST /:id/leads/import-async and
// GET /:id/imports*. The POST returns 202 + jobId; the GETs are the
// poll target (status moves queued → running → completed|failed).

export interface ImportsListParams {
  page?: number;
  limit?: number;
  status?: ImportJobStatus;
}

export const imports = {
  list: (campaignId: string, params: ImportsListParams = {}, opts: { signal?: AbortSignal } = {}) =>
    req<Paginated<CampaignImportJob>>(`/${campaignId}/imports${qs(params)}`, {
      signal: opts.signal,
    }),

  get: (campaignId: string, jobId: string, opts: { signal?: AbortSignal } = {}) =>
    req<CampaignImportJob>(`/${campaignId}/imports/${jobId}`, {
      signal: opts.signal,
    }),

  // POST is multipart — File + JSON-stringified column mapping. Returns
  // immediately with a jobId; the worker runs in the background and
  // the UI polls .get() until status is terminal.
  create: (
    campaignId: string,
    file: File,
    columnMapping: Record<string, string>,
    mode: ImportJobMode = "skip_duplicates"
  ) => {
    const fd = new FormData();
    fd.append("leads_csv", file);
    fd.append("column_mapping", JSON.stringify(columnMapping));
    return reqMultipart<CreateImportResponse>(`/${campaignId}/leads/import-async?mode=${mode}`, fd);
  },

  // Signals cancellation — the worker re-reads CampaignImportJob.status
  // at every batch boundary (~1000 rows) and bails cleanly. Already-
  // inserted rows stay; queued/running flips to cancelled.
  cancel: (campaignId: string, jobId: string) =>
    req<CampaignImportJob>(`/${campaignId}/imports/${jobId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" }),
    }),
};

// ── Org-level campaign settings ──

export interface CampaignOrgSettings {
  campaign_max_concurrent_calls: number;
  campaign_max_whatsapp_per_minute: number;
}

export const orgSettings = {
  get: () => req<CampaignOrgSettings>("/org-settings"),
  update: (data: Partial<CampaignOrgSettings>) =>
    req<CampaignOrgSettings>("/org-settings", { method: "PATCH", body: JSON.stringify(data) }),
};

// ── WhatsApp template picker (Studio inspector) ──

export interface WhatsAppTemplateMeta {
  name: string;
  status?: string;
  language?: string;
  category?: string;
  namespace?: string;
}

export const whatsappTemplates = {
  list: () =>
    req<{ templates: WhatsAppTemplateMeta[]; configured: boolean }>("/whatsapp-templates"),
};

export type {
  Campaign,
  CampaignApproval,
  CampaignEvent,
  CampaignImportJob,
  CampaignLead,
  CampaignLeadField,
  CampaignTemplate,
  Paginated,
  TemplateStatus,
  Workflow,
} from "./types";
