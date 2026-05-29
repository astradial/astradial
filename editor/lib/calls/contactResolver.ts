/**
 * Phone-book-style contact resolver for the call-logs UI.
 *
 * Builds O(1) lookup maps from a `CallContactsMap` payload, then
 * exposes a `resolve(raw)` that turns a raw number/extension/queue
 * into a display object the row renderer can consume directly.
 *
 * The resolution chain (highest priority first):
 *   1. queue.number match    → "Reception" (queue.name)
 *   2. user.extension match  → "Girija R · ext 1009"
 *   3. user.phone_number match → "Girija R" (with personal-mobile tag)
 *   4. did.number match      → "Main · +91 80659 78012"
 *   5. else format the digits as an Indian E.164-ish number
 *
 * Each step normalises by stripping non-digits and keeping the
 * trailing 10 digits — covers `9876543210`, `09876543210`,
 * `919876543210`, `+91-99444-21125` collapsing to the same key.
 */
import type { CallContactsMap } from "@/lib/pbx/client";

export type ResolvedKind =
  | "queue"        // matched a queue.number
  | "user-ext"     // matched a user.extension
  | "user-phone"   // matched a user.phone_number (personal mobile)
  | "did"          // matched a registered DID
  | "external"    // no match — formatted PSTN number
  | "unknown";    // empty / unparseable input

export interface ResolvedContact {
  kind: ResolvedKind;
  primary: string;          // big label (e.g. "Girija R" or "+91 63821 36190")
  secondary?: string;       // small dim label (e.g. "ext 1009", "Personal mobile")
  raw: string;              // the original input (for tooltip / copy)
  // Optional metadata for the expanded row's contact card.
  user?: CallContactsMap["users"][number];
  queue?: CallContactsMap["queues"][number];
  did?: CallContactsMap["dids"][number];
}

export interface ContactResolver {
  resolve: (raw: string | null | undefined, opts?: { callerIdName?: string | null }) => ResolvedContact;
  // Direct lookups used by the row's "answered by" / "routed to" cards
  // which already know the exact key type.
  userByExtension: (ext: string) => CallContactsMap["users"][number] | undefined;
  userById: (id: string) => CallContactsMap["users"][number] | undefined;
  queueByNumber: (num: string) => CallContactsMap["queues"][number] | undefined;
}

// "9876543210", "919876543210", "+91-99444-21125", "09876543210"
// all collapse to "9876543210" — the canonical 10-digit Indian key.
function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 10) return digits;
  // Strip leading country code (91) or trunk-access 0 if present.
  if (digits.startsWith("91") && digits.length >= 12) return digits.slice(-10);
  if (digits.startsWith("0") && digits.length === 11) return digits.slice(1);
  return digits.slice(-10);
}

// Pretty-print an Indian phone: "+91 99444 21125" from "9876543210"
// Falls back to whatever digits we have when length is non-standard.
function formatIndian(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  if (d.length === 12 && d.startsWith("91")) {
    const k = d.slice(-10);
    return `+91 ${k.slice(0, 5)} ${k.slice(5)}`;
  }
  if (d.length === 11 && d.startsWith("0")) {
    const k = d.slice(1);
    return `+91 ${k.slice(0, 5)} ${k.slice(5)}`;
  }
  return raw;  // short codes, weird formats — leave alone
}

export function buildResolver(map: CallContactsMap | null | undefined): ContactResolver {
  // Build the four lookup tables. All keys are normalised at build time
  // so the resolver's hot path is a Map.get with no per-call regex.
  const byExt = new Map<string, CallContactsMap["users"][number]>();
  const byPhone = new Map<string, CallContactsMap["users"][number]>();
  const byId = new Map<string, CallContactsMap["users"][number]>();
  const queueByNum = new Map<string, CallContactsMap["queues"][number]>();
  const didByNum = new Map<string, CallContactsMap["dids"][number]>();

  for (const u of map?.users || []) {
    if (u.extension) byExt.set(String(u.extension), u);
    if (u.id) byId.set(u.id, u);
    if (u.phone_number) byPhone.set(phoneKey(u.phone_number), u);
    if (u.failover_phone_number) {
      // Failover number resolves to the same user but with a tag — only
      // set if no primary phone_number maps to the same key (primary wins).
      const k = phoneKey(u.failover_phone_number);
      if (!byPhone.has(k)) byPhone.set(k, u);
    }
  }
  for (const q of map?.queues || []) {
    if (q.number) queueByNum.set(String(q.number), q);
  }
  for (const d of map?.dids || []) {
    if (d.number) didByNum.set(phoneKey(d.number), d);
    if (d.number) didByNum.set(String(d.number), d);  // also raw key for short DIDs
  }

  const resolve: ContactResolver["resolve"] = (raw, opts) => {
    const s = String(raw ?? "").trim();
    if (!s) return { kind: "unknown", primary: "<unknown>", raw: "" };

    const digits = s.replace(/\D/g, "");
    const callerIdName = (opts?.callerIdName || "").trim();

    // 1. queue.number — bare digit string typed by an internal caller
    //    or written by the dialplan ("5002"). Short (3-5 digits).
    if (digits.length >= 3 && digits.length <= 5) {
      const q = queueByNum.get(digits);
      if (q) {
        return { kind: "queue", primary: q.name, secondary: `queue · ${q.number}`, raw: s, queue: q };
      }
      // 2. user.extension — also short (typically 4 digits).
      const u = byExt.get(digits);
      if (u) {
        return {
          kind: "user-ext",
          primary: u.full_name || u.username,
          secondary: `ext ${u.extension}`,
          raw: s,
          user: u,
        };
      }
    }

    // 3. user.phone_number (the user's personal mobile).
    const pk = phoneKey(s);
    if (pk.length === 10) {
      const u = byPhone.get(pk);
      if (u) {
        return {
          kind: "user-phone",
          primary: u.full_name || u.username,
          secondary: "Personal mobile",
          raw: s,
          user: u,
        };
      }
      // 4. DID number — incoming "to" number that's one of our registered DIDs.
      const d = didByNum.get(pk);
      if (d) {
        const desc = (d.description || "").trim();
        return {
          kind: "did",
          primary: desc || formatIndian(s),
          secondary: desc ? formatIndian(s) : undefined,
          raw: s,
          did: d,
        };
      }
    }

    // 5. External / unmatched — format if Indian-shaped, else raw.
    const pretty = formatIndian(s);
    // Dual-display when the trunk sent a CallerID name (e.g. "JIO
    // Service") but we couldn't match to a contact. Operators want
    // both pieces of info.
    if (callerIdName) {
      return { kind: "external", primary: callerIdName, secondary: pretty, raw: s };
    }
    return { kind: "external", primary: pretty, raw: s };
  };

  return {
    resolve,
    userByExtension: (ext) => byExt.get(String(ext)),
    userById: (id) => byId.get(id),
    queueByNumber: (num) => queueByNum.get(String(num)),
  };
}

// "Queue 5002 [1009]" or "Queue 5002" — the SQL-formatted "to" cell.
// We split it into queue.number + optional answered-extension so the
// resolver can render the friendly form.
export function parseQueueTo(toRaw: string): { queueNum?: string; ansExt?: string } {
  if (!toRaw) return {};
  const m = toRaw.match(/^Queue\s+(\d+)(?:\s*\[(\d+)\])?$/);
  if (!m) return {};
  return { queueNum: m[1], ansExt: m[2] };
}
