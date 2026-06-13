"use client";

import { format } from "date-fns";
// Firestore types kept only for backwards-compatible cursor-stack typing.
// The API module returns numeric offsets but the page treats them opaquely.
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import {
  Archive,
  Bell,
  BellOff,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Inbox,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/Toast";
import { auth } from "@/lib/firebase/config";
import { msg91, type Msg91Number, type Msg91Template } from "@/lib/msg91/client";
import {
  clickToCall,
  dids as pbxDids,
  type PbxDid,
  type PbxUser,
  ticketAlerts,
  type TicketAlertsView,
  ticketWhatsapp,
  type TicketWhatsAppConfig,
  users as pbxUsers,
} from "@/lib/pbx/client";
// Tickets data layer — moved from Firestore (`@/lib/firebase/firestore`)
// to MariaDB-backed API (`@/lib/tickets/api`). Same function shape so
// the rest of the page works unchanged. `subscribeToTickets` is new —
// SSE-based live updates replace Firestore's onSnapshot.
import {
  createTicket,
  getTicketEvents,
  getTicketsPage,
  restoreTicket,
  subscribeToTickets,
  type Ticket,
  type TicketCallEvent,
  updateTicketStatus,
} from "@/lib/tickets/api";

const ARCHIVE_TRIGGER_URL = "https://events.example.com/api/internal/auto-archive-tickets";

const priorityColors: Record<string, string> = {
  high: "destructive",
  urgent: "destructive",
  normal: "default",
  low: "secondary",
};

// Extract actual phone number — caller_number may contain PJSIP channel name
function extractPhone(ticket: Ticket): string {
  const cn = ticket.caller_number || "";
  // If it's a real phone number (not PJSIP channel)
  if (!cn.startsWith("PJSIP") && !cn.startsWith("Local")) {
    const digits = cn.replace(/\D/g, "");
    if (digits.length >= 10) return digits.slice(-10);
    if (digits.length >= 7) return digits;
  }
  // Check custom_fields for phone
  if (ticket.custom_fields?.phone) return ticket.custom_fields.phone.replace(/\D/g, "").slice(-10);
  // Check details for phone pattern
  const phoneMatch = (ticket.details || "").match(/(\d{10,})/);
  if (phoneMatch) return phoneMatch[1].slice(-10);
  // PJSIP channel — show as "Via Trunk"
  if (cn.startsWith("PJSIP")) return "Via Trunk";
  return cn || "---";
}
const statusSteps = ["open", "in_progress", "closed"] as const;
const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  closed: "Closed",
};

const sourceColors: Record<string, string> = {
  missed_call: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  bot: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  bot_dropped: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  queue_timeout: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  manual: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  workflow: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
};

export default function TicketsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState(25);
  const [activeTab, setActiveTab] = useState<"tickets" | "archived">("tickets");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [pageIndex, setPageIndex] = useState(0); // 0-based current page
  const [hasMore, setHasMore] = useState(false);
  const cursorStackRef = useRef<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]); // cursors[i] is the cursor for page i (null = first page)
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [remarks, setRemarks] = useState("");
  const [updating, setUpdating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  // Header strip counts — populated from the same /tickets call that
  // returns the page. Empty `archived` slot per UI spec.
  const [statusCounts, setStatusCounts] = useState<{
    open: number;
    in_progress: number;
    closed: number;
  } | null>(null);
  // Missed-call timeline for the currently expanded ticket. Fetched
  // lazily when the operator opens the Sheet so the list payload
  // stays slim; cleared on close.
  const [selectedEvents, setSelectedEvents] = useState<TicketCallEvent[]>([]);
  const [selectedEventsLoading, setSelectedEventsLoading] = useState(false);

  // Create ticket dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newTicket, setNewTicket] = useState({
    caller_number: "",
    category: "general",
    summary: "",
    details: "",
    priority: "normal",
    guest_name: "",
    room_number: "",
  });

  // WhatsApp config
  const [waConfigOpen, setWaConfigOpen] = useState(false);
  const [waConfig, setWaConfig] = useState<TicketWhatsAppConfig | null>(null);
  const [waNumbers, setWaNumbers] = useState<Msg91Number[]>([]);
  const [waTemplates, setWaTemplates] = useState<Msg91Template[]>([]);
  const [waSaving, setWaSaving] = useState(false);

  // Get Alerts (daily missed-call WhatsApp summary, Astradial-side)
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsView, setAlertsView] = useState<TicketAlertsView | null>(null);
  const [alertsSaving, setAlertsSaving] = useState(false);
  const [newSubPhone, setNewSubPhone] = useState("");
  const [newSubName, setNewSubName] = useState("");

  // Click-to-call
  const [callOpen, setCallOpen] = useState(false);
  const [callFrom, setCallFrom] = useState("");
  const [callFromType, setCallFromType] = useState<"extension" | "external">("extension");
  const [userList, setUserList] = useState<PbxUser[]>([]);
  const [didList, setDidList] = useState<PbxDid[]>([]);
  const [calling, setCalling] = useState(false);

  // Reload whenever tab/filter/page changes
  useEffect(() => {
    loadTicketsPage(pageIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, activeTab, statusFilter, sourceFilter, dateFilter, pageIndex]);

  // Reset to page 0 (and clear cursor stack) when filters or tab change
  // (separate effect so the loadTicketsPage above sees the reset before fetching)
  const filterKey = `${activeTab}|${statusFilter}|${sourceFilter}|${dateFilter}`;
  const lastFilterKeyRef = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKeyRef.current !== filterKey) {
      lastFilterKeyRef.current = filterKey;
      cursorStackRef.current = [null];
      setPageIndex(0);
    }
  }, [filterKey]);

  // Server-side lazy auto-archive runs as part of every list call
  // now (PR-A), so no explicit client-side trigger is needed. The
  // ref + state are kept inert for noise-free diff with the prior
  // Firestore-era version.

  // Live updates via SSE — replaces the Firestore `onSnapshot`
  // subscription from the previous implementation. The server emits
  // a `refresh` event after any ticket write (POST / PATCH /
  // classifier upsert from CDR poller). We refetch the visible
  // page on each refresh — cheap at 25 rows.
  useEffect(() => {
    if (!orgId) return;
    const unsubscribe = subscribeToTickets(orgId, () => {
      // Re-run loadTicketsPage at the current pageIndex. Using a ref
      // pattern would also work; this closes over the latest function
      // via React's stale-closure-tolerance for setState callbacks.
      refreshCurrentPage();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // One-time loads (users, DIDs, WhatsApp config, MSG91 numbers/templates,
  // ticket-alert subscribers).
  useEffect(() => {
    pbxUsers
      .list()
      .then(setUserList)
      .catch(() => {});
    pbxDids
      .list()
      .then((d) => setDidList(d.filter((x) => x.status === "active")))
      .catch(() => {});
    ticketWhatsapp
      .getConfig()
      .then(setWaConfig)
      .catch(() => {});
    ticketAlerts
      .get(orgId)
      .then(setAlertsView)
      .catch(() => {});
    msg91
      .getNumbers(orgId)
      .then((n) => {
        setWaNumbers(n);
        const num = String((n[0] as Record<string, unknown>)?.integrated_number || "");
        if (num)
          msg91
            .getTemplates(orgId, num)
            .then((t) => setWaTemplates(t as Msg91Template[]))
            .catch(() => {});
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-fetch the missed-call timeline when a ticket is opened.
  // Cleared on close to avoid showing stale events from the previous
  // selection. Failures are swallowed silently — the timeline panel
  // shows an empty state on error rather than blocking the operator.
  useEffect(() => {
    if (!selected) {
      setSelectedEvents([]);
      return;
    }
    setSelectedEventsLoading(true);
    getTicketEvents(orgId, selected.id)
      .then((evs) => setSelectedEvents(evs))
      .catch(() => setSelectedEvents([]))
      .finally(() => setSelectedEventsLoading(false));
  }, [selected, orgId]);

  async function loadTicketsPage(idx: number) {
    // Clear immediately so a failed load doesn't leave the previous tab's
    // data on screen — that exact bug made Tickets and Archived look
    // identical the first time around.
    setTickets([]);
    setHasMore(false);
    setLoading(true);
    try {
      const cursor = cursorStackRef.current[idx] || null;
      const result = await getTicketsPage(orgId, {
        archived: activeTab === "archived",
        status: statusFilter === "all" ? undefined : statusFilter,
        source: sourceFilter === "all" ? undefined : sourceFilter,
        date: dateFilter || undefined,
        pageSize: pageSize,
        cursor,
      });
      setTickets(result.items);
      setHasMore(result.hasMore);
      // statusCounts is org-scoped and ignores the active tab/filter,
      // so the header strip stays accurate regardless of what page
      // the operator is on. `undefined` means an old API build —
      // hide the strip in that case rather than showing zeros.
      if (result.statusCounts) setStatusCounts(result.statusCounts);
      // Remember the cursor for the NEXT page (so Next can use it).
      // Cast through `unknown` because the cursor type widened from
      // Firestore QueryDocumentSnapshot to a numeric offset under the
      // hood — the page treats it opaquely either way.
      if (result.lastDoc && cursorStackRef.current.length === idx + 1) {
        cursorStackRef.current.push(
          result.lastDoc as unknown as QueryDocumentSnapshot<DocumentData>
        );
      }
    } catch (e) {
      console.error("[tickets] load failed:", e);
      showToast(e instanceof Error ? e.message : "Failed to load tickets", "error");
    } finally {
      setLoading(false);
    }
  }

  function goNextPage() {
    if (!hasMore || loading) return;
    setPageIndex((p) => p + 1);
  }

  function goPrevPage() {
    if (pageIndex === 0 || loading) return;
    setPageIndex((p) => Math.max(0, p - 1));
  }

  function refreshCurrentPage() {
    // Drop any cached cursors past the current index so we re-walk from here
    cursorStackRef.current = cursorStackRef.current.slice(0, pageIndex + 1);
    loadTicketsPage(pageIndex);
  }

  function goFirstPage() {
    if (pageIndex === 0 || loading) return;
    cursorStackRef.current = [null];
    setPageIndex(0);
  }

  async function handleRestore(ticketId: string) {
    if (!confirm("Restore this ticket back to active?")) return;
    setRestoring(ticketId);
    try {
      await restoreTicket(orgId, ticketId);
      showToast("Ticket restored", "success");
      // Remove from current view (we're on the Archived tab)
      setTickets((prev) => prev.filter((t) => t.id !== ticketId));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Restore failed", "error");
    } finally {
      setRestoring(null);
    }
  }

  async function triggerAutoArchive(org: string) {
    try {
      // Firebase-only feature: passes a Firebase ID token. In OSS local
      // mode (no Firebase), there is no ID token to send — skip silently.
      // v1.1 may swap to a JWT-based trigger so this works in both modes.
      if (!auth) return;
      const user = auth.currentUser;
      if (!user) return; // Firebase auto-relogin handles this — try again on next mount
      const idToken = await user.getIdToken();
      await fetch(`${ARCHIVE_TRIGGER_URL}/${org}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      // Don't await/use the response — server runs the archival in a background task
    } catch {
      // Silent — archival is best-effort housekeeping
    }
  }

  // No client-side filtering needed — server already returned the filtered page
  const filtered = tickets;

  function formatTime(ts: unknown): string {
    if (!ts) return "---";
    try {
      if (typeof ts === "object" && ts !== null && "toDate" in ts)
        return format((ts as { toDate: () => Date }).toDate(), "MMM d, h:mm a");
      return format(new Date(String(ts)), "MMM d, h:mm a");
    } catch {
      return "---";
    }
  }

  async function handleCreate() {
    try {
      await createTicket(orgId, { ...newTicket, source: "manual", created_by: "admin" });
      showToast("Ticket created", "success");
      setCreateOpen(false);
      setNewTicket({
        caller_number: "",
        category: "general",
        summary: "",
        details: "",
        priority: "normal",
        guest_name: "",
        room_number: "",
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function handleSaveWaConfig() {
    if (!waConfig) return;
    setWaSaving(true);
    try {
      await ticketWhatsapp.setConfig(waConfig);
      showToast("WhatsApp config saved", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setWaSaving(false);
    }
  }

  // Get Alerts (Astradial-side daily missed-call WhatsApp summary)
  async function handleToggleAlerts(enabled: boolean) {
    setAlertsSaving(true);
    try {
      const { enabled: confirmed } = await ticketAlerts.setEnabled(orgId, enabled);
      setAlertsView((v) =>
        v ? { ...v, enabled: confirmed } : { enabled: confirmed, subscribers: [] }
      );
      showToast(enabled ? "Alerts enabled" : "Alerts disabled", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setAlertsSaving(false);
    }
  }

  async function handleAddSubscriber() {
    const phone = newSubPhone.trim();
    const name = newSubName.trim();
    if (!/^[6-9]\d{9}$/.test(phone)) {
      showToast("Phone must be 10 digits starting 6-9", "error");
      return;
    }
    if (!name) {
      showToast("Name is required", "error");
      return;
    }
    setAlertsSaving(true);
    try {
      const added = await ticketAlerts.addSubscriber(orgId, { phone, name });
      setAlertsView((v) =>
        v
          ? { ...v, subscribers: [...v.subscribers, added] }
          : { enabled: false, subscribers: [added] }
      );
      setNewSubPhone("");
      setNewSubName("");
      showToast("Subscriber added", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setAlertsSaving(false);
    }
  }

  async function handleRemoveSubscriber(id: string) {
    setAlertsSaving(true);
    try {
      await ticketAlerts.removeSubscriber(orgId, id);
      setAlertsView((v) =>
        v ? { ...v, subscribers: v.subscribers.filter((s) => s.id !== id) } : v
      );
      showToast("Subscriber removed", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setAlertsSaving(false);
    }
  }

  // Send WhatsApp on status change (for in_progress and closed)
  async function sendTicketWhatsApp(ticket: Ticket, newStatus: string) {
    if (!waConfig?.enabled) return;
    const statusConfig = waConfig.statuses[newStatus as keyof typeof waConfig.statuses];
    if (!statusConfig?.enabled || !statusConfig.template_name) return;

    const phone = "91" + extractPhone(ticket).slice(-10);
    if (phone.length < 12) return;

    const ticketFields: Record<string, string> = {
      caller_number: extractPhone(ticket),
      guest_name: ticket.guest_name || "",
      room_number: ticket.room_number || "",
      summary: ticket.summary || "",
      details: ticket.details || "",
      category: ticket.category || "",
      priority: ticket.priority || "",
      remarks: ticket.remarks || "",
      status: newStatus,
      created_at: formatTime(ticket.created_at),
      updated_at: new Date().toLocaleString(),
    };

    const components: Record<string, { type: string; value: string }> = {};
    for (const [varName, field] of Object.entries(statusConfig.variable_mapping)) {
      components[varName] = { type: "text", value: ticketFields[field] || field };
    }

    try {
      await msg91.send(orgId, {
        integrated_number: waConfig.sender_number,
        content_type: "template",
        payload: {
          type: "template",
          template: {
            name: statusConfig.template_name,
            language: { code: statusConfig.template_language || "en", policy: "deterministic" },
            to_and_components: [{ to: [phone], components }],
          },
          messaging_product: "whatsapp",
        },
      });
      showToast(`WhatsApp sent (${statusConfig.template_name})`, "success");
    } catch {
      showToast("WhatsApp send failed", "error");
    }
  }

  async function handleCallBack() {
    if (!selected || !callFrom) return;
    setCalling(true);
    try {
      const callerId = didList[0]?.number || "";
      await clickToCall.initiate({
        from: callFrom,
        from_type: callFromType,
        to: selected.caller_number.replace(/\D/g, "").slice(-10),
        to_type: "external",
        caller_id: callerId,
      });
      showToast("Call initiated", "success");
      setCallOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 sm:p-6 pb-3 shrink-0 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Tickets</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Support tickets from missed calls, AI bots, and manual entries
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setAlertsOpen(true)}
            >
              {alertsView?.enabled ? (
                <Bell className="h-3.5 w-3.5" />
              ) : (
                <BellOff className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Get Alerts</span>
              {alertsView?.enabled && <span className="h-2 w-2 rounded-full bg-green-500" />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setWaConfigOpen(true)}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">WhatsApp</span>
              {waConfig?.enabled && <span className="h-2 w-2 rounded-full bg-green-500" />}
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Create Ticket</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create Ticket</DialogTitle>
                  <DialogDescription>Manually create a support ticket</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Phone Number</Label>
                      <Input
                        value={newTicket.caller_number}
                        onChange={(e) =>
                          setNewTicket({ ...newTicket, caller_number: e.target.value })
                        }
                        placeholder="9876543210"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Priority</Label>
                      <Select
                        value={newTicket.priority}
                        onValueChange={(v) => setNewTicket({ ...newTicket, priority: v })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Guest Name</Label>
                      <Input
                        value={newTicket.guest_name}
                        onChange={(e) => setNewTicket({ ...newTicket, guest_name: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Category</Label>
                      <Input
                        value={newTicket.category}
                        onChange={(e) => setNewTicket({ ...newTicket, category: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Summary</Label>
                    <Input
                      value={newTicket.summary}
                      onChange={(e) => setNewTicket({ ...newTicket, summary: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Details</Label>
                    <Textarea
                      value={newTicket.details}
                      onChange={(e) => setNewTicket({ ...newTicket, details: e.target.value })}
                      className="text-xs min-h-[60px]"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Tabs: Tickets / Archived */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "tickets" | "archived")}>
          <TabsList>
            <TabsTrigger value="tickets" className="gap-1.5">
              <Inbox className="h-3.5 w-3.5" />
              Tickets
            </TabsTrigger>
            <TabsTrigger value="archived" className="gap-1.5">
              <Archive className="h-3.5 w-3.5" />
              Archived
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Filters bar */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Status
            </Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Source
            </Label>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="missed_call">Missed call</SelectItem>
                <SelectItem value="bot">Bot</SelectItem>
                <SelectItem value="bot_dropped">Bot dropped</SelectItem>
                <SelectItem value="queue_timeout">Queue timeout</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="workflow">Workflow</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Date (IST)
            </Label>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 w-[150px] text-xs"
            />
          </div>
          {(statusFilter !== "all" || sourceFilter !== "all" || dateFilter) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                setStatusFilter("all");
                setSourceFilter("all");
                setDateFilter("");
              }}
            >
              Clear
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* Org-scoped counts header strip — excludes archived per
                product spec. Hidden when the API didn't return
                status_counts (older API build during the rollout). */}
            {statusCounts && (
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center rounded-md px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  Open:{" "}
                  <span className="ml-1 font-semibold">
                    {statusCounts.open + statusCounts.in_progress}
                  </span>
                </span>
                <span className="inline-flex items-center rounded-md px-2 py-0.5 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  Closed: <span className="ml-1 font-semibold">{statusCounts.closed}</span>
                </span>
              </div>
            )}
            <span className="text-xs text-muted-foreground">
              {tickets.length > 0
                ? `Page ${pageIndex + 1} · ${tickets.length} row${tickets.length === 1 ? "" : "s"}`
                : "0 rows"}
            </span>
            <Button variant="outline" size="sm" onClick={refreshCurrentPage} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Table (desktop) + Cards (mobile) */}
      <div className="px-4 sm:px-6 flex-1 min-h-0 overflow-y-auto">
        {/* Desktop / tablet table */}
        <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex-col mt-2 hidden md:flex">
          <div className="overflow-auto flex-1 relative">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
                <TableRow className="border-b-border/50 hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  /* Skeleton rows (9 columns matching the header) */
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`skel-${i}`}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-muted/60 rounded animate-pulse" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      {activeTab === "archived"
                        ? "No archived tickets"
                        : "No tickets match your filters"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((ticket) => (
                    <TableRow
                      key={ticket.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelected(ticket)}
                    >
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTime(ticket.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{extractPhone(ticket)}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceColors[ticket.source || "manual"] || sourceColors.manual}`}
                        >
                          {(ticket.source || "manual").replace("_", " ")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {ticket.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            ticket.priority === "high" || ticket.priority === "urgent"
                              ? "bg-red-500/80 text-white"
                              : ticket.priority === "normal"
                                ? "bg-blue-500/80 text-white"
                                : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {ticket.priority}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            ticket.status === "open"
                              ? "default"
                              : ticket.status === "in_progress"
                                ? "outline"
                                : "secondary"
                          }
                          className="text-xs capitalize"
                        >
                          {statusLabels[ticket.status] || ticket.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ticket.closed_at ? formatTime(ticket.closed_at) : "—"}
                      </TableCell>
                      <TableCell className="text-sm max-w-[220px] truncate">
                        {ticket.summary ? (
                          ticket.summary
                        ) : ticket.missed_count && ticket.missed_count > 0 ? (
                          <span className="text-muted-foreground">
                            {ticket.missed_count} missed call{ticket.missed_count === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div
                          className="flex gap-1 justify-end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {activeTab === "archived" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={restoring === ticket.id}
                              onClick={() => handleRestore(ticket.id)}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              Restore
                            </Button>
                          ) : (
                            extractPhone(ticket) !== "Via Trunk" &&
                            extractPhone(ticket) !== "---" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => {
                                    navigator.clipboard.writeText(extractPhone(ticket));
                                    showToast("Copied", "success");
                                  }}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => {
                                    setSelected(ticket);
                                    setCallOpen(true);
                                  }}
                                >
                                  <Phone className="h-3 w-3" />
                                </Button>
                              </>
                            )
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {(pageIndex > 0 || hasMore) && (
            <div className="border-t border-border/50 bg-muted/30 px-4 py-3 sticky bottom-0 z-10 flex items-center justify-between">
              <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                Showing {pageIndex * pageSize + 1}–{pageIndex * pageSize + tickets.length} rows
              </div>
              <div className="flex w-full items-center gap-8 lg:w-fit">
                <div className="hidden items-center gap-2 lg:flex">
                  <Label className="text-sm font-medium">Rows per page</Label>
                  <Select
                    value={`${pageSize}`}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      cursorStackRef.current = [null];
                      setPageIndex(0);
                    }}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue placeholder={pageSize} />
                    </SelectTrigger>
                    <SelectContent side="top">
                      {[10, 25, 50, 100].map((size) => (
                        <SelectItem key={size} value={`${size}`}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex w-fit items-center justify-center text-sm font-medium">
                  Page {pageIndex + 1}
                </div>
                <div className="ml-auto flex items-center gap-2 lg:ml-0">
                  <Button
                    variant="outline"
                    className="hidden h-8 w-8 p-0 lg:flex"
                    onClick={goFirstPage}
                    disabled={pageIndex === 0 || loading}
                  >
                    <span className="sr-only">Go to first page</span>
                    <ChevronsLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="size-8"
                    size="icon"
                    onClick={goPrevPage}
                    disabled={pageIndex === 0 || loading}
                  >
                    <span className="sr-only">Go to previous page</span>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="size-8"
                    size="icon"
                    onClick={goNextPage}
                    disabled={!hasMore || loading}
                  >
                    <span className="sr-only">Go to next page</span>
                    <ChevronRight className="size-4" />
                  </Button>
                  {/* Last page unknown for cursor-based */}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-2">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <div className="h-4 bg-muted/60 rounded animate-pulse w-2/3" />
                <div className="h-3 bg-muted/60 rounded animate-pulse w-1/2" />
                <div className="h-3 bg-muted/60 rounded animate-pulse w-3/4" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
              {activeTab === "archived" ? "No archived tickets" : "No tickets match your filters"}
            </div>
          ) : (
            filtered.map((ticket) => (
              <div
                key={ticket.id}
                className="border rounded-lg p-3 space-y-2 active:bg-muted/50"
                onClick={() => setSelected(ticket)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm">{extractPhone(ticket)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatTime(ticket.created_at)}
                    </div>
                  </div>
                  <Badge
                    variant={
                      ticket.status === "open"
                        ? "default"
                        : ticket.status === "in_progress"
                          ? "outline"
                          : "secondary"
                    }
                    className="text-[10px] capitalize shrink-0"
                  >
                    {statusLabels[ticket.status] || ticket.status}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceColors[ticket.source || "manual"] || sourceColors.manual}`}
                  >
                    {(ticket.source || "manual").replace("_", " ")}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      ticket.priority === "high" || ticket.priority === "urgent"
                        ? "bg-red-500/80 text-white"
                        : ticket.priority === "normal"
                          ? "bg-blue-500/80 text-white"
                          : "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {ticket.priority}
                  </span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {ticket.category}
                  </Badge>
                </div>
                <div className="text-xs line-clamp-2">{ticket.summary}</div>
                {activeTab === "archived" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-7 text-xs"
                    disabled={restoring === ticket.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRestore(ticket.id);
                    }}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Restore
                  </Button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Mobile Pagination controls */}
        <div className="md:hidden">
          {(pageIndex > 0 || hasMore) && (
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground">Page {pageIndex + 1}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageIndex === 0 || loading}
                  onClick={goPrevPage}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasMore || loading}
                  onClick={goNextPage}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ticket detail sheet */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Ticket Details</SheetTitle>
            <SheetDescription>
              {selected?.source && (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium mr-2 ${sourceColors[selected.source] || sourceColors.manual}`}
                >
                  {selected.source.replace("_", " ")}
                </span>
              )}
              Created by {selected?.created_by || "System"}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-4 mt-4">
              <div className="flex gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                    selected.priority === "high" || selected.priority === "urgent"
                      ? "bg-red-500/80 text-white"
                      : selected.priority === "normal"
                        ? "bg-blue-500/80 text-white"
                        : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                  }`}
                >
                  {selected.priority} priority
                </span>
                <Badge
                  variant={
                    selected.status === "open"
                      ? "default"
                      : selected.status === "in_progress"
                        ? "outline"
                        : "secondary"
                  }
                  className="capitalize"
                >
                  {statusLabels[selected.status] || selected.status}
                </Badge>
              </div>
              <Separator />
              <div className="space-y-3 text-sm">
                {selected.guest_name && (
                  <div>
                    <span className="text-muted-foreground">Guest:</span>{" "}
                    <span className="font-medium">{selected.guest_name}</span>
                  </div>
                )}
                {selected.room_number && (
                  <div>
                    <span className="text-muted-foreground">Room:</span>{" "}
                    <span className="font-mono">{selected.room_number}</span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Category:</span>{" "}
                  <span className="capitalize">{selected.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Caller:</span>
                  <span className="font-mono">{selected.caller_number}</span>
                  {selected.caller_number && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          navigator.clipboard.writeText(selected.caller_number);
                          showToast("Copied", "success");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-xs"
                        onClick={() => setCallOpen(true)}
                      >
                        <Phone className="h-3 w-3" />
                        Call Back
                      </Button>
                    </>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  {formatTime(selected.created_at)}
                </div>
                {selected.missed_count && selected.missed_count > 1 ? (
                  <div>
                    <span className="text-muted-foreground">Missed attempts:</span>{" "}
                    <span className="font-semibold">{selected.missed_count}</span>
                  </div>
                ) : null}
                {selected.closed_at && (
                  <div>
                    <span className="text-muted-foreground">Closed:</span>{" "}
                    {formatTime(selected.closed_at)}
                  </div>
                )}
                {selected.call_duration ? (
                  <div>
                    <span className="text-muted-foreground">Duration:</span>{" "}
                    {selected.call_duration}s
                  </div>
                ) : null}
              </div>
              {/* Missed-call timeline — append-only call attempt log
                  populated by the call-logs-driven scheduler. Operator
                  can see "called at 11:00 PM, 12:00 AM, 12:15 AM"
                  without leaving the ticket view. */}
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Call timeline{" "}
                  {selectedEvents.length > 0 && (
                    <span className="text-muted-foreground/60">({selectedEvents.length})</span>
                  )}
                </p>
                {selectedEventsLoading ? (
                  <div className="text-xs text-muted-foreground">Loading…</div>
                ) : selectedEvents.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No call events recorded yet. (Older tickets created before the call-logs
                    scheduler shipped won&apos;t have a timeline.)
                  </div>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {selectedEvents.map((ev) => (
                      <li key={ev.id} className="flex items-center gap-2">
                        <span className="font-mono text-muted-foreground">
                          {formatTime(ev.occurred_at)}
                        </span>
                        {ev.kind === "missed" && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4">
                            Missed
                          </Badge>
                        )}
                        {ev.kind === "bot_dropped" && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4">
                            Bot Dropped
                          </Badge>
                        )}
                        {ev.kind === "outbound_attempt" && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4">
                            Outbound
                          </Badge>
                        )}
                        {ev.meta?.duration ? (
                          <span className="text-muted-foreground">{Number(ev.meta.duration)}s</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selected.recording_url && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Recording</p>
                    <audio controls src={selected.recording_url} className="w-full h-8" />
                  </div>
                </>
              )}
              <Separator />
              <div>
                <p className="text-xs text-muted-foreground mb-1">Summary</p>
                <p className="text-sm">{selected.summary}</p>
              </div>
              {selected.details && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Details</p>
                  <p className="text-sm">{selected.details}</p>
                </div>
              )}
              {selected.custom_fields && Object.keys(selected.custom_fields).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Additional Info</p>
                  {Object.entries(selected.custom_fields).map(([k, v]) => (
                    <div key={k} className="text-sm">
                      <span className="text-muted-foreground">{k}:</span> {v}
                    </div>
                  ))}
                </div>
              )}
              {selected.remarks && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Remarks</p>
                  <p className="text-sm">{selected.remarks}</p>
                </div>
              )}
              <Separator />
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Update Status
                </p>
                <div className="flex gap-1.5">
                  {statusSteps.map((s) => (
                    <Button
                      key={s}
                      variant={selected.status === s ? "default" : "outline"}
                      size="sm"
                      className="text-xs flex-1 capitalize"
                      // Hard-disable the Closed button when remarks
                      // are empty AND we're transitioning into closed
                      // (current status isn't already 'closed'). Belt-
                      // and-suspenders with the inline toast below so
                      // the operator can't accidentally close without
                      // a note even by clicking fast.
                      disabled={
                        updating ||
                        selected.status === s ||
                        (s === "closed" && !remarks.trim() && selected.status !== "closed")
                      }
                      title={
                        s === "closed" && !remarks.trim() && selected.status !== "closed"
                          ? "Add remarks before closing"
                          : undefined
                      }
                      onClick={async () => {
                        if (s === "closed" && !remarks.trim()) {
                          showToast("Please add remarks before closing", "error");
                          return;
                        }
                        setUpdating(true);
                        try {
                          await updateTicketStatus(
                            orgId,
                            selected.id,
                            s,
                            remarks.trim() || undefined
                          );
                          showToast(`Status updated to ${statusLabels[s]}`, "success");
                          const updatedTicket = {
                            ...selected,
                            status: s,
                            remarks: remarks.trim() || selected.remarks,
                          };
                          setSelected(updatedTicket);
                          setRemarks("");
                          // Fire WhatsApp notification (fire-and-forget)
                          sendTicketWhatsApp(updatedTicket, s).catch(() => {});
                        } catch (e) {
                          showToast(e instanceof Error ? e.message : "Update failed", "error");
                        } finally {
                          setUpdating(false);
                        }
                      }}
                    >
                      {statusLabels[s]}
                    </Button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Remarks {selected.status !== "closed" && "(required to close)"}
                  </Label>
                  <Textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Add notes or resolution details..."
                    className="text-sm min-h-[60px]"
                  />
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Click-to-Call dialog */}
      <Dialog open={callOpen} onOpenChange={setCallOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Call Back</DialogTitle>
            <DialogDescription>Call {selected?.caller_number}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <div className="grid grid-cols-3 gap-2">
                <Select
                  value={callFromType}
                  onValueChange={(v) => {
                    setCallFromType(v as "extension" | "external");
                    setCallFrom("");
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extension">Extension</SelectItem>
                    <SelectItem value="external">Phone</SelectItem>
                  </SelectContent>
                </Select>
                <div className="col-span-2">
                  {callFromType === "extension" ? (
                    <Select value={callFrom} onValueChange={setCallFrom}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {userList
                          .filter((u) => u.status === "active")
                          .map((u) => (
                            <SelectItem key={u.id} value={u.extension}>
                              {u.extension} — {u.full_name || u.username}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={callFrom}
                      onChange={(e) => setCallFrom(e.target.value)}
                      placeholder="9876543210"
                      maxLength={10}
                      className="h-8 text-xs"
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To (customer)</Label>
              <Input
                value={selected?.caller_number || ""}
                disabled
                className="h-8 text-xs bg-muted"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Caller ID</Label>
              {didList.length > 0 ? (
                <Input value={didList[0].number} disabled className="h-8 text-xs bg-muted" />
              ) : (
                <Input
                  value=""
                  disabled
                  className="h-8 text-xs bg-muted"
                  placeholder="No DID configured"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCallOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCallBack} disabled={!callFrom || calling}>
              {calling ? "Calling..." : "Call"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Get Alerts Sheet — daily missed-call WhatsApp summary (Astradial-side) */}
      <Sheet open={alertsOpen} onOpenChange={setAlertsOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Get Alerts</SheetTitle>
            <SheetDescription>
              Receive a daily WhatsApp summary of missed calls at 6:00 PM IST. Subscribers below get
              a personalised message only on days with at least one missed call.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 mt-4">
            {/* Master toggle */}
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Enable Daily Alerts</Label>
              <Switch
                checked={Boolean(alertsView?.enabled)}
                onCheckedChange={handleToggleAlerts}
                disabled={alertsSaving}
              />
            </div>

            <Separator />

            {/* Add subscriber row */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Add a phone number</Label>
              <div className="grid grid-cols-[60px_1fr_1fr_auto] gap-2 items-center">
                <Input value="+91" readOnly disabled className="h-8 text-xs text-center bg-muted" />
                <Input
                  value={newSubPhone}
                  onChange={(e) => setNewSubPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit number"
                  className="h-8 text-xs"
                  inputMode="numeric"
                />
                <Input
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value.slice(0, 120))}
                  placeholder="Name"
                  className="h-8 text-xs"
                />
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleAddSubscriber}
                  disabled={alertsSaving || newSubPhone.length !== 10 || !newSubName.trim()}
                  title="Add subscriber"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Subscriber list */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">
                Subscribers {alertsView ? `(${alertsView.subscribers.length})` : ""}
              </Label>
              {!alertsView ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : alertsView.subscribers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No subscribers yet. Add one above to start receiving alerts.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {alertsView.subscribers.map((s) => (
                    <div
                      key={s.id}
                      className="grid grid-cols-[60px_1fr_1fr_auto] gap-2 items-center rounded-md border bg-muted/30 p-2"
                    >
                      <span className="text-xs font-mono text-center text-muted-foreground">
                        +{s.country_code}
                      </span>
                      <span className="text-xs font-mono">{s.phone}</span>
                      <span className="text-xs truncate">{s.name}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleRemoveSubscriber(s.id)}
                        disabled={alertsSaving}
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {alertsView?.enabled && alertsView.subscribers.length === 0 ? (
              <p className="text-xs text-amber-600">
                Alerts are enabled but no subscribers are listed — nothing will be sent until you
                add one.
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* WhatsApp Config Sheet */}
      <Sheet open={waConfigOpen} onOpenChange={setWaConfigOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>WhatsApp Notifications</SheetTitle>
            <SheetDescription>Send WhatsApp messages on ticket status changes</SheetDescription>
          </SheetHeader>
          {waConfig && (
            <div className="space-y-5 mt-4">
              {/* Master toggle */}
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Enable WhatsApp Triggers</Label>
                <Switch
                  checked={waConfig.enabled}
                  onCheckedChange={(v) => setWaConfig({ ...waConfig, enabled: v })}
                />
              </div>

              {/* Sender number */}
              <div className="space-y-1.5">
                <Label className="text-xs">Sender Number</Label>
                {waNumbers.length > 0 ? (
                  <Select
                    value={waConfig.sender_number}
                    onValueChange={(v) => setWaConfig({ ...waConfig, sender_number: v })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select number" />
                    </SelectTrigger>
                    <SelectContent>
                      {waNumbers.map((n, i) => {
                        const num = String(
                          (n as Record<string, unknown>).integrated_number || n.number || ""
                        );
                        return (
                          <SelectItem key={i} value={num}>
                            {num}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={waConfig.sender_number}
                    onChange={(e) => setWaConfig({ ...waConfig, sender_number: e.target.value })}
                    className="h-8 text-xs"
                    placeholder="MSG91 number"
                  />
                )}
              </div>

              <Separator />

              {/* Per-status config */}
              {(["open", "in_progress", "closed"] as const).map((status) => {
                const sc = waConfig.statuses[status];
                const selectedTpl = waTemplates.find((t) => t.name === sc.template_name);
                const tplLangs =
                  ((selectedTpl as Record<string, unknown>)?.languages as Record<
                    string,
                    unknown
                  >[]) || [];
                const tplVars = (tplLangs[0]?.variables as string[]) || [];

                return (
                  <div key={status} className="space-y-3 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium capitalize">
                        {statusLabels[status]}
                      </Label>
                      <Switch
                        checked={sc.enabled}
                        onCheckedChange={(v) => {
                          const updated = {
                            ...waConfig,
                            statuses: { ...waConfig.statuses, [status]: { ...sc, enabled: v } },
                          };
                          setWaConfig(updated);
                        }}
                      />
                    </div>

                    {sc.enabled && (
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-[10px] text-muted-foreground">Template</Label>
                          {waTemplates.length > 0 ? (
                            <Select
                              value={sc.template_name}
                              onValueChange={(v) => {
                                const tpl = waTemplates.find((t) => t.name === v);
                                const lang =
                                  ((tpl as Record<string, unknown>)?.languages as Record<
                                    string,
                                    unknown
                                  >[]) || [];
                                const vars = (lang[0]?.variables as string[]) || [];
                                const mapping: Record<string, string> = {};
                                vars.forEach((vr) => {
                                  mapping[vr] = "";
                                });
                                setWaConfig({
                                  ...waConfig,
                                  statuses: {
                                    ...waConfig.statuses,
                                    [status]: {
                                      ...sc,
                                      template_name: v,
                                      template_language: String(lang[0]?.language || "en"),
                                      variable_mapping: mapping,
                                    },
                                  },
                                });
                              }}
                            >
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue placeholder="Select template" />
                              </SelectTrigger>
                              <SelectContent>
                                {waTemplates
                                  .filter((t) => {
                                    const ls =
                                      ((t as Record<string, unknown>)?.languages as Record<
                                        string,
                                        unknown
                                      >[]) || [];
                                    return ls[0]?.status === "APPROVED";
                                  })
                                  .map((t, i) => (
                                    <SelectItem key={i} value={String(t.name)}>
                                      {t.name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              value={sc.template_name}
                              onChange={(e) =>
                                setWaConfig({
                                  ...waConfig,
                                  statuses: {
                                    ...waConfig.statuses,
                                    [status]: { ...sc, template_name: e.target.value },
                                  },
                                })
                              }
                              className="h-7 text-xs"
                              placeholder="template_name"
                            />
                          )}
                        </div>

                        {/* Variable mapping — only after template selected */}
                        {sc.template_name && tplVars.length > 0 && (
                          <div className="space-y-2">
                            <Label className="text-[10px] text-muted-foreground">Variables</Label>
                            {tplVars.map((varName) => (
                              <div key={varName} className="flex items-center gap-2">
                                <span className="text-xs font-mono w-16 shrink-0 text-muted-foreground">
                                  {varName}
                                </span>
                                <span className="text-xs">=</span>
                                <Select
                                  value={sc.variable_mapping[varName] || ""}
                                  onValueChange={(v) => {
                                    setWaConfig({
                                      ...waConfig,
                                      statuses: {
                                        ...waConfig.statuses,
                                        [status]: {
                                          ...sc,
                                          variable_mapping: {
                                            ...sc.variable_mapping,
                                            [varName]: v,
                                          },
                                        },
                                      },
                                    });
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-xs flex-1">
                                    <SelectValue placeholder="Select field" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="caller_number">Phone Number</SelectItem>
                                    <SelectItem value="guest_name">Guest Name</SelectItem>
                                    <SelectItem value="room_number">Room Number</SelectItem>
                                    <SelectItem value="summary">Summary</SelectItem>
                                    <SelectItem value="details">Details</SelectItem>
                                    <SelectItem value="category">Category</SelectItem>
                                    <SelectItem value="priority">Priority</SelectItem>
                                    <SelectItem value="remarks">Remarks</SelectItem>
                                    <SelectItem value="status">Status</SelectItem>
                                    <SelectItem value="created_at">Created Date/Time</SelectItem>
                                    <SelectItem value="updated_at">Updated Date/Time</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              <Button className="w-full" onClick={handleSaveWaConfig} disabled={waSaving}>
                {waSaving ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
