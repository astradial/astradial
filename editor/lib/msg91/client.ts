import { getOrgToken, getApiKey } from "@/lib/pbx/client";

const PBX_BASE = "/api/pbx";

function pbxHeaders(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  const token = getOrgToken();
  const key = getApiKey();
  if (token) h["Authorization"] = `Bearer ${token}`;
  else if (key) h["X-API-Key"] = key;
  return h;
}

export interface Msg91Config {
  configured: boolean;
  authkey_masked: string;
}

export interface Msg91Number {
  id?: string;
  number?: string;
  quality_rating?: string;
  status?: string;
  [key: string]: unknown;
}

export interface Msg91Template {
  name?: string;
  status?: string;
  language?: string;
  components?: unknown[];
  [key: string]: unknown;
}

export const msg91 = {
  // Config (stored in AstraPBX org settings)
  getConfig: async (): Promise<Msg91Config> => {
    const res = await fetch(`${PBX_BASE}/settings/msg91`, { headers: pbxHeaders() });
    if (!res.ok) return { configured: false, authkey_masked: "" };
    return res.json();
  },

  setConfig: async (authkey: string): Promise<Msg91Config> => {
    const res = await fetch(`${PBX_BASE}/settings/msg91`, {
      method: "PUT", headers: pbxHeaders(), body: JSON.stringify({ authkey }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // Numbers (via server-side proxy)
  getNumbers: async (orgId: string): Promise<Msg91Number[]> => {
    const res = await fetch(`/api/msg91/numbers?org_id=${orgId}`);
    const data = await res.json();
    // MSG91 returns { status, data: [{ integrated_number: "..." }] }
    const arr = data.data || data || [];
    return Array.isArray(arr) ? arr : [];
  },

  // Templates (via server-side proxy)
  getTemplates: async (orgId: string, number: string): Promise<Msg91Template[]> => {
    const res = await fetch(`/api/msg91/templates/${number}?org_id=${orgId}`);
    const data = await res.json();
    // MSG91 returns { status, data: [{ name, languages: [{ status, language, variables }] }] }
    const arr = data.data || data || [];
    return Array.isArray(arr) ? arr : [];
  },

  // Send message (via server-side proxy)
  send: async (orgId: string, payload: unknown): Promise<unknown> => {
    const res = await fetch("/api/msg91/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_id: orgId, payload }),
    });
    return res.json();
  },

  // Logs (via server-side proxy)
  getLogs: async (orgId: string, startDate: string, endDate: string): Promise<unknown> => {
    const res = await fetch("/api/msg91/logs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_id: orgId, startDate, endDate }),
    });
    return res.json();
  },
};
