import { handleUnauthorized, getJwtExpiryMs } from "@/lib/auth/authStore";

const BASE = "/api/pbx";

let _orgToken = "";
let _apiKey = "";

export function setOrgToken(token: string) {
  _orgToken = token;
  if (typeof window !== "undefined") {
    localStorage.setItem("pbx_org_token", token);
    // Persist the token's exp claim so AuthExpiryWatcher can schedule a
    // proactive logout without needing to decode on every render.
    const exp = getJwtExpiryMs(token);
    if (exp) localStorage.setItem("pbx_org_token_exp", String(exp));
    else localStorage.removeItem("pbx_org_token_exp");
  }
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
  outbound_did: string | null;
  // Failover routing — null means no failover, primary fail goes
  // straight to the "person at extension N is not available" announce.
  // Same-org constraint enforced server-side.
  failover_destination_user_id: string | null;
  // External phone number (E.164-ish "+91XXXXXXXXXX") to ring as
  // failover instead of a SIP user. Mutually exclusive with
  // failover_destination_user_id — server returns 400 if both set.
  failover_phone_number?: string | null;
  failover_timeout_seconds: number;
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
  password?: string;
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
  ring_timeout_seconds: number;
  user?: { id: string; full_name: string; extension: string; status?: "active" | "inactive" | "invited" | "suspended" };
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
  // TTS model family used to generate `audio_file`. Resolved
  // server-side via TTSService.MODELS. NULL on legacy rows; treat
  // null/undefined as 'chirp3-hd'.
  tts_model?: string;
  // Style prompt — only meaningful when tts_model is a Gemini family
  // (gemini-flash / gemini-pro). NULL otherwise.
  style_instructions?: string | null;
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

/**
 * Live PJSIP registration state for a user. Populated by the backend's
 * `pjsipRegistrationsService` which shells `pjsip show contacts` and joins
 * the result with the DB user list. Cached server-side for 30s.
 *
 * - registered: true iff status is "reachable" or "nonqual" (a registered
 *   contact exists, regardless of qualify state). False if the user is
 *   not present in Asterisk's contact table.
 * - status:
 *   - "reachable"     — registered + qualify OK
 *   - "nonqual"       — registered but qualify pending / RTT unknown
 *                       (typical NAT-keepalive gap; phone is registered
 *                       but Asterisk hasn't completed an OPTIONS ping)
 *   - "unreachable"   — registered but qualify failed (phone disconnected)
 *   - "unregistered"  — no contact in Asterisk's table (authoritative)
 *   - "unknown"       — Asterisk was unreachable; we have NO information
 *                       about this user's state (distinct from
 *                       "unregistered" so the UI doesn't mislead operators
 *                       during an Asterisk outage)
 */
export interface PbxUserRegistration {
  user_id: string;
  extension: string;
  asterisk_endpoint: string;
  registered: boolean;
  status: "reachable" | "unreachable" | "nonqual" | "unregistered" | "unknown";
  contact_ip: string | null;
  contact_port: number | null;
  rtt_ms: number | null;
  last_check_at: string;
}

export interface PbxUserRegistrationsResponse {
  registrations: PbxUserRegistration[];
  fetched_at: string;
  from_cache: boolean;
  count: number;
  // True if the underlying Asterisk CLI call failed — the registrations
  // array still contains one row per user but all statuses are "unknown".
  // Editor renders a degraded-state banner so the operator knows the dots
  // they're looking at are NOT authoritative.
  asterisk_unreachable: boolean;
  asterisk_error: string | null;
}

export const users = {
  list: () => request<PbxUser[]>("/users"),
  get: (id: string) => request<PbxUser>(`/users/${id}`),
  registrations: (opts: { force?: boolean } = {}) =>
    request<PbxUserRegistrationsResponse>(
      `/users/registrations${opts.force ? "?force=1" : ""}`,
    ),
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

// ─── Customer Tunnels (WireGuard) ───

export interface PbxCustomerTunnel {
  id: string;
  org_id: string;
  name: string;
  tunnel_subnet: string;
  cloud_tunnel_ip: string;
  customer_tunnel_ip: string;
  customer_lan_cidr: string | null;
  customer_pubkey: string;
  persistent_keepalive: number;
  listen_port: number;
  interface_name: string;
  status: "active" | "disabled" | "revoked";
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PbxCustomerTunnelStatus {
  alive: boolean;
  present_in_wg: boolean;
  handshake_age_seconds: number | null;
  latest_handshake_at: string | null;
  endpoint_ip: string | null;
  endpoint_port: number | null;
  bytes_received: number;
  bytes_sent: number;
  allowed_ips: string[];
}

export interface PbxCustomerTunnelMetric {
  snapshot_at: string;
  latest_handshake_at: string | null;
  endpoint_ip: string | null;
  endpoint_port: number | null;
  bytes_received: number;
  bytes_sent: number;
  peer_count_total: number;
}

export interface PbxCustomerTunnelConfig {
  tunnel_id: string;
  customer_peer_config: string;
  cloud_public_key: string;
  cloud_endpoint: string;
  cloud_tunnel_ip: string;
  customer_tunnel_ip: string;
}

export interface PbxCustomerTunnelMetricsResponse {
  tunnel_id: string;
  from: string;
  to: string;
  count: number;
  metrics: PbxCustomerTunnelMetric[];
}

// Server-side route-sync result included in POST/PATCH/DELETE responses
// when the underlying applyWg1Config touched the kernel routing table.
// Errors are non-fatal but operator-visible — see PR #148 review.
export interface PbxApplyRouteSync {
  added: string[];
  removed: string[];
  unchanged: string[];
  errors: string[];
}
export interface PbxApplyResult {
  peer_count: number;
  backup_path?: string | null;
  route_sync: PbxApplyRouteSync | null;
}

export const customerTunnels = {
  list: () => request<{ tunnels: PbxCustomerTunnel[]; count: number }>("/customer-tunnels"),
  get: (id: string) => request<{ tunnel: PbxCustomerTunnel }>(`/customer-tunnels/${id}`),
  create: (data: { name: string; customer_pubkey: string; customer_lan_cidr?: string; notes?: string }) =>
    request<{ tunnel: PbxCustomerTunnel; apply: PbxApplyResult; warnings?: string[] }>("/customer-tunnels", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: { status?: PbxCustomerTunnel["status"]; notes?: string; customer_lan_cidr?: string | null },
  ) =>
    request<{ tunnel: PbxCustomerTunnel; apply: PbxApplyResult | null; warnings?: string[] }>(
      `/customer-tunnels/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
    ),
  revoke: (id: string) =>
    request<{
      tunnel: PbxCustomerTunnel;
      message: string;
      apply: PbxApplyResult | null;
      warnings?: string[];
    }>(`/customer-tunnels/${id}`, {
      method: "DELETE",
    }),
  customerConfig: (id: string) =>
    request<PbxCustomerTunnelConfig>(`/customer-tunnels/${id}/customer-config`),
  status: (id: string) =>
    request<{ tunnel_id: string; status: PbxCustomerTunnelStatus }>(`/customer-tunnels/${id}/status`),
  metrics: (id: string, opts: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.from) qs.set("from", opts.from);
    if (opts.to) qs.set("to", opts.to);
    const tail = qs.toString() ? `?${qs.toString()}` : "";
    return request<PbxCustomerTunnelMetricsResponse>(`/customer-tunnels/${id}/metrics${tail}`);
  },
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
  // Add a single member to a queue. The API takes one user_id at a time
  // (it returns the created member row so the UI can react to penalty /
  // ring_timeout). ring_timeout_seconds is optional — server defaults to 20.
  addMember: (
    queueId: string,
    userId: string,
    opts?: { penalty?: number; ring_timeout_seconds?: number }
  ) =>
    request(`/queues/${queueId}/members`, {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        penalty: opts?.penalty,
        ring_timeout_seconds: opts?.ring_timeout_seconds,
      }),
    }),
  // Update an existing member's penalty (priority) and/or ring time.
  // Either or both fields may be sent.
  updateMember: (
    queueId: string,
    userId: string,
    updates: { penalty?: number; ring_timeout_seconds?: number }
  ) =>
    request(`/queues/${queueId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),
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
  importSystemFile: (filename: string) =>
    request<{ moh_class_name: string; filename: string }>("/moh/import-system-file", { method: "POST", body: JSON.stringify({ filename }) }),
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

// ─── Ticket Alerts (daily WhatsApp missed-call summary) ───

export interface TicketAlertSubscriber {
  id: string;
  org_id: string;
  country_code: string;
  phone: string;
  name: string;
  full_number: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketAlertsView {
  enabled: boolean;
  subscribers: TicketAlertSubscriber[];
}

export const ticketAlerts = {
  get: (orgId: string) =>
    request<TicketAlertsView>(`/orgs/${orgId}/ticket-alerts`),
  setEnabled: (orgId: string, enabled: boolean) =>
    request<{ enabled: boolean }>(`/orgs/${orgId}/ticket-alerts`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  addSubscriber: (orgId: string, body: { phone: string; name: string }) =>
    request<TicketAlertSubscriber>(`/orgs/${orgId}/ticket-alerts/subscribers`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  removeSubscriber: (orgId: string, subscriberId: string) =>
    request<void>(`/orgs/${orgId}/ticket-alerts/subscribers/${subscriberId}`, {
      method: "DELETE",
    }),
};

// ─── Admin: Astradial-internal MSG91 WhatsApp account ───

export interface AdminWhatsappConfig {
  integrated_number: string | null;
  namespace: string | null;
  selected_template_name: string | null;
  template_language: string;
  is_ready_for_send: boolean;
  auth_key_present: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface Msg91Template {
  name: string;
  status?: string;
  language?: string;
  category?: string;
  namespace?: string;
}

// Admin WhatsApp calls go through editor server-side proxy routes at
// /api/admin/whatsapp/* (NOT /api/pbx/...) so the browser presents
// gateway_admin_key and the editor swaps to INTERNAL_API_KEY before
// hitting PBX. Same auth-laundering pattern as other /api/admin/*
// editor routes.
async function adminRequest<T>(editorPath: string, opts: RequestInit = {}): Promise<T> {
  const key = typeof window !== "undefined" ? localStorage.getItem("gateway_admin_key") || "" : "";
  const res = await fetch(editorPath, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export const adminWhatsapp = {
  getConfig: () => adminRequest<AdminWhatsappConfig>("/api/admin/whatsapp"),
  setConfig: (patch: Partial<Pick<AdminWhatsappConfig, "integrated_number" | "namespace" | "selected_template_name" | "template_language">>) =>
    adminRequest<AdminWhatsappConfig>("/api/admin/whatsapp", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  listTemplates: () =>
    adminRequest<{ count: number; templates: Msg91Template[] }>("/api/admin/whatsapp/templates"),
  testSend: (body: { phone: string; sample_subscriber_name?: string; sample_count?: number; sample_org_name?: string }) =>
    adminRequest<{ ok: boolean; msg91_response: unknown }>("/api/admin/whatsapp/test-send", {
      method: "POST",
      body: JSON.stringify(body),
    }),
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

// ─── TTS voices (Google Cloud languages + voices) ───

export interface TtsVoiceGroup {
  language: string;
  label: string;
  voices: string[];
}

// One entry per TTS model exposed in the dropdown. Returned by
// GET /tts/models. The editor uses this to drive the Model picker,
// gate the style-instructions textarea, and filter the voice list
// for the selected (model, language) combo.
export interface TtsModel {
  id: string;             // 'chirp3-hd' | 'gemini-flash' | 'gemini-pro'
  label: string;          // Operator-facing label
  description: string;
  supportsStyleInstructions: boolean;
  // language code → voice names supported under this model
  voicesByLanguage: Record<string, string[]>;
}

export interface TtsModelsResponse {
  models: TtsModel[];
  defaultModel: string;
}

export const tts = {
  voices: () => request<TtsVoiceGroup[]>("/tts/voices"),
  models: () => request<TtsModelsResponse>("/tts/models"),
  // One-shot preview — returns a Blob of audio/wav. No persistence.
  // style_instructions is OPTIONAL and only meaningful when model is
  // a Gemini family; backend returns 400 if sent with chirp3-hd.
  preview: async (data: {
    text: string;
    language: string;
    voice: string;
    model?: string;
    style_instructions?: string;
  }): Promise<Blob> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const token = getOrgToken();
    const key = getApiKey();
    if (token) h["Authorization"] = `Bearer ${token}`;
    else if (key) h["X-API-Key"] = key;
    const res = await fetch(`${BASE}/tts/preview`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      handleUnauthorized("tts preview 401");
      throw new Error("Session expired");
    }
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.blob();
  },
};

// ─── IVR ───

export type IvrActionType =
  | "extension"
  | "queue"
  | "ivr"
  | "voicemail"
  | "hangup"
  | "callback"
  | "ai_agent";

export interface IvrMenuOption {
  id?: string;
  ivr_id?: string;
  digit: string;
  action_type: IvrActionType;
  action_destination: string | null;
  description: string | null;
  order: number;
}

export interface Ivr {
  id: string;
  org_id: string;
  name: string;
  extension: string;
  description: string | null;
  greeting_prompt: string | null;
  greeting_text: string | null;
  greeting_language: string;
  greeting_voice: string;
  // TTS model family used for the IVR greeting. NULL on legacy rows;
  // treat null/undefined as 'chirp3-hd'.
  tts_model?: string;
  // Style prompt — Gemini models only.
  style_instructions?: string | null;
  timeout: number;
  max_retries: number;
  invalid_prompt: string | null;
  timeout_prompt: string | null;
  enable_direct_dial: boolean;
  // No-keypress timeout routing. 'retry' (default) preserves legacy
  // replay-greeting-then-hangup. 'queue'/'extension' route immediately
  // to timeout_destination on first WaitExten timeout. 'hangup' skips
  // retries and ends the call with the timeout prompt.
  timeout_action?: "retry" | "queue" | "extension" | "hangup";
  timeout_destination?: string | null;
  status: "active" | "inactive";
  menuOptions?: IvrMenuOption[];
  createdAt?: string;
  updatedAt?: string;
}

export const ivrs = {
  list: () => request<Ivr[]>("/ivrs"),
  get: (id: string) => request<Ivr>(`/ivrs/${id}`),
  create: (data: Partial<Ivr>) =>
    request<Ivr>("/ivrs", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Ivr>) =>
    request<Ivr>(`/ivrs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => request(`/ivrs/${id}`, { method: "DELETE" }),
  saveMenu: (id: string, options: IvrMenuOption[]) =>
    request<Ivr>(`/ivrs/${id}/menu`, {
      method: "PUT",
      body: JSON.stringify({ options }),
    }),
  generateGreeting: (
    id: string,
    data: {
      text: string;
      language?: string;
      voice?: string;
      tts_model?: string;
      style_instructions?: string | null;
    }
  ) =>
    request<{
      success: boolean;
      greeting_prompt: string;
      language: string;
      voice: string;
      tts_model: string;
      style_instructions: string | null;
    }>(`/ivrs/${id}/generate-greeting`, { method: "POST", body: JSON.stringify(data) }),
  publish: (id: string) =>
    request<{ success: boolean; message: string }>(`/ivrs/${id}/publish`, { method: "POST" }),
};

// ─── Calls ───

export const clickToCall = {
  initiate: (data: { from: string; from_type?: string; to: string; to_type?: string; caller_id?: string }) =>
    request<{ status: string; call_id?: string }>("/calls/click-to-call", { method: "POST", body: JSON.stringify(data) }),
};

// Lookup payload for resolving raw numbers to contact names in call
// logs. Server returns one object per org with users / queues / DIDs;
// the client builds maps keyed by phone/extension/number for O(1)
// resolution while rendering rows.
export interface CallContactsMap {
  users: Array<{
    id: string;
    full_name: string | null;
    username: string;
    extension: string;
    phone_number: string | null;
    ring_target: "ext" | "phone";
    routing_type: "sip" | "ai_agent";
    failover_phone_number?: string | null;
    status: "active" | "inactive";
  }>;
  queues: Array<{
    id: string;
    name: string;
    number: string;
    strategy: string;
    status: "active" | "inactive" | "paused";
  }>;
  dids: Array<{
    id: string;
    number: string;
    description: string | null;
    routing_type: string;
  }>;
}

export interface CallHistoryItem {
  id: string | number;
  accountcode?: string;
  call_id: string;
  from_number: string;
  to_number: string;
  direction: string;
  status?: string;
  /** Raw CDR disposition from Asterisk: ANSWERED / NO ANSWER / BUSY / FAILED / CONGESTION */
  disposition: string;
  /** Total call time including ring (seconds). Rarely useful in the UI — use `talk_time`. */
  duration: number;
  /** Actual talk time in seconds (billsec). Matches the audio recording length. */
  talk_time: number;
  /** Ring time before pickup (duration - billsec) */
  wait_time?: number;
  started_at: string;
  ended_at: string | null;
  recording_file?: string | null;
  recording_url: string | null;
  linkedid?: string;

  // Enriched fields from /api/v1/calls (dispatcher-derived)
  caller_id?: string | null;
  /** Which extension rang (for inbound + queue calls) */
  rang_extension?: string | null;
  /** Who actually answered: human / queue / prompt / other */
  answered_type?: string | null;
  /** Extension of the agent that took the call */
  answered_by?: string | null;
  /** Display name for queue (e.g. "5003" or the queue label) */
  queue_name_display?: string | null;
  queue_wait_time?: number | null;
  /** Asterisk hangup cause code (string in response) */
  hangup_cause?: string | null;
  /** Human-readable hangup reason ("Normal Clearing", "User Busy", "No Circuit Available") */
  hangup_reason?: string | null;
  /** Who initiated the hangup: caller / callee / timeout / system / normal */
  disconnected_by?: string | null;
  dcontext?: string | null;
  channel?: string | null;
  dstchannel?: string | null;
}

/** UI-derived effective status, computed from CDR disposition + talk_time + answered_type. */
export type EffectiveCallStatus = "completed" | "missed" | "abandoned" | "ai_handled" | "busy" | "failed";

/** Compute a human-friendly outcome for the Call Logs table. Raw CDR disposition
 * ("ANSWERED") is misleading for calls that entered a queue but no agent picked
 * up (the channel was Answer()ed for MOH playback yet nobody actually spoke).
 *
 * `opts.orgHasAiAgent` is a hard gate: if the org has zero users with
 * routing_type='ai_agent' and no AI-handoff routes, we NEVER emit
 * 'ai_handled' regardless of what the CDR row looks like. This is the
 * V7-Hotels safety net — even if some future CDR oddity leaks through
 * the backend's narrowing, an org without AI agents cannot have an
 * "AI Handled" call. Default true preserves existing call-site
 * behavior for callers that haven't yet been updated. */
export function effectiveCallStatus(
  c: Pick<CallHistoryItem, "disposition" | "talk_time" | "answered_type" | "direction" | "dcontext">,
  opts: { orgHasAiAgent?: boolean } = {}
): EffectiveCallStatus {
  const orgHasAiAgent = opts.orgHasAiAgent !== false;
  const status = (c.disposition || "").toUpperCase();
  if (status === "BUSY") return "busy";
  if (status === "FAILED" || status === "CONGESTION") return "failed";
  // AI-driven calls — bot answered programmatically.
  //
  // `answered_type === "prompt"` is now narrow: the backend SQL only
  // assigns it when the channel hit Stasis() (real AI agent handled
  // the call). Previously this label was applied to ANY ANSWERED
  // call with an empty dstchannel, which incorrectly captured the
  // dialplan-Playback path (caller heard "the person at extension
  // N is not available" after a failed Dial) and made non-AI orgs
  // like V7 Hotels show "AI Handled" on every missed internal call.
  //
  // The new `answered_type === "dialplan"` value covers that other
  // case and is handled below: the dialplan answered the channel
  // briefly to play a system message, but nobody actually picked up,
  // so semantically it's a missed call.
  if (orgHasAiAgent && (c.answered_type === "prompt" || c.dcontext === "ai-outbound" || c.direction === "outbound" && c.answered_type === "queue" && (c.talk_time || 0) === 0)) return "ai_handled";
  if (status === "NO ANSWER") return "missed";
  // ANSWERED + human talk time > 0 → truly completed
  if (status === "ANSWERED") {
    // Dialplan-only "answer" (Playback after failed Dial, system
    // announce, etc.) — no human ever picked up. Surface as missed
    // so operators see what really happened.
    if (c.answered_type === "dialplan") return "missed";
    if ((c.talk_time || 0) >= 1 && c.answered_type === "human") return "completed";
    if ((c.talk_time || 0) >= 1) return "completed";
    // ANSWERED with zero talk_time = queue Answer() but no pickup
    return "abandoned";
  }
  return "missed";
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
  history: async (params: {
    direction?: string;
    disposition?: string;
    from?: string;
    to?: string;
    date_from?: string;
    date_to?: string;
    search?: string;
    page?: number;
    limit?: number;
  } = {}) => {
    const limit = params.limit ?? 20;
    const page = params.page ?? 1;
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    qs.set("offset", String((page - 1) * limit));
    for (const k of ["direction", "disposition", "from", "to", "date_from", "date_to", "search"] as const) {
      const v = (params as Record<string, string | undefined>)[k];
      if (v) qs.set(k, v);
    }
    const res = await request<{ data: CallHistoryItem[]; pagination: { total: number; limit: number; offset: number; has_more: boolean } }>(`/calls?${qs.toString()}`);
    const total = res.pagination?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / limit));
    return {
      items: res.data,
      total,
      page,
      pages,
      hasMore: res.pagination?.has_more ?? false,
    };
  },
  journey: (linkedId: string) => request<CallJourney>(`/calls/${linkedId}/journey`),
  // Lookup data the call-logs page uses to resolve raw phone/extension
  // numbers and queue numbers to human-readable names (phone-book
  // style display). Fetched once per dashboard load; resolver runs
  // entirely client-side.
  contactsMap: () => request<CallContactsMap>("/calls/contacts-map"),
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
