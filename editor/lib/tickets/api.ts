/**
 * MariaDB-backed tickets client — drop-in replacement for the
 * Firestore module's `getTicketsPage`, `createTicket`,
 * `updateTicketStatus`, `restoreTicket`. Same function signatures
 * so the existing tickets page swaps imports without restructuring.
 *
 * Wire-format compatibility: the rich form fields the previous UI
 * collected (`category`, `summary`, `details`, `guest_name`,
 * `room_number`, etc.) live inside MariaDB's `notes` column as
 * JSON. Read paths parse them out and merge them into the
 * `Ticket` shape the UI already expects; write paths re-serialise.
 * Lets us keep the entire editor UI as-is while the storage moves.
 *
 * SSE subscription: `subscribeToTickets(orgId, onRefresh)` opens
 * one EventSource per dashboard load. Returns an unsubscribe fn.
 */
// Auth for tickets/api goes through `pbx_org_token` localStorage (set by
// the unified auth provider in `@/lib/auth`). No Firebase dependency.

const BASE = "/api/pbx";

function getOrgToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("pbx_org_token") || "";
}

function authHeaders(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = getOrgToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// Ticket as seen by the editor. Superset of MariaDB columns + the
// legacy "rich form" fields that used to live as separate Firestore
// keys. Anything past `tags` is recovered from `notes` JSON.
export interface Ticket {
  // MariaDB columns
  id: string;
  org_id?: string;
  caller_number: string;
  caller_name?: string | null;
  source?: "missed_call" | "queue_timeout" | "bot_dropped" | "manual";
  priority: string;
  status: string;
  missed_count?: number;
  last_call_id?: string | null;
  last_call_at?: string | null;
  closed_at?: string | null;
  archived_at?: string | null;
  assignee_user_id?: string | null;
  notes?: string | null;
  tags?: unknown;
  created_at: string;
  updated_at?: string;

  // Legacy UI fields — parsed from `notes` JSON if present
  channel_id?: string;
  category?: string;
  summary?: string;
  details?: string;
  guest_name?: string;
  room_number?: string;
  recording_url?: string;
  call_duration?: number;
  custom_fields?: Record<string, string>;
  created_by?: string;
  remarks?: string;
  archived?: boolean;
}

function parseNotes(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    // Legacy plain-text notes — preserve under `details` so the UI
    // still shows them somewhere instead of dropping them silently.
    return { details: String(raw) };
  }
}

function toTicket(row: Record<string, unknown>): Ticket {
  const legacy = parseNotes(row.notes as string | null);
  return {
    id: String(row.id),
    org_id: row.org_id as string | undefined,
    caller_number: String(row.caller_number || ""),
    caller_name: (row.caller_name as string | null) ?? null,
    source: row.source as Ticket["source"],
    priority: String(row.priority || "normal"),
    status: String(row.status || "open"),
    missed_count: row.missed_count as number | undefined,
    last_call_id: row.last_call_id as string | null,
    last_call_at: row.last_call_at as string | null,
    closed_at: row.closed_at as string | null,
    archived_at: row.archived_at as string | null,
    assignee_user_id: row.assignee_user_id as string | null,
    notes: row.notes as string | null,
    tags: row.tags,
    created_at: String(row.created_at),
    updated_at: row.updated_at as string | undefined,
    // Legacy form fields recovered from notes JSON
    channel_id: legacy.channel_id as string | undefined,
    category: legacy.category as string | undefined,
    summary: legacy.summary as string | undefined,
    details: legacy.details as string | undefined,
    guest_name: legacy.guest_name as string | undefined,
    room_number: legacy.room_number as string | undefined,
    recording_url: legacy.recording_url as string | undefined,
    call_duration: legacy.call_duration as number | undefined,
    custom_fields: legacy.custom_fields as Record<string, string> | undefined,
    created_by: legacy.created_by as string | undefined,
    remarks: legacy.remarks as string | undefined,
    archived: (row.status as string) === "archived",
  };
}

// ─── Read ───

export interface TicketsPageOpts {
  archived?: boolean;
  status?: string;
  source?: string;
  date?: string;
  pageSize?: number;
  cursor?: unknown;  // unused in API mode — offset is server-side
}

export interface PaginatedResult<T> {
  items: T[];
  lastDoc: number | null;  // next-offset; kept named lastDoc for caller compat
  hasMore: boolean;
  /**
   * Org-scoped status counts surfaced for the header strip on the
   * tickets page. Excludes `archived` (the API doesn't include it in
   * `status_counts`). Empty object if the server didn't send the
   * field (old API build).
   */
  statusCounts?: { open: number; in_progress: number; closed: number };
}

/**
 * Append-only call event recorded against a ticket. Populated by the
 * call-logs-driven scheduler. Used by the expandable timeline panel
 * on the tickets page.
 */
export interface TicketCallEvent {
  id: string;
  ticket_id: string;
  org_id: string;
  linkedid: string;
  occurred_at: string;
  kind: "missed" | "bot_dropped" | "outbound_attempt";
  meta?: {
    duration?: number;
    billsec?: number;
    disposition?: string | null;
    lastapp?: string | null;
    dstchannel?: string | null;
  } | null;
  created_at: string;
}

/**
 * Paginated list. Internally offset-based against MariaDB, but the
 * caller still uses the cursor-stack pattern from the Firestore
 * version — we just store offsets in there instead of Firestore
 * document snapshots.
 */
export async function getTicketsPage(
  orgId: string,
  opts: TicketsPageOpts = {}
): Promise<PaginatedResult<Ticket>> {
  const pageSize = opts.pageSize ?? 25;
  const offset = typeof opts.cursor === "number" ? (opts.cursor as number) : 0;

  // Map UI tab/filter conventions to API query.
  // - Archived tab → status=archived
  // - Active tab + explicit status filter → that status
  // - Active tab + status=all → server defaults to 'open,in_progress' which
  //   matches "active". To include 'closed' on the Active tab when an
  //   operator hasn't archived yet, send the all-active status set.
  const qs = new URLSearchParams();
  qs.set("limit", String(pageSize));
  qs.set("offset", String(offset));
  if (opts.archived === true) {
    qs.set("status", "archived");
  } else if (opts.status && opts.status !== "all") {
    qs.set("status", opts.status);
  } else {
    qs.set("status", "open,in_progress,closed");
  }
  if (opts.source && opts.source !== "all") {
    // API doesn't filter by source v1 — apply client-side post-fetch
    // (cheap at 25 rows/page). Send the param so future API support
    // is wire-compatible.
    qs.set("source", opts.source);
  }
  // Date filter (active tab only — same semantic as Firestore version).
  if (opts.date && opts.archived !== true) qs.set("date", opts.date);

  const res = await fetch(`${BASE}/tickets?${qs.toString()}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const body = await res.json();
  let items: Ticket[] = (body.data || []).map((row: Record<string, unknown>) => toTicket(row));
  if (opts.source && opts.source !== "all") {
    items = items.filter((t: Ticket) => t.source === opts.source);
  }
  const total = Number(body.total || 0);
  const nextOffset = offset + items.length;
  const sc = body.status_counts as Partial<Record<string, number>> | undefined;
  return {
    items,
    lastDoc: nextOffset < total ? nextOffset : null,
    hasMore: nextOffset < total,
    statusCounts: sc ? {
      open:         Number(sc.open || 0),
      in_progress:  Number(sc.in_progress || 0),
      closed:       Number(sc.closed || 0),
    } : undefined,
  };
}

/**
 * Fetch the call-event timeline for one ticket. Used by the
 * expandable timeline panel — UI fires this on row expand so the
 * list view itself stays slim.
 */
export async function getTicketEvents(
  orgId: string,
  ticketId: string,
): Promise<TicketCallEvent[]> {
  void orgId;
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(ticketId)}/events`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const body = await res.json();
  return (body.data || []) as TicketCallEvent[];
}

// ─── Mutations ───

interface CreateTicketInput {
  caller_number: string;
  category?: string;
  summary?: string;
  details?: string;
  priority?: string;
  guest_name?: string;
  room_number?: string;
  source?: string;
  created_by?: string;
  notes?: string;
  channel_id?: string;
  recording_url?: string;
}

export async function createTicket(orgId: string, data: CreateTicketInput): Promise<Ticket> {
  // Stuff the rich form fields into `notes` JSON so MariaDB doesn't
  // need a column per. `details` already exists for free-text; the
  // hotel-specific fields ride along.
  const richNotes: Record<string, unknown> = {};
  const asRecord = data as unknown as Record<string, unknown>;
  for (const k of ["channel_id", "category", "summary", "details", "guest_name", "room_number", "recording_url", "created_by"] as const) {
    const v = asRecord[k];
    if (v !== undefined && v !== "") richNotes[k] = v;
  }
  const payload = {
    caller_number: data.caller_number,
    caller_name: data.guest_name || undefined,
    priority: data.priority || "normal",
    notes: Object.keys(richNotes).length > 0 ? JSON.stringify(richNotes) : (data.notes || null),
  };
  const res = await fetch(`${BASE}/tickets`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const body = await res.json();
  return toTicket(body.data);
}

/**
 * Update a ticket's status (plus optional `remarks` string the
 * operator typed in the close-confirmation dialog). The remarks
 * ride in the MariaDB `notes` JSON under a `remarks` key so the
 * UI can render them back on read without a separate column.
 *
 * Signature kept compatible with the legacy Firestore version so
 * the calling page doesn't have to change.
 */
export async function updateTicketStatus(
  orgId: string,
  ticketId: string,
  status: string,
  remarks?: string
): Promise<void> {
  const body: Record<string, unknown> = { status };
  if (remarks && remarks.trim()) {
    // Merge remarks into existing notes JSON (best-effort — server
    // overwrites the column on PATCH so we can't read-modify-write
    // here without a round-trip. Acceptable: in practice operators
    // only type remarks at close time once.)
    body.notes = JSON.stringify({ remarks: remarks.trim() });
  }
  const res = await fetch(`${BASE}/tickets/${ticketId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
}

export async function restoreTicket(orgId: string, ticketId: string): Promise<void> {
  // From archived back to open. closed_at also cleared by API when
  // status moves away from 'closed'.
  const res = await fetch(`${BASE}/tickets/${ticketId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ status: "open" }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
}

// ─── SSE live-update subscription ───

/**
 * Open an EventSource against the tickets stream. Calls `onRefresh`
 * whenever the server signals a write occurred (any ticket touched
 * for this org). Caller refetches the visible page on refresh.
 *
 * Returns an unsubscribe function. Closes the connection cleanly
 * + does NOT auto-reconnect — the editor remounts the page on
 * org-switch which re-creates the subscription naturally.
 *
 * EventSource doesn't support custom headers, so the API
 * authenticates via the `?token=` query param fallback (same
 * pattern the recording playback URLs already use).
 */
export function subscribeToTickets(
  orgId: string,
  onRefresh: () => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const token = getOrgToken();
  if (!token) return () => {};
  const url = `${BASE}/tickets/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url, { withCredentials: false });
  es.addEventListener("refresh", () => onRefresh());
  // Server also emits a one-time 'open' event on connect; ignore it.
  return () => { try { es.close(); } catch { /* */ } };
}

// ─── Compatibility no-ops ───
// The Firestore module exposed these; they're now server-side
// (lazy sweep runs on every GET). Keep stubs so the page doesn't
// have to drop the calls during the swap.

export async function triggerAutoArchive(orgId: string): Promise<void> {
  // Sweep runs server-side on the next list call — nothing to do here.
  void orgId;
}

// ─── Open-ticket count badge ───

/**
 * Fetch the count of open tickets for an org. One-shot — pair with
 * `subscribeToTickets` if you want it kept live.
 */
export async function getOpenTicketCount(orgId: string): Promise<number> {
  void orgId;  // server resolves org from auth
  const res = await fetch(`${BASE}/tickets?status=open&limit=1&offset=0`, { headers: authHeaders() });
  if (!res.ok) return 0;
  const body = await res.json();
  return Number(body.total || 0);
}

/**
 * Live open-ticket count — drives the sidebar badge + dashboard
 * "Open Tickets" card. Fetches once on mount, then re-fetches on
 * every SSE `refresh` event. `onChange(count)` fires whenever the
 * value changes (debounced by the network round-trip; tens of
 * milliseconds in practice).
 *
 * Returns an unsubscribe fn. Connection cleanup happens both on
 * unmount and when the page is hidden long enough that browsers
 * drop the EventSource.
 */
export function subscribeToOpenTicketCount(
  orgId: string,
  onChange: (count: number) => void
): () => void {
  let cancelled = false;
  async function refetch() {
    try {
      const n = await getOpenTicketCount(orgId);
      if (!cancelled) onChange(n);
    } catch { /* leave previous value on transient errors */ }
  }
  refetch();
  const unsubscribe = subscribeToTickets(orgId, () => { refetch(); });
  return () => { cancelled = true; unsubscribe(); };
}
