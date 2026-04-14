const GATEWAY_BASE = "/api/gateway";
const PROXY_BASE = "/api/gateway-proxy";

let _adminKey = "";

export function setAdminKey(key: string) {
  _adminKey = key;
  if (typeof window !== "undefined") {
    localStorage.setItem("gateway_admin_key", key);
  }
}

export function getAdminKey(): string {
  if (_adminKey) return _adminKey;
  if (typeof window !== "undefined") {
    _adminKey = localStorage.getItem("gateway_admin_key") || "";
  }
  return _adminKey;
}

function headers(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAdminKey()}`,
  };
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const adminKey = getAdminKey();
  // Use direct gateway if admin key exists, otherwise proxy via server-side API
  const base = adminKey ? GATEWAY_BASE : PROXY_BASE;
  // Admin key uses /api/gateway/admin/..., proxy uses /api/gateway-proxy/... (proxy adds /admin/ prefix)
  const fullPath = adminKey ? path : path.replace(/^\/admin/, "");
  const res = await fetch(`${base}${fullPath}`, { ...opts, headers: adminKey ? headers() : { "Content-Type": "application/json" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

// ─── Types ───

export interface Org {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  key?: string; // only on creation
  key_prefix: string;
  label: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface Bot {
  id: string;
  org_id: string;
  name: string;
  module_path: string;
  flow_json: Record<string, unknown> | null;
  gemini_model: string;
  gemini_voice_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  extension: string | null;
}

// ─── Orgs (read-only from AstraPBX) ───

export const orgs = {
  list: () => request<Org[]>("/admin/orgs"),
  get: (id: string) => request<Org>(`/admin/orgs/${id}`),
  getCredentials: (id: string) => request<{ api_key: string; api_secret: string }>(`/admin/orgs/${id}/credentials`),
};

// ─── Org Config (pipecat-owned settings) ───

export interface OrgConfig {
  org_id: string;
  google_api_key: string;
}

export const orgConfig = {
  get: (orgId: string) => request<OrgConfig>(`/admin/orgs/${orgId}/config`).catch(() => null),
  set: (orgId: string, data: { google_api_key: string }) =>
    request<OrgConfig>(`/admin/orgs/${orgId}/config`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// ─── Keys ───

export const keys = {
  list: (orgId: string) => request<ApiKey[]>(`/admin/orgs/${orgId}/keys`),
  create: (orgId: string, label = "") =>
    request<ApiKey>(`/admin/orgs/${orgId}/keys`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  revoke: (orgId: string, keyId: string) =>
    request(`/admin/orgs/${orgId}/keys/${keyId}`, { method: "DELETE" }),
};

// ─── Bots ───

export const bots = {
  list: (orgId: string) => request<Bot[]>(`/admin/orgs/${orgId}/bots`),
  get: (orgId: string, botId: string) =>
    request<Bot>(`/admin/orgs/${orgId}/bots/${botId}`),
  create: (orgId: string, data: { name: string; flow_json?: Record<string, unknown>; module_path?: string; gemini_model?: string; gemini_voice_id?: string }) =>
    request<Bot>(`/admin/orgs/${orgId}/bots`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (orgId: string, botId: string, data: Partial<{ name: string; flow_json: Record<string, unknown>; module_path: string; gemini_model: string; gemini_voice_id: string; is_active: boolean }>) =>
    request<Bot>(`/admin/orgs/${orgId}/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (orgId: string, botId: string) =>
    request(`/admin/orgs/${orgId}/bots/${botId}`, { method: "DELETE" }),
  logStreamUrl: async (orgId: string, botId: string): Promise<string> => {
    const adminKey = getAdminKey();
    if (adminKey) {
      return `${GATEWAY_BASE}/admin/logs/${botId}/stream?token=${adminKey}`;
    }
    // Org login: fetch token from server-side API
    try {
      const res = await fetch("/api/auth/stream-token");
      if (res.ok) {
        const { token } = await res.json();
        return `${GATEWAY_BASE}/admin/logs/${botId}/stream?token=${token}`;
      }
    } catch {}
    return `${GATEWAY_BASE}/admin/logs/${botId}/stream`;
  },
};
