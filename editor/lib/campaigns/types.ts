// Shared types for the Campaigns feature. Mirrors api/src/models/Campaign*.

export type TemplateStatus = "draft" | "published" | "archived";
export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "archived";
export type LeadStatus =
  | "raw"
  | "contacted"
  | "engaged"
  | "interested"
  | "qualified"
  | "disqualified"
  | "dnc";
export type ActionType = "whatsapp" | "call";

export interface WorkflowAction {
  id: string;
  type: ActionType;
  template?: string | null; // whatsapp template name (MSG91)
  namespace?: string | null; // MSG91 template namespace (auto-filled by picker)
  script?: string | null; // pipecat bot id for calls
  callerId?: string | null;
  // Words that classify an inbound WhatsApp reply as "interested" (run halts).
  // If empty/absent, any reply → "engaged" (run continues).
  interest_keywords?: string[];
  // Free-form per-channel options; render-only.
  options?: Record<string, unknown>;
}

export interface WorkflowDay {
  id: string;
  gap: number; // days to wait after previous day
  actions: WorkflowAction[];
}

export interface Workflow {
  meta?: { name?: string; version?: number };
  days: WorkflowDay[];
}

export interface CampaignTemplate {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: TemplateStatus;
  version: number;
  workflow: Workflow;
  created_by: string | null;
  createdAt: string;
  updatedAt: string;
  // Populated by GET /templates list endpoint; absent on single-fetch.
  campaign_count?: number;
}

export interface Campaign {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  template_id: string | null;
  template_snapshot: Workflow | null;
  owner_user_id: string | null;
  status: CampaignStatus;
  start_at: string | null;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  avg_call_seconds: number;
  stats: {
    contacted?: number;
    engaged?: number;
    interested?: number;
    qualified?: number;
    total?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type ThrottleState = "healthy" | "throttled" | "backoff";

export interface Paginated<T> {
  data: T[];
  total: number;
  // `filtered` = rows matching the current where; `total` = unfiltered.
  // Optional for legacy endpoints; PR 4 endpoints (`/leads`, `/leads`)
  // always set it. Use `filtered ?? total` when reading.
  filtered?: number;
  page: number;
  pages: number;
  pageSize?: number;
}

// PR 4: per-campaign dashboard summary returned by GET /:id/dashboard
export interface DashboardSummary {
  campaign: import("./types").Campaign;
  funnel: {
    contacted: number;
    engaged: number;
    interested: number;
    qualified: number;
  };
  stats: Record<string, number>;
  leadCounts: Record<LeadStatus, number>;
  totalLeads: number;
  recentEvents: import("./types").CampaignEvent[];
}

// PR 4: GET /:id/leads/:leadId/transcript/:eventId
export interface TranscriptMessage {
  t: string;
  speaker: "agent" | "customer";
  text: string;
  signal?: string;
}
export interface TranscriptPayload {
  ready: boolean;
  eventId?: string;
  kind?: string;
  createdAt?: string;
  durationLabel?: string;
  direction?: "outbound" | "inbound";
  qualificationLine?: string;
  recordingUrl?: string;
  recording_url?: string;
  recordingPath?: string;
  recording_path?: string;
  signals?: string[];
  messages?: TranscriptMessage[];
  summary?: string;
  message?: string; // when ready=false
}

export interface CampaignLead {
  id: string;
  org_id: string;
  campaign_id: string;
  name: string;
  phone: string;
  country: string | null;
  business: string | null;
  source: "csv" | "webform" | "api" | "manual";
  status: LeadStatus;
  custom_fields: Record<string, unknown>;
  intent_score: number;
  last_touch_at: string | null;
  current_node_id: string | null;
  crm_contact_id: string | null;
  enrolled_at: string | null;
  // Run-level execution state, flattened from the lead's CampaignLeadRun.
  // Drives the drawer's Pause/Resume button. Null when the lead has no run.
  run_status?: LeadRunStatus | null;
  run_paused_at?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LeadRunStatus =
  | "pending"
  | "queued"
  | "waiting"
  | "halted"
  | "completed"
  | "failed"
  | "paused";

export type EventKind =
  | "enrolled"
  | "whatsapp_sent"
  | "whatsapp_delivered"
  | "whatsapp_replied"
  | "call_started"
  | "call_completed"
  | "call_failed"
  | "call_interested"
  | "call_engaged"
  | "status_changed"
  | "qualified"
  | "disqualified"
  | "halted"
  | "approval_created"
  | "approval_decided";

export interface CampaignEvent {
  id: string;
  org_id: string;
  campaign_id: string;
  campaign_lead_id: string;
  kind: EventKind;
  node_id: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface CampaignApproval {
  id: string;
  org_id: string;
  campaign_id: string;
  campaign_lead_id: string;
  channel: "whatsapp" | "call";
  node_id: string | null;
  draft: string | null;
  reasoning: string | null;
  context: Record<string, unknown> | null;
  sla_at: string | null;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LeadFieldType =
  | "text"
  | "number"
  | "select"
  | "multi"
  | "date"
  | "datetime"
  | "phone"
  | "email"
  | "url"
  | "boolean"
  | "currency"
  | "identifier";

export interface CampaignLeadField {
  id: string;
  org_id: string;
  label: string;
  type: LeadFieldType;
  description: string | null;
  options: string[] | null;
  required: boolean;
  is_system: boolean;
  is_deleted: boolean;
  sort_order: number;
  createdAt: string;
  updatedAt: string;
}

// Async CSV import jobs — backend table `campaign_import_jobs`.
// The GETs exclude `file_path` from responses; do not add it here.
export type ImportJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ImportJobMode = "skip_duplicates" | "upsert" | "fail_on_conflict";

export interface CampaignImportJobError {
  row: number;
  message: string;
}

export interface CampaignImportJob {
  id: string;
  org_id: string;
  campaign_id: string;
  status: ImportJobStatus;
  mode: ImportJobMode;
  original_filename: string | null;
  file_size_bytes: number | null;
  column_mapping: Record<string, string>;
  total_rows: number | null;
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  error_count: number;
  errors: CampaignImportJobError[] | null;
  last_error: string | null;
  queue_job_id: string | null;
  created_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  createdAt: string;
  updatedAt: string;
}

// Return shape of POST /:id/leads/import-async
export interface CreateImportResponse {
  jobId: string;
  status: ImportJobStatus;
  message: string;
}
