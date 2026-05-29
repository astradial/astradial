import { handleUnauthorized } from "@/lib/auth/authStore";

const BASE = "/api/pbx/crm";

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

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: headers() });
  if (res.status === 401) { handleUnauthorized("crm 401"); throw new Error("Session expired"); }
  if (!res.ok) { const b = await res.text(); throw new Error(`${res.status}: ${b}`); }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ── Types ──

export interface Company {
  id: string;
  org_id: string;
  name: string;
  industry: string | null;
  size: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  assigned_to: string | null;
  created_by: string | null;
  createdAt: string;
  updatedAt: string;
  contacts?: { id: string }[];
  deals?: Deal[];
  custom_fields?: Record<string, string>;
}

export interface Contact {
  id: string;
  org_id: string;
  company_id: string | null;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  lead_source: string | null;
  lead_status: "new" | "contacted" | "qualified" | "converted" | "lost";
  notes: string | null;
  assigned_to: string | null;
  created_by: string | null;
  createdAt: string;
  updatedAt: string;
  company?: { id: string; name: string } | null;
  custom_fields?: Record<string, string>;
}

export interface Deal {
  id: string;
  org_id: string;
  company_id: string | null;
  contact_id: string | null;
  title: string;
  stage: "lead" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
  amount: number | null;
  currency: string;
  expected_close: string | null;
  notes: string | null;
  assigned_to: string | null;
  created_by: string | null;
  createdAt: string;
  updatedAt: string;
  company?: { id: string; name: string } | null;
  contact?: { id: string; first_name: string; last_name: string | null } | null;
  custom_fields?: Record<string, string>;
}

export interface Activity {
  id: string;
  org_id: string;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  type: "note" | "call" | "email" | "meeting" | "task";
  subject: string | null;
  body: string | null;
  due_date: string | null;
  completed: boolean;
  assigned_to: string | null;
  created_by: string | null;
  createdAt: string;
}

export interface CustomField {
  id: string;
  org_id: string;
  entity_type: "contact" | "company" | "deal";
  field_name: string;
  field_label: string;
  field_type: "text" | "number" | "date" | "select" | "checkbox" | "email" | "phone" | "url" | "textarea";
  options: string[] | null;
  required: boolean;
  sort_order: number;
}

export interface CrmStats {
  companies: number;
  contacts: number;
  deals: number;
  open_deals: number;
  pipeline_value: number;
  won_value: number;
}

interface Paginated<T> { data: T[]; total: number; page: number; pages: number; }

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── Companies ──

export const companies = {
  list: (params: { page?: number; limit?: number; search?: string; assigned_to?: string } = {}) =>
    req<Paginated<Company>>(`/companies${qs(params)}`),
  get: (id: string) => req<Company>(`/companies/${id}`),
  create: (data: Partial<Company>) => req<Company>("/companies", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Company>) => req<Company>(`/companies/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => req(`/companies/${id}`, { method: "DELETE" }),
};

// ── Contacts ──

export const contacts = {
  list: (params: { page?: number; limit?: number; search?: string; lead_status?: string; company_id?: string; assigned_to?: string } = {}) =>
    req<Paginated<Contact>>(`/contacts${qs(params)}`),
  get: (id: string) => req<Contact>(`/contacts/${id}`),
  create: (data: Partial<Contact>) => req<Contact>("/contacts", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Contact>) => req<Contact>(`/contacts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateStatus: (id: string, lead_status: string) => req<Contact>(`/contacts/${id}/status`, { method: "PUT", body: JSON.stringify({ lead_status }) }),
  assign: (id: string, assigned_to: string | null) => req<Contact>(`/contacts/${id}/assign`, { method: "PUT", body: JSON.stringify({ assigned_to }) }),
  delete: (id: string) => req(`/contacts/${id}`, { method: "DELETE" }),
};

// ── Deals ──

export const deals = {
  list: (params: { page?: number; limit?: number; search?: string; stage?: string; company_id?: string; contact_id?: string; assigned_to?: string } = {}) =>
    req<Paginated<Deal>>(`/deals${qs(params)}`),
  get: (id: string) => req<Deal>(`/deals/${id}`),
  create: (data: Partial<Deal>) => req<Deal>("/deals", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Deal>) => req<Deal>(`/deals/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateStage: (id: string, stage: string) => req<Deal>(`/deals/${id}/stage`, { method: "PUT", body: JSON.stringify({ stage }) }),
  assign: (id: string, assigned_to: string | null) => req<Deal>(`/deals/${id}/assign`, { method: "PUT", body: JSON.stringify({ assigned_to }) }),
  delete: (id: string) => req(`/deals/${id}`, { method: "DELETE" }),
};

// ── Activities ──

export const activities = {
  list: (params: { page?: number; limit?: number; contact_id?: string; company_id?: string; deal_id?: string; type?: string } = {}) =>
    req<Paginated<Activity>>(`/activities${qs(params)}`),
  create: (data: Partial<Activity>) => req<Activity>("/activities", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Activity>) => req<Activity>(`/activities/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => req(`/activities/${id}`, { method: "DELETE" }),
};

// ── Custom Fields ──

export const customFields = {
  list: (entity_type?: string) => req<CustomField[]>(`/custom-fields${qs({ entity_type })}`),
  create: (data: Partial<CustomField>) => req<CustomField>("/custom-fields", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<CustomField>) => req<CustomField>(`/custom-fields/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => req(`/custom-fields/${id}`, { method: "DELETE" }),
};

// ── Stats ──

export const stats = {
  get: () => req<CrmStats>("/stats"),
};

// ── Pipeline stages ──

export interface PipelineStage {
  id?: string;
  stage_key: string;
  stage_label: string;
  sort_order: number;
}

export const pipelines = {
  get: (pipeline: "lead" | "deal") => req<PipelineStage[]>(`/pipelines/${pipeline}`),
  save: (pipeline: "lead" | "deal", stages: PipelineStage[]) =>
    req<PipelineStage[]>(`/pipelines/${pipeline}`, { method: "PUT", body: JSON.stringify({ stages }) }),
};

// Defaults (used as fallback before API loads)
export const DEFAULT_LEAD_STAGES: PipelineStage[] = [
  { stage_key: "new", stage_label: "New", sort_order: 0 },
  { stage_key: "contacted", stage_label: "Contacted", sort_order: 1 },
  { stage_key: "qualified", stage_label: "Qualified", sort_order: 2 },
  { stage_key: "converted", stage_label: "Converted", sort_order: 3 },
  { stage_key: "lost", stage_label: "Lost", sort_order: 4 },
];

export const DEFAULT_DEAL_STAGES: PipelineStage[] = [
  { stage_key: "lead", stage_label: "Lead", sort_order: 0 },
  { stage_key: "qualified", stage_label: "Qualified", sort_order: 1 },
  { stage_key: "proposal", stage_label: "Proposal", sort_order: 2 },
  { stage_key: "negotiation", stage_label: "Negotiation", sort_order: 3 },
  { stage_key: "won", stage_label: "Won", sort_order: 4 },
  { stage_key: "lost", stage_label: "Lost", sort_order: 5 },
];
