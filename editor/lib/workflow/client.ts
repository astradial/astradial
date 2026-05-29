import { handleUnauthorized } from "@/lib/auth/authStore";

const BASE = "/api/workflow";

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
  // 401: workflow-engine JWT expired or invalid — sign out, clear state, redirect to login
  if (res.status === 401) {
    handleUnauthorized("workflow 401 on " + path);
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export interface Workflow {
  id: string;
  org_id: string;
  name: string;
  description: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNode {
  id: string;
  type: string;
  data: { label: string; config: Record<string, unknown> };
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  trigger_data: Record<string, unknown>;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  steps: unknown[];
}

export const workflows = {
  list: (orgId: string) => request<Workflow[]>(`/workflows?org_id=${orgId}`),
  get: (id: string) => request<Workflow>(`/workflows/${id}`),
  create: (data: Partial<Workflow>) => request<Workflow>(`/workflows`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Workflow>) => request<Workflow>(`/workflows/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => request(`/workflows/${id}`, { method: "DELETE" }),
  execute: (id: string, triggerData: Record<string, unknown>) =>
    request<{ execution_id: string; status: string }>(`/workflows/${id}/execute`, { method: "POST", body: JSON.stringify({ trigger_data: triggerData }) }),
  executions: (id: string) => request<WorkflowExecution[]>(`/workflows/${id}/executions`),
};

export interface ApiKey {
  id: string;
  org_id: string;
  name: string;
  key: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export const apiKeys = {
  list: (orgId: string) => request<ApiKey[]>(`/api-keys?org_id=${orgId}`),
  create: (orgId: string, name: string) => request<ApiKey>(`/api-keys`, { method: "POST", body: JSON.stringify({ org_id: orgId, name }) }),
  update: (id: string, data: { name?: string; is_active?: boolean }) => request<ApiKey>(`/api-keys/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => request(`/api-keys/${id}`, { method: "DELETE" }),
};

export interface ScheduledJob {
  id: string;
  workflow_id: string;
  workflow_name: string;
  org_id: string;
  trigger_data: Record<string, unknown>;
  scheduled_at: string;
  repeat_until: string | null;
  repeat_interval: string | null;
  status: string;
  created_at: string;
}

export interface ScheduledJobsPage {
  jobs: ScheduledJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  activeCount: number;
}

export interface ScheduledJobsListOpts {
  status?: string;
  date?: string;   // YYYY-MM-DD, matched in IST
  page?: number;
  limit?: number;
}

export const scheduledJobs = {
  list: (orgId: string, opts: ScheduledJobsListOpts = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.date)   params.set("date",   opts.date);
    if (opts.page)   params.set("page",   String(opts.page));
    if (opts.limit)  params.set("limit",  String(opts.limit));
    const qs = params.toString();
    return request<ScheduledJobsPage>(`/orgs/${orgId}/scheduled-jobs${qs ? `?${qs}` : ""}`);
  },
  cancel: (id: string) =>
    request<{ status: string }>(`/scheduled-jobs/${id}`, { method: "DELETE" }),
};

export const automationConfig = {
  get: (orgId: string) => request<{ automation_channel_limit: number; current_automation_calls: number }>(`/orgs/${orgId}/automation-config`),
  update: (orgId: string, limit: number) => request(`/orgs/${orgId}/automation-config`, { method: "PUT", body: JSON.stringify({ automation_channel_limit: limit }) }),
};
