/**
 * Admin API client — super-admin endpoints for org management.
 * Uses admin JWT (from POST /api/v1/admin/auth), NOT org JWT.
 */

const PBX_BASE = "/api/pbx";

let _adminToken: string | null = null;

export function setAdminToken(token: string) {
  _adminToken = token;
  if (typeof window !== "undefined") localStorage.setItem("admin_jwt", token);
}

export function getAdminToken(): string {
  if (_adminToken) return _adminToken;
  if (typeof window !== "undefined") {
    _adminToken = localStorage.getItem("admin_jwt");
  }
  return _adminToken || "";
}

export function clearAdminToken() {
  _adminToken = null;
  if (typeof window !== "undefined") localStorage.removeItem("admin_jwt");
}

async function adminRequest<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${PBX_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) throw new Error("Admin session expired. Please re-login.");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Industry compliance presets
export const INDUSTRY_PRESETS: Record<string, {
  recording_consent: string;
  retention_cdr_days: number;
  retention_recording_days: number;
  pii_masking: boolean;
}> = {
  hotel: {
    recording_consent: "announcement",
    retention_cdr_days: 365,
    retention_recording_days: 180,
    pii_masking: false,
  },
  hospital: {
    recording_consent: "explicit_opt_in",
    retention_cdr_days: 1825,
    retention_recording_days: 1095,
    pii_masking: true,
  },
  general: {
    recording_consent: "announcement",
    retention_cdr_days: 365,
    retention_recording_days: 365,
    pii_masking: false,
  },
};

export interface OrgCreatePayload {
  name: string;
  industry?: string;
  contact_info?: { email?: string; phone?: string; address?: string };
  settings?: Record<string, unknown>;
  limits?: Record<string, unknown>;
}

export interface OrgListItem {
  id: string;
  name: string;
  context_prefix: string;
  api_key: string;
  status: string;
  createdAt: string;
}

export interface OrgCreateResult {
  id: string;
  name: string;
  api_key: string;
  api_secret: string;
  context_prefix: string;
}

// Admin auth
export const adminAuth = {
  login: (username: string, password: string) =>
    adminRequest<{ token: string }>("/admin/auth", {
      method: "POST",
      body: JSON.stringify({ admin_username: username, admin_password: password }),
    }),
};

// Admin org management
export const adminOrgs = {
  list: () => adminRequest<OrgListItem[]>("/admin/organizations"),

  create: (payload: OrgCreatePayload & { admin_username: string; admin_password: string }) =>
    adminRequest<OrgCreateResult>("/organizations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  get: (id: string) => adminRequest<Record<string, unknown>>(`/organizations/${id}`),

  update: (id: string, data: Record<string, unknown>) =>
    adminRequest<Record<string, unknown>>(`/organizations/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getCredentials: (id: string) =>
    adminRequest<{ api_key: string; api_secret_plaintext: string }>(`/admin/organizations/${id}/credentials`),
};

// Admin global settings
export const adminSettings = {
  get: () => adminRequest<Record<string, unknown>>("/admin/settings"),
  update: (data: Record<string, unknown>) =>
    adminRequest<Record<string, unknown>>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deploy: () =>
    adminRequest<Record<string, unknown>>("/admin/settings/deploy", { method: "POST" }),
};
