import {
  addDoc,
  collection,
  doc,
  type DocumentData,
  getDocs,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  startAfter,
  Timestamp,
  type Unsubscribe,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "./config";

// Root Firestore collection for all AstraPBX tenant data.
// Mirrors LogsUpdate's _astrapbx_coll(env) helper: when the build-time env
// var NEXT_PUBLIC_ASTRADIAL_ENV is "staging", every editor read/write goes
// to `astrapbx_stage` so the staging deployment never touches prod tenant
// documents. Any other value (empty, "prod", "production") keeps the
// existing `astrapbx` collection — fully backwards compatible with every
// prod build that doesn't set the var.
export const ASTRAPBX_ROOT =
  (process.env.NEXT_PUBLIC_ASTRADIAL_ENV || "").toLowerCase() === "staging"
    ? "astrapbx_stage"
    : "astrapbx";

export interface PaginatedResult<T> {
  items: T[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export interface CallLog {
  id: string;
  phone_number: string;
  duration: number;
  total_duration: number;
  recording_url: string;
  recording_file: string;
  disconnected_by: string;
  call_type: string;
  direction: string;
  timestamp: string;
  logged_at: unknown;
  source: string;
  destination: string;
  caller_id_name: string;
  disposition: string;
  channel: string;
  unique_id: string;
  answered_by: string;
  summary?: string;
  priority?: string;
  department?: string;
}

export interface Ticket {
  id: string;
  caller_number: string;
  channel_id: string;
  category: string;
  summary: string;
  details: string;
  guest_name: string;
  room_number: string;
  source?: "missed_call" | "bot" | "bot_dropped" | "queue_timeout" | "manual" | "workflow";
  recording_url?: string;
  call_duration?: number;
  custom_fields?: Record<string, string>;
  priority: string;
  status: string;
  created_at: unknown;
  updated_at?: unknown;
  created_by: string;
  remarks?: string;
}

// ─── Call Logs ───

export async function getCallLogs(
  orgId: string,
  options: {
    pageSize?: number;
    cursor?: QueryDocumentSnapshot<DocumentData> | null;
    direction?: string;
  } = {}
): Promise<PaginatedResult<CallLog>> {
  const { pageSize = 20, cursor = null, direction } = options;
  const ref = collection(db!, ASTRAPBX_ROOT, orgId, "call_logs");

  const constraints: QueryConstraint[] = [];
  if (direction) constraints.push(where("direction", "==", direction));
  constraints.push(orderBy("logged_at", "desc"), firestoreLimit(pageSize + 1));
  if (cursor) constraints.push(startAfter(cursor));

  const q = query(ref, ...constraints);
  const snap = await getDocs(q);

  const hasMore = snap.docs.length > pageSize;
  const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;

  return {
    items: docs.map((d) => ({ id: d.id, ...d.data() }) as CallLog),
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore,
  };
}

export function subscribeToCallLogs(
  orgId: string,
  callback: (logs: CallLog[]) => void,
  pageSize = 20
): Unsubscribe {
  const ref = collection(db!, ASTRAPBX_ROOT, orgId, "call_logs");
  const q = query(ref, orderBy("logged_at", "desc"), firestoreLimit(pageSize));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CallLog));
  });
}

// ─── Weekly Call Stats ───

export async function getWeeklyCallStats(
  orgId: string
): Promise<{ date: string; label: string; inbound: number; outbound: number }[]> {
  const ref = collection(db!, ASTRAPBX_ROOT, orgId, "call_logs");
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const q = query(
    ref,
    where("logged_at", ">=", Timestamp.fromDate(sevenDaysAgo)),
    orderBy("logged_at", "desc")
  );
  const snap = await getDocs(q);

  // Build day buckets for last 7 days
  const days: Record<string, { label: string; inbound: number; outbound: number }> = {};
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0]; // "2026-04-04"
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    days[key] = { label: dayNames[d.getDay()], inbound: 0, outbound: 0 };
  }

  snap.docs.forEach((doc) => {
    const data = doc.data();
    try {
      const loggedAt =
        data.logged_at?.toDate?.() || (data.timestamp ? new Date(data.timestamp) : null);
      if (!loggedAt) return;
      const key = loggedAt.toISOString().split("T")[0];
      if (days[key]) {
        if (data.direction === "inbound") days[key].inbound++;
        else days[key].outbound++;
      }
    } catch {
      /* skip */
    }
  });

  return Object.entries(days).map(([date, counts]) => ({ date, ...counts }));
}

// ─── Tickets ───

export async function getTickets(
  orgId: string,
  options: {
    pageSize?: number;
    cursor?: QueryDocumentSnapshot<DocumentData> | null;
    status?: string;
  } = {}
): Promise<PaginatedResult<Ticket>> {
  const { pageSize = 20, cursor = null, status } = options;
  const ref = collection(db!, ASTRAPBX_ROOT, orgId, "tickets");

  const constraints: QueryConstraint[] = [];
  if (status) constraints.push(where("status", "==", status));
  constraints.push(orderBy("created_at", "desc"), firestoreLimit(pageSize + 1));
  if (cursor) constraints.push(startAfter(cursor));

  const q = query(ref, ...constraints);
  const snap = await getDocs(q);

  const hasMore = snap.docs.length > pageSize;
  const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;

  return {
    items: docs.map((d) => ({ id: d.id, ...d.data() }) as Ticket),
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore,
  };
}

export function subscribeToTickets(
  orgId: string,
  callback: (tickets: Ticket[]) => void,
  pageSize = 20
): Unsubscribe {
  const ref = collection(db!, ASTRAPBX_ROOT, orgId, "tickets");
  const q = query(ref, orderBy("created_at", "desc"), firestoreLimit(pageSize));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Ticket));
  });
}

// ─── Ticket Updates ───

export async function updateTicketStatus(
  orgId: string,
  ticketId: string,
  status: "open" | "in_progress" | "closed",
  remarks?: string
): Promise<void> {
  const ref = doc(db!, ASTRAPBX_ROOT, orgId, "tickets", ticketId);
  const updates: Record<string, unknown> = {
    status,
    updated_at: Timestamp.now(),
  };
  if (remarks) {
    updates.remarks = remarks;
  }
  await updateDoc(ref, updates);
}

// ─── Paginated ticket reads (replaces real-time onSnapshot for the table) ───

export interface TicketsPageOpts {
  archived?: boolean; // default false (active tickets)
  status?: string; // open / in_progress / closed
  source?: string; // missed_call / bot / etc.
  date?: string; // YYYY-MM-DD (IST), filters created_at
  pageSize?: number; // default 25
  cursor?: QueryDocumentSnapshot<DocumentData> | null; // for next-page navigation
}

/**
 * One-shot paginated read for the Tickets table. Uses cursor-based pagination
 * (Firestore native, much faster than offset). Pass `cursor` from the previous
 * page's `lastDoc` to fetch the next page.
 *
 * Note: Firestore allows only ONE inequality field per query. We use `created_at`
 * as the inequality field for the date filter. Status / source / archived are
 * equality filters, which compose freely.
 */
export async function getTicketsPage(
  orgId: string,
  opts: TicketsPageOpts = {}
): Promise<PaginatedResult<Ticket>> {
  const pageSize = opts.pageSize ?? 25;
  const ref = collection(db!, ASTRAPBX_ROOT, orgId, "tickets");

  const constraints: QueryConstraint[] = [];

  // Two distinct query shapes for the two tabs:
  //
  //   ACTIVE tab (archived !== true):
  //     order by created_at desc, post-filter out any doc with archived==true.
  //     A "where archived != true" Firestore query isn't supported, and a
  //     composite index on (archived, created_at) would still be needed for
  //     "where archived == false". JS post-filter at 25/page is trivial.
  //
  //   ARCHIVED tab (archived === true):
  //     order by archived_at desc + range filter (archived_at > epoch).
  //     Both filter and order are on the SAME single field, so Firestore
  //     auto-indexes it — NO composite index required. The earlier
  //     "where archived == true + orderBy created_at" query DID need a
  //     composite index and silently failed when the index wasn't created,
  //     leaving stale Tickets-tab data on screen. This shape avoids that.
  if (opts.archived === true) {
    constraints.push(where("archived_at", ">", new Date(0)));
    constraints.push(orderBy("archived_at", "desc"));
  } else {
    constraints.push(orderBy("created_at", "desc"));
  }

  // Status / source filters compose freely with either base query above
  // (Firestore allows multiple equality filters without extra indexing).
  if (opts.status && opts.status !== "all") {
    constraints.push(where("status", "==", opts.status));
  }
  if (opts.source && opts.source !== "all") {
    constraints.push(where("source", "==", opts.source));
  }
  if (opts.date && opts.archived !== true) {
    // Date filter only meaningful on the active tab (created_at-based).
    // Skipped on Archived tab because it would conflict with the
    // archived_at inequality (Firestore allows only one inequality field).
    const start = new Date(`${opts.date}T00:00:00+05:30`);
    const end = new Date(`${opts.date}T00:00:00+05:30`);
    end.setDate(end.getDate() + 1);
    constraints.push(where("created_at", ">=", Timestamp.fromDate(start)));
    constraints.push(where("created_at", "<", Timestamp.fromDate(end)));
  }

  if (opts.cursor) constraints.push(startAfter(opts.cursor));
  // Fetch one extra to detect "hasMore" cheaply
  constraints.push(firestoreLimit(pageSize + 1));

  const snap = await getDocs(query(ref, ...constraints));
  let docs = snap.docs;
  const hasMore = docs.length > pageSize;
  if (hasMore) docs = docs.slice(0, pageSize);

  let items = docs.map((d) => ({ id: d.id, ...d.data() }) as Ticket);
  // Active-tab post-filter to hide any docs that ARE archived.
  if (opts.archived !== true) {
    items = items.filter((t) => (t as Ticket & { archived?: boolean }).archived !== true);
  }

  return {
    items,
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore,
  };
}

/**
 * Restore an archived ticket back to active state. Just clears the archived flag.
 */
export async function restoreTicket(orgId: string, ticketId: string): Promise<void> {
  const ref = doc(db!, ASTRAPBX_ROOT, orgId, "tickets", ticketId);
  await updateDoc(ref, {
    archived: false,
    archived_at: null,
  });
}

// ─── Auto-Ticket on Missed Calls ───

/**
 * Watch Firestore call logs for missed/dropped calls and auto-create tickets.
 *
 * Scenarios:
 * 1. Call not picked (NO ANSWER, inbound, not internal)
 * 2. Bot answered but caller dropped early (< 15s)
 * 3. Bot answered, full conversation, but NO ticket created by bot
 * 4. Queue timeout (NO ANSWER via queue context)
 *
 * Bot creates ticket → handled by bot webhook (source=bot). Not duplicated here.
 *
 * Dedup: if open ticket exists for same phone, appends call time to summary instead.
 */
export function watchMissedCalls(orgId: string): Unsubscribe {
  const ref = collection(db!, ASTRAPBX_ROOT, orgId, "call_logs");
  const q = query(ref, orderBy("logged_at", "desc"), firestoreLimit(10));
  const seen = new Set<string>();
  let isFirst = true;

  return onSnapshot(q, async (snap) => {
    if (isFirst) {
      snap.docs.forEach((d) => seen.add(d.id));
      isFirst = false;
      return;
    }

    for (const change of snap.docChanges()) {
      if (change.type !== "added" || seen.has(change.doc.id)) continue;
      seen.add(change.doc.id);
      const log = change.doc.data();

      // Skip internal and outbound calls
      const dir = (log.direction || "").toLowerCase();
      const callType = (log.call_type || "").toLowerCase();
      if (dir !== "inbound" || callType === "internal") continue;

      const disposition = (log.disposition || "").toUpperCase();
      const duration = log.duration || log.total_duration || 0;
      const phone = (log.source || log.phone_number || "").replace(/\D/g, "").slice(-10);
      if (!phone || phone.length < 7) continue;

      const callTime = log.timestamp || new Date().toISOString();
      let shouldCreate = false;
      let source: "missed_call" | "bot_dropped" | "queue_timeout" = "missed_call";
      let summary = "";
      let details = "";

      // Scenario 1: Call not picked at all
      if (disposition === "NO ANSWER") {
        shouldCreate = true;
        // Check if it was a queue call (destination contains queue number)
        const dest = (log.destination || "").toLowerCase();
        if (dest.includes("queue") || (log.answered_by || "").toLowerCase().includes("queue")) {
          source = "queue_timeout";
          summary = `Queue timeout — caller ${phone} waited but no agent answered`;
          details = `Caller waited in queue but no agent was available. Duration: ${duration}s.`;
        } else {
          source = "missed_call";
          summary = `Missed call from ${phone}`;
          details = `Inbound call was not answered. Duration: ${duration}s.`;
        }
      }
      // Scenario 2: Call answered — check if bot handled it without creating a ticket
      else if (disposition === "ANSWERED") {
        const answeredBy = (log.answered_by || "").trim();
        // Known bot extensions — calls to these are bot-handled
        const botExtensions = ["1003", "1012", "1013"];
        const isBotCall = !answeredBy || botExtensions.includes(answeredBy);

        // Only check for bot-handled calls — skip human-answered calls
        if (isBotCall) {
          const channelId = log.unique_id || log.channel || change.doc.id;
          const ticketRef = collection(db!, ASTRAPBX_ROOT, orgId, "tickets");
          const botTicketCheck = query(
            ticketRef,
            where("channel_id", "==", channelId),
            firestoreLimit(1)
          );
          // Wait for bot webhook to finish creating ticket (if it does)
          await new Promise((r) => setTimeout(r, 8000));
          const botTicketSnap = await getDocs(botTicketCheck);
          if (botTicketSnap.empty) {
            shouldCreate = true;
            source = "bot_dropped";
            summary = `Call ended without ticket (${duration}s) from ${phone}`;
            details = `Caller connected to bot for ${duration}s but no ticket was created. Needs callback.`;
          }
        }
        // Human-answered calls — no auto-ticket needed (agent handled it)
      }

      if (!shouldCreate) continue;

      try {
        // Dedup: check if open ticket exists for this phone
        const ticketRef = collection(db!, ASTRAPBX_ROOT, orgId, "tickets");
        const dupeCheck = query(
          ticketRef,
          where("caller_number", "==", phone),
          where("status", "==", "open"),
          firestoreLimit(1)
        );
        const dupeSnap = await getDocs(dupeCheck);

        if (!dupeSnap.empty) {
          // Ticket exists — append this call time to the summary so agent sees repeat calls
          const existingDoc = dupeSnap.docs[0];
          const existing = existingDoc.data();
          const updatedSummary = `${existing.summary || summary}\n↳ Also called at ${callTime}`;
          await updateDoc(doc(db!, ASTRAPBX_ROOT, orgId, "tickets", existingDoc.id), {
            summary: updatedSummary,
            priority: "urgent", // Escalate — caller called again
            updated_at: Timestamp.now(),
          });
          console.log(`Ticket updated for repeat call from ${phone}`);
          continue;
        }

        await createTicket(orgId, {
          caller_number: phone,
          channel_id: log.unique_id || log.channel || change.doc.id,
          category: source,
          summary: `${summary}\n↳ Called at ${callTime}`,
          details,
          priority: "high",
          source,
          recording_url: log.recording_url || "",
          call_duration: duration,
          created_by: "auto",
        });
        console.log(`Auto-ticket: ${source} from ${phone}`);
      } catch (err) {
        console.error("Auto-ticket failed:", err);
      }
    }
  });
}

// ─── Create Ticket ───

export async function createTicket(orgId: string, ticket: Partial<Ticket>): Promise<string> {
  const ref = collection(db!, ASTRAPBX_ROOT, orgId, "tickets");
  const docRef = await addDoc(ref, {
    caller_number: ticket.caller_number || "",
    channel_id: ticket.channel_id || "",
    category: ticket.category || "general",
    summary: ticket.summary || "",
    details: ticket.details || "",
    guest_name: ticket.guest_name || "",
    room_number: ticket.room_number || "",
    priority: ticket.priority || "normal",
    status: "open",
    source: ticket.source || "manual",
    recording_url: ticket.recording_url || "",
    call_duration: ticket.call_duration || 0,
    custom_fields: ticket.custom_fields || {},
    created_by: ticket.created_by || "system",
    created_at: Timestamp.now(),
  });
  return docRef.id;
}
