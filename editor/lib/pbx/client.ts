import { handleUnauthorized } from "@/lib/auth/authStore";

const BASE = "/api/pbx";

let _orgToken = "";
let _apiKey = "";

export function setOrgToken(token: string) {
  _orgToken = token;
  if (typeof window !== "undefined") localStorage.setItem("pbx_org_token", token);
}

export function getOrgToken(): string {
  if (_orgToken) return _orgToken;
  if (typeof window !== "undefined") _orgToken = localStorage.getItem("pbx_org_token") || "";
  return _orgToken;
}

export function setApiKey(key: string) {
  _apiKey = key;
  if (typeof window !== "undefined") localStorage.setItem("pbx_api_key", key);
}

export function getApiKey(): string {
  if (_apiKey) return _apiKey;
  if (typeof window !== "undefined") _apiKey = localStorage.getItem("pbx_api_key") || "";
  return _apiKey;
}

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  const token = getOrgToken();
  const key = getApiKey();
  if (token) h["Authorization"] = `Bearer ${token}`;
  else if (key) h["X-API-Key"] = key;
  return h;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: headers() });
  // 401: PBX JWT expired or invalid — sign out, clear state, redirect to login
  if (res.status === 401) {
    handleUnauthorized("pbx 401 on " + path);
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  // 204 No Content (e.g. DELETE endpoints) has no body — calling .json() throws
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ─── Types ───

export interface PbxOrg {
  id: string;
  name: string;
  context_prefix: string;
  api_key: string;
  status: string;
  settings: Record<string, unknown> | null;
  limits: Record<string, unknown> | null;
  contact_info: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PbxUser {
  id: string;
  org_id: string;
  username: string;
  email: string;
  extension: string;
  full_name: string | null;
  role: "admin" | "supervisor" | "agent" | "user";
  status: "active" | "inactive";
  sip_password: string;
  asterisk_endpoint: string;
  recording_enabled: boolean;
  routing_type: "sip" | "ai_agent";
  routing_destination: string | null;
  phone_number: string | null;
  ring_target: "ext" | "phone";
  createdAt: string;
}

export interface PbxDid {
  id: string;
  org_id: string;
  trunk_id: string;
  number: string;
  description: string;
  routing_type: "extension" | "queue" | "ivr" | "ai_agent" | "intercom" | "external";
  routing_destination: string;
  status: "active" | "inactive";
  recording_enabled: boolean;
  call_limit: number;
  createdAt: string;
}

export interface PbxTrunk {
  id: string;
  org_id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  transport: "udp" | "tcp" | "tls";
  trunk_type: "inbound" | "outbound" | "peer2peer";
  max_channels: number;
  status: "active" | "inactive" | "maintenance";
  registration_status: string;
  createdAt: string;
}

export interface QueueMember {
  id: string;
  queue_id: string;
  user_id: string;
  penalty: number;
  paused: boolean;
  user?: { id: string; full_name: string; extension: string };
}

export interface PbxQueue {
  id: string;
  org_id: string;
  name: string;
  number: string;
  strategy: string;
  timeout: number;
  max_wait_time: number;
  music_on_hold: string;
  greeting_id: string | null;
  status: "active" | "inactive" | "paused";
  members?: QueueMember[];
  createdAt: string;
}

export interface MohOrgClass {
  class: string;
  moh_class_name: string;
  file_count: number;
  files: { filename: string; size: number; uploaded_at: string }[];
}

export interface MohListResponse {
  org_classes: MohOrgClass[];
  system_classes: string[];
}

export interface Greeting {
  id: string;
  org_id: string;
  name: string;
  text: string;
  language: string;
  voice: string;
  audio_file: string | null;
  status: "active" | "inactive";
  createdAt: string;
}

export interface LiveCall {
  channel_id: string;
  uniqueid: string;
  from: string;
  from_name: string;
  to: string;
  to_name: string;
  status: string;
  duration: number;
  context: string;
  application: string;
}

export interface ActiveCall {
  channel_id: string;
  call_id: string;
  from_number: string;
  to_number: string;
  caller_id_name: string;
  direction: string;
  status: string;
  duration: number;
  started_at: string;
  answered_at: string;
  agent: string;
}

// ─── Auth ───

export const auth = {
  login: (apiKey: string, apiSecret: string) =>
    request<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
    }),
};

// ─── Organizations ───

export const orgs = {
  list: () => request<PbxOrg[]>("/organizations"),
  get: (id: string) => request<PbxOrg>(`/organizations/${id}`),
  create: (data: { name: string; contact_info?: Record<string, unknown> }) =>
    request<PbxOrg>("/organizations", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<PbxOrg>) =>
    request<PbxOrg>(`/organizations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request(`/organizations/${id}`, { method: "DELETE" }),
};

// ─── Users ───

export const users = {
  list: () => request<PbxUser[]>("/users"),
  get: (id: string) => request<PbxUser>(`/users/${id}`),
  create: (data: Partial<PbxUser> & { password: string }) =>
    request<PbxUser>("/users", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<PbxUser>) =>
    request<PbxUser>(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateRouting: (id: string, data: { routing_type: string; routing_destination?: string; ring_target?: string; phone_number?: string }) =>
    request<PbxUser>(`/users/${id}/routing`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request(`/users/${id}`, { method: "DELETE" }),
};

// ─── DIDs ───

export const dids = {
  list: () => request<PbxDid[]>("/dids"),
  get: (id: string) => request<PbxDid>(`/dids/${id}`),
  create: (data: Partial<PbxDid>) =>
    request<PbxDid>("/dids", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<PbxDid>) =>
    request<PbxDid>(`/dids/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  updateRouting: (id: string, data: { routing_type: string; routing_destination: string }) =>
    request<PbxDid>(`/dids/${id}/routing`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request(`/dids/${id}`, { method: "DELETE" }),
};

// ─── Trunks ───

export const trunks = {
  list: () => request<PbxTrunk[]>("/trunks"),
  get: (id: string) => request<PbxTrunk>(`/trunks/${id}`),
  create: (data: Partial<PbxTrunk>) =>
    request<PbxTrunk>("/trunks", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<PbxTrunk>) =>
    request<PbxTrunk>(`/trunks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request(`/trunks/${id}`, { method: "DELETE" }),
};

// ─── Queues ───

export const queues = {
  list: () => request<PbxQueue[]>("/queues"),
  get: (id: string) => request<PbxQueue>(`/queues/${id}`),
  create: (data: Partial<PbxQueue>) =>
    request<PbxQueue>("/queues", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<PbxQueue>) =>
    request<PbxQueue>(`/queues/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request(`/queues/${id}`, { method: "DELETE" }),
  addMembers: (id: string, userIds: string[]) =>
    request(`/queues/${id}/members`, { method: "POST", body: JSON.stringify({ user_ids: userIds }) }),
  removeMember: (queueId: string, userId: string) =>
    request(`/queues/${queueId}/members?userId=${userId}`, { method: "DELETE" }),
};

// ─── Music on Hold ───

export const moh = {
  list: () => request<MohListResponse>("/moh"),
  upload: async (formData: FormData) => {
    const h: Record<string, string> = {};
    const token = getOrgToken();
    const key = getApiKey();
    if (token) h["Authorization"] = `Bearer ${token}`;
    else if (key) h["X-API-Key"] = key;
    const res = await fetch(`${BASE}/moh/upload`, { method: "POST", headers: h, body: formData });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  },
  delete: (className: string, filename: string) =>
    request(`/moh/${className}/${filename}`, { method: "DELETE" }),
  assignToQueue: (queueId: string, className: string) =>
    request(`/queues/${queueId}/moh`, { method: "PUT", body: JSON.stringify({ music_on_hold: className }) }),
};

// ─── Ticket WhatsApp Config ───

export interface TicketWAStatusConfig {
  enabled: boolean;
  workflow_id?: string;
  template_name: string;
  template_language: string;
  variable_mapping: Record<string, string>;
}

export interface TicketWhatsAppConfig {
  enabled: boolean;
  sender_number: string;
  statuses: {
    open: TicketWAStatusConfig;
    in_progress: TicketWAStatusConfig;
    closed: TicketWAStatusConfig;
  };
}

const defaultTicketWAConfig: TicketWhatsAppConfig = {
  enabled: false, sender_number: "",
  statuses: {
    open: { enabled: false, template_name: "", template_language: "en", variable_mapping: {} },
    in_progress: { enabled: false, template_name: "", template_language: "en", variable_mapping: {} },
    closed: { enabled: false, template_name: "", template_language: "en", variable_mapping: {} },
  },
};

export const ticketWhatsapp = {
  getConfig: () => request<TicketWhatsAppConfig>("/settings/ticket-whatsapp").catch(() => defaultTicketWAConfig),
  setConfig: (data: TicketWhatsAppConfig) =>
    request<TicketWhatsAppConfig>("/settings/ticket-whatsapp", { method: "PUT", body: JSON.stringify(data) }),
};

// ─── Greetings (TTS) ───

export const greetingsApi = {
  list: () => request<Greeting[]>("/greetings"),
  get: (id: string) => request<Greeting>(`/greetings/${id}`),
  create: (data: { name: string; text: string; language?: string; voice?: string }) =>
    request<Greeting>("/greetings", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; text: string; language: string; voice: string; status: string }>) =>
    request<Greeting>(`/greetings/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request(`/greetings/${id}`, { method: "DELETE" }),
};

// ─── Calls ───

export const clickToCall = {
  initiate: (data: { from: string; from_type?: string; to: string; to_type?: string; caller_id?: string }) =>
    request<{ status: string; call_id?: string }>("/calls/click-to-call", { method: "POST", body: JSON.stringify(data) }),
};

export interface CallHistoryItem {
  id: string;
  org_id: string;
  call_id: string;
  from_number: string;
  to_number: string;
  direction: string;
  status: string;
  /** Total call time including ring (seconds). Rarely useful in the UI — use `talk_time`. */
  duration: number;
  /** Actual talk time in seconds (billsec). Matches the audio recording length. */
  talk_time: number;
  started_at: string;
  ended_at: string | null;
  recording_file: string | null;
  recording_url: string | null;
  linkedid?: string;
}

export interface CallJourney {
  linkedid: string;
  caller: string;
  destination: string;
  status: string;
  total_duration: number;
  answered_by: string | null;
  steps: { time: string; action: string; from: string; to: string; extension: string; duration: number; billsec: number; status: string; channel: string; recording: string | null }[];
}

export const calls = {
  live: async (): Promise<Record<string, unknown>[]> => {
    const res = await request<{ count: number; calls: Record<string, unknown>[] }>("/calls/live");
    return res.calls || [];
  },
  history: (params: { direction?: string; page?: number; limit?: number } = {}) =>
    request<{ items: CallHistoryItem[]; total: number; page: number; pages: number; hasMore: boolean }>(
      `/calls/history?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()}`
    ),
  journey: (linkedId: string) => request<CallJourney>(`/calls/${linkedId}/journey`),
  count: async () => {
    const res = await request<{ count: number } | number>("/calls/count");
    return typeof res === "number" ? { count: res } : res;
  },
  stats: () => request<{
    weekly: { date: string; inbound: number; outbound: number }[];
    totals: { total_calls: number; inbound: number; outbound: number; answered: number; missed: number; avg_duration: number };
  }>("/calls/stats"),
  // Call actions via PBX API
  transfer: (channelId: string, destination: string, destinationType = "extension") =>
    request(`/calls/transfer`, {
      method: "POST",
      body: JSON.stringify({ channel_id: channelId, destination, destination_type: destinationType }),
    }),
  hangup: (channelId: string) =>
    request(`/calls/hangup-channel`, {
      method: "POST",
      body: JSON.stringify({ channel_id: channelId }),
    }),
  hold: (channelId: string) =>
    request(`/calls/${encodeURIComponent(channelId)}/hold`, { method: "POST" }),
  unhold: (channelId: string) =>
    request(`/calls/${encodeURIComponent(channelId)}/unhold`, { method: "POST" }),
  // Monitoring via gateway proxy
  monitor: (channelId: string, supervisorExtension: string, type: "spy" | "whisper" | "barge" = "spy") => {
    const gwHeaders: HeadersInit = { "Content-Type": "application/json" };
    const adminKey = typeof window !== "undefined" ? localStorage.getItem("gateway_admin_key") || "" : "";
    if (adminKey) gwHeaders["Authorization"] = `Bearer ${adminKey}`;
    return fetch(`/api/gateway/admin/calls/monitor`, {
      method: "POST",
      headers: gwHeaders,
      body: JSON.stringify({ channel_id: channelId, supervisor_extension: supervisorExtension, type }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      return r.json();
    });
  },
  stopMonitor: (channelId: string) => {
    const gwHeaders: HeadersInit = { "Content-Type": "application/json" };
    const adminKey = typeof window !== "undefined" ? localStorage.getItem("gateway_admin_key") || "" : "";
    if (adminKey) gwHeaders["Authorization"] = `Bearer ${adminKey}`;
    return fetch(`/api/gateway/admin/calls/monitor_stop`, {
      method: "POST",
      headers: gwHeaders,
      body: JSON.stringify({ channel_id: channelId }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      return r.json();
    });
  },
};

// ─── Config ───

export const config = {
  deploy: () => request("/config/deploy", { method: "POST" }),
  reload: () => request("/config/reload", { method: "POST" }),
  verify: () => request("/config/verify"),
};
