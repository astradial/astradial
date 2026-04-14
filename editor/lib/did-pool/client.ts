import { handleUnauthorized } from "@/lib/auth/authStore";

const BASE = "/api/pbx/did-pool";

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  const t = typeof window !== "undefined" ? localStorage.getItem("pbx_org_token") || "" : "";
  const k = typeof window !== "undefined" ? localStorage.getItem("pbx_api_key") || "" : "";
  if (t) h["Authorization"] = `Bearer ${t}`;
  else if (k) h["X-API-Key"] = k;
  return h;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: headers() });
  if (res.status === 401) { handleUnauthorized("did-pool 401"); throw new Error("Session expired"); }
  if (!res.ok) { const b = await res.json().catch(() => ({ error: res.statusText })); throw new Error(b.error || b.message || res.statusText); }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export interface PoolDid {
  id: string;
  number: string;
  description: string | null;
  region: string | null;
  provider: string | null;
  monthly_price: number | null;
  pool_status: "available" | "pending" | "assigned" | "reserved";
  org_id: string | null;
  trunk_id: string | null;
  routing_type: string | null;
  routing_destination: string | null;
  recording_enabled: boolean;
  status: string;
  requested_by_org: string | null;
  requested_at: string | null;
  createdAt: string;
  organization?: { id: string; name: string } | null;
  trunk?: { id: string; name: string } | null;
}

export interface MyDidsResponse {
  assigned: PoolDid[];
  pending: PoolDid[];
}

export interface AdminDidsResponse {
  dids: PoolDid[];
  counts: { available: number; pending: number; assigned: number; reserved: number; total: number };
}

// ── Org-facing ──

export const didPool = {
  available: () => req<PoolDid[]>("/available"),
  request: (id: string) => req<{ message: string; did: PoolDid }>(`/${id}/request`, { method: "POST" }),
  cancelRequest: (id: string) => req<{ message: string }>(`/${id}/cancel-request`, { method: "POST" }),
  my: () => req<MyDidsResponse>("/my"),
};

// ── Admin-facing ──

export const didAdmin = {
  all: (params?: { pool_status?: string; org_id?: string }) => {
    const p = new URLSearchParams();
    if (params?.pool_status) p.set("pool_status", params.pool_status);
    if (params?.org_id) p.set("org_id", params.org_id);
    const qs = p.toString();
    return req<AdminDidsResponse>(`/admin/all${qs ? `?${qs}` : ""}`);
  },
  bulkAdd: (data: { numbers: string[]; provider?: string; region?: string; monthly_price?: number; trunk_id?: string }) =>
    req<{ created: number; skipped: number; skipped_numbers: string[] }>("/admin/bulk", { method: "POST", body: JSON.stringify(data) }),
  approve: (id: string) => req<{ message: string; did: PoolDid }>(`/admin/${id}/approve`, { method: "POST" }),
  reject: (id: string) => req<{ message: string }>(`/admin/${id}/reject`, { method: "POST" }),
  assign: (id: string, org_id: string) => req<{ message: string; did: PoolDid }>(`/admin/${id}/assign`, { method: "POST", body: JSON.stringify({ org_id }) }),
  release: (id: string) => req<{ message: string }>(`/admin/${id}/release`, { method: "POST" }),
  update: (id: string, data: Partial<PoolDid>) => req<PoolDid>(`/admin/${id}`, { method: "PUT", body: JSON.stringify(data) }),
};
