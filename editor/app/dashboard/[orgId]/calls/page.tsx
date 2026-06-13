"use client";

import { format } from "date-fns";
import {
  ArrowRightLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Ear,
  Mic,
  MoreHorizontal,
  Pause,
  Phone,
  PhoneOff,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AudioPlayerButton,
  AudioPlayerDuration,
  AudioPlayerProgress,
  AudioPlayerProvider,
  AudioPlayerTime,
  useAudioPlayer,
} from "@/components/ui/audio-player";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import {
  buildResolver,
  type ContactResolver,
  parseQueueTo,
  type ResolvedContact,
} from "@/lib/calls/contactResolver";
import {
  type ActiveCall,
  type CallContactsMap,
  type CallHistoryItem,
  type CallJourney,
  calls as pbxCalls,
  clickToCall,
  dids as pbxDids,
  effectiveCallStatus,
  type LiveCall,
  type PbxDid,
  type PbxQueue,
  type PbxUser,
  queues as pbxQueues,
  users as pbxUsers,
} from "@/lib/pbx/client";

function AutoPlayTrack({ src, id }: { src: string; id: string }) {
  const { play } = useAudioPlayer();
  useEffect(() => {
    const timer = setTimeout(() => {
      play({ id, src });
    }, 100);
    return () => clearTimeout(timer);
  }, [src, id, play]);
  return null;
}
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

import { db as firestoreDb, USE_FIREBASE } from "@/lib/firebase/config";
import { ASTRAPBX_ROOT } from "@/lib/firebase/firestore";

function formatDuration(secs: number) {
  if (!secs) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function CallsPage() {
  const { orgId } = useParams<{ orgId: string }>();

  // Live calls state
  const [liveCalls, setLiveCalls] = useState<Record<string, unknown>[]>([]);
  const [livePage, setLivePage] = useState(1);
  const [livePageSize, setLivePageSize] = useState(10);
  const [liveLoading, setLiveLoading] = useState(true);

  // Call history state
  const [logs, setLogs] = useState<CallHistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [journey, setJourney] = useState<CallJourney | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  // Phone-book-style resolver: maps raw extensions/numbers/queue
  // numbers to friendly names. Loaded once on mount; rebuilt only
  // when the contacts map itself changes. useMemo guarantees the
  // resolver is stable across re-renders so child rows don't churn.
  const [contactsMap, setContactsMap] = useState<CallContactsMap | null>(null);
  const resolver: ContactResolver = useMemo(() => buildResolver(contactsMap), [contactsMap]);
  useEffect(() => {
    pbxCalls
      .contactsMap()
      .then(setContactsMap)
      .catch(() => setContactsMap(null));
  }, []);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [directionFilter, setDirectionFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<string>(""); // today|week|month|custom
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(20);

  // Audio player
  const [playingLog, setPlayingLog] = useState<
    (CallHistoryItem & { recording_url: string }) | null
  >(null);

  // Transfer dialog
  const [transferChannel, setTransferChannel] = useState<string | null>(null);
  const [transferDest, setTransferDest] = useState("");
  const [transferType, setTransferType] = useState<"extension" | "queue" | "external">("extension");
  const [userList, setUserList] = useState<PbxUser[]>([]);
  const [userSearch, setUserSearch] = useState("");

  // Phonebook
  const [phonebook, setPhonebook] = useState<{ name: string; number: string }[]>([]);
  const [phonebookOpen, setPhonebookOpen] = useState(false);
  const [newContact, setNewContact] = useState({ name: "", number: "" });

  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Initiate call dialog
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [callForm, setCallForm] = useState({
    from: "",
    from_type: "extension" as "extension" | "external",
    to: "",
    to_type: "extension" as "extension" | "queue" | "external",
    caller_id: "08065978002",
  });
  const [initiating, setInitiating] = useState(false);

  // Poll live calls every 3 seconds — no loading flicker on subsequent polls
  const isFirstLoad = useRef(true);

  const prevCallCount = useRef(0);

  async function refreshLive() {
    try {
      if (isFirstLoad.current) setLiveLoading(true);
      const data = await pbxCalls.live();
      const calls = Array.isArray(data) ? data : [];
      // Anti-flicker: if we had calls and now get 0, it's likely a stale AMI response
      // Keep previous data for one more poll before clearing
      if (calls.length === 0 && prevCallCount.current > 0) {
        prevCallCount.current = 0; // Next poll of 0 will clear
      } else {
        prevCallCount.current = calls.length;
        setLiveCalls(calls);
      }
      setLastRefresh(new Date());
    } catch {
      // Keep existing data on error — don't clear
    } finally {
      setLiveLoading(false);
      isFirstLoad.current = false;
    }
  }

  useEffect(() => {
    refreshLive();
    const interval = setInterval(refreshLive, 3000);
    return () => clearInterval(interval);
  }, []);

  // Convert a preset range picker to actual date_from/date_to ISO strings
  function applyDatePreset(preset: string) {
    setDateRange(preset);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      .toISOString()
      .slice(0, 10);
    if (preset === "today") {
      setDateFrom(today);
      setDateTo(today);
      return;
    }
    if (preset === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      setDateFrom(d.toISOString().slice(0, 10));
      setDateTo(today);
      return;
    }
    if (preset === "month") {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      setDateFrom(d.toISOString().slice(0, 10));
      setDateTo(today);
      return;
    }
    if (preset === "all") {
      setDateFrom("");
      setDateTo("");
      return;
    }
  }

  // Load call history from PBX API (SQL-backed /api/v1/calls — NOT Firebase)
  const loadHistory = useCallback(
    async (p = 1) => {
      setHistoryLoading(true);
      try {
        const result = await pbxCalls.history({
          page: p,
          limit: pageSize,
          direction: directionFilter && directionFilter !== "all" ? directionFilter : undefined,
          disposition: statusFilter && statusFilter !== "all" ? statusFilter : undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          search: searchQuery.trim() || undefined,
        });
        setLogs(result.items);
        setHasMore(result.hasMore);
        setTotalPages(result.pages);
        setPage(result.page);
      } catch (e) {
        console.error("Failed to load call logs:", e);
      } finally {
        setHistoryLoading(false);
      }
    },
    [orgId, directionFilter, statusFilter, dateFrom, dateTo, searchQuery, pageSize]
  );

  useEffect(() => {
    loadHistory(1);
  }, [orgId, directionFilter, statusFilter, dateFrom, dateTo, pageSize]);

  // Load users + queues + DIDs for transfer/initiate
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);
  const [didList, setDidList] = useState<PbxDid[]>([]);
  useEffect(() => {
    pbxUsers
      .list()
      .then(setUserList)
      .catch(() => {});
    pbxQueues
      .list()
      .then(setQueueList)
      .catch(() => {});
    pbxDids
      .list()
      .then((dids) => {
        setDidList(dids.filter((d) => d.status === "active"));
        // Set default caller ID to first active DID
        if (dids.length > 0) {
          setCallForm((f) => ({ ...f, caller_id: dids[0].number }));
        }
      })
      .catch(() => {});
  }, []);

  // Hard gate for the "AI Handled" badge: only emit it if the org
  // actually has an AI agent configured somewhere — either a user
  // with routing_type='ai_agent' or a DID routed straight to AI.
  // V7 Hotels has neither, so this collapses to false and the call
  // log will never show "AI Handled" no matter what the CDR row
  // looks like. Belt-and-suspenders behind the SQL narrowing.
  const orgHasAiAgent = useMemo(
    () =>
      userList.some((u) => u.routing_type === "ai_agent") ||
      didList.some((d) => d.routing_type === "ai_agent"),
    [userList, didList]
  );

  // Initiate call
  async function handleInitiateCall() {
    if (!callForm.from || !callForm.to) return;
    setInitiating(true);
    try {
      await clickToCall.initiate({
        from: callForm.from,
        from_type: callForm.from_type,
        to: callForm.to,
        to_type: callForm.to_type,
        caller_id: callForm.caller_id,
      });
      showToast("Call initiated — ringing 'From' first, then connecting to 'To'", "success");
      setInitiateOpen(false);
      setCallForm({
        from: "",
        from_type: "extension",
        to: "",
        to_type: "extension",
        caller_id: "08065978002",
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to initiate call", "error");
    } finally {
      setInitiating(false);
    }
  }

  // Quick-call helper invoked by ContactCard buttons in the expanded
  // call-log row. Pre-fills the existing Initiate Call dialog's "to"
  // side from the resolved contact and opens the dialog so the
  // operator confirms + picks the "from" side. Never auto-dials —
  // keeps the same explicit-confirm UX as the manual Initiate Call
  // flow.
  function quickCallFromContact(r: ResolvedContact) {
    let to = "";
    let to_type: "extension" | "queue" | "external" = "extension";
    if (r.kind === "queue" && r.queue) {
      to = r.queue.number;
      to_type = "queue";
    } else if (r.kind === "user-ext" && r.user) {
      to = r.user.extension;
      to_type = "extension";
    } else if (r.kind === "user-phone" && r.user) {
      // Calling a user's personal mobile — easiest is to ring their
      // extension; the extension's ring_target=phone forwarding will
      // route to their mobile automatically. Avoids an outbound-trunk
      // call when an internal one suffices.
      to = r.user.extension;
      to_type = "extension";
    } else if (r.kind === "external") {
      // Last-10-digits is what the outbound dialplan expects.
      const digits = r.raw.replace(/\D/g, "");
      to = digits.length > 10 ? digits.slice(-10) : digits;
      to_type = "external";
    } else {
      showToast("This contact can't be called directly", "error");
      return;
    }
    setCallForm((f) => ({ ...f, to, to_type, from: "", from_type: "extension" }));
    setInitiateOpen(true);
  }

  // Load phonebook from Firestore (shared across all agents). In OSS
  // local mode this is a no-op — the phonebook feature is Firestore-only
  // for v1; v1.1 will migrate it to a Postgres-backed API endpoint.
  useEffect(() => {
    if (!USE_FIREBASE || !firestoreDb) return;
    const unsub = onSnapshot(
      doc(firestoreDb!, ASTRAPBX_ROOT, orgId, "settings", "phonebook"),
      (snap) => {
        if (snap.exists()) {
          setPhonebook(snap.data().contacts || []);
        }
      }
    );
    return unsub;
  }, [orgId]);

  async function savePhonebook(entries: { name: string; number: string }[]) {
    setPhonebook(entries);
    if (!USE_FIREBASE || !firestoreDb) {
      showToast("Phonebook persistence requires Firebase (v1.1: API-backed)", "error");
      return;
    }
    try {
      await setDoc(doc(firestoreDb!, ASTRAPBX_ROOT, orgId, "settings", "phonebook"), {
        contacts: entries,
      });
    } catch (e) {
      console.error("Failed to save phonebook:", e);
      showToast("Failed to save phonebook", "error");
    }
  }

  function addContact() {
    if (!newContact.name || !newContact.number) return;
    savePhonebook([...phonebook, { name: newContact.name, number: newContact.number }]);
    setNewContact({ name: "", number: "" });
  }

  function removeContact(idx: number) {
    savePhonebook(phonebook.filter((_, i) => i !== idx));
  }

  async function handleTransfer() {
    if (!transferChannel || !transferDest) return;
    try {
      console.log("Transfer:", {
        channel: transferChannel,
        dest: transferDest,
        type: transferType,
      });
      await pbxCalls.transfer(transferChannel, transferDest, transferType);
      showToast("Call transferred", "success");
      setTransferChannel(null);
      setTransferDest("");
    } catch (e) {
      console.error("Transfer failed:", e);
      showToast(e instanceof Error ? e.message : "Transfer failed", "error");
    }
  }

  async function handleHangup(channelId: string) {
    try {
      await pbxCalls.hangup(channelId);
      showToast("Call ended", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Hangup failed", "error");
    }
  }

  function nextPage() {
    if (hasMore) {
      setPage((p) => p + 1);
      loadHistory();
    }
  }

  const filteredUsers = userList.filter((u) =>
    `${u.full_name || ""} ${u.username} ${u.extension} ${u.phone_number || ""}`
      .toLowerCase()
      .includes(userSearch.toLowerCase())
  );

  // Strip phone to last 10 digits
  function cleanPhone(val: string) {
    const digits = val.replace(/\D/g, "");
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header */}
      <div className="p-6 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
            <p className="text-sm text-muted-foreground">
              Monitor live calls and view call history
            </p>
          </div>
          <Dialog open={initiateOpen} onOpenChange={setInitiateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Phone className="h-4 w-4 mr-1.5" />
                Initiate Call
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Initiate Call</DialogTitle>
                <DialogDescription>PBX calls 'From' first, then connects to 'To'</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {/* From */}
                <div className="space-y-1.5">
                  <Label>From (rings first)</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Select
                      value={callForm.from_type}
                      onValueChange={(v) =>
                        setCallForm({
                          ...callForm,
                          from_type: v as "extension" | "external",
                          from: "",
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="extension">Extension</SelectItem>
                        <SelectItem value="external">Phone Number</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="col-span-2">
                      {callForm.from_type === "extension" ? (
                        <Select
                          value={callForm.from}
                          onValueChange={(v) => setCallForm({ ...callForm, from: v })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select extension" />
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
                          value={callForm.from}
                          onChange={(e) =>
                            setCallForm({ ...callForm, from: cleanPhone(e.target.value) })
                          }
                          placeholder="9876543210"
                          maxLength={10}
                          className="h-8 text-xs"
                        />
                      )}
                    </div>
                  </div>
                </div>
                {/* To */}
                <div className="space-y-1.5">
                  <Label>To (connected after From answers)</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Select
                      value={callForm.to_type}
                      onValueChange={(v) =>
                        setCallForm({
                          ...callForm,
                          to_type: v as "extension" | "queue" | "external",
                          to: "",
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="extension">Extension</SelectItem>
                        <SelectItem value="queue">Queue</SelectItem>
                        <SelectItem value="external">Phone Number</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="col-span-2">
                      {callForm.to_type === "extension" ? (
                        <Select
                          value={callForm.to}
                          onValueChange={(v) => setCallForm({ ...callForm, to: v })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select extension" />
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
                      ) : callForm.to_type === "queue" ? (
                        <Select
                          value={callForm.to}
                          onValueChange={(v) => setCallForm({ ...callForm, to: v })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select queue" />
                          </SelectTrigger>
                          <SelectContent>
                            {queueList
                              .filter((q) => q.status === "active")
                              .map((q) => (
                                <SelectItem key={q.id} value={q.number}>
                                  {q.number} — {q.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={callForm.to}
                          onChange={(e) =>
                            setCallForm({ ...callForm, to: cleanPhone(e.target.value) })
                          }
                          placeholder="9876543210"
                          maxLength={10}
                          className="h-8 text-xs"
                        />
                      )}
                    </div>
                  </div>
                </div>
                {/* Caller ID — from DID list */}
                <div className="space-y-1.5">
                  <Label>Caller ID</Label>
                  {didList.length > 1 ? (
                    <Select
                      value={callForm.caller_id}
                      onValueChange={(v) => setCallForm({ ...callForm, caller_id: v })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select DID" />
                      </SelectTrigger>
                      <SelectContent>
                        {didList.map((d) => (
                          <SelectItem key={d.id} value={d.number}>
                            {d.number}
                            {d.description ? ` — ${d.description}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={callForm.caller_id} disabled className="h-8 text-xs bg-muted" />
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Number shown to the 'To' party
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInitiateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleInitiateCall}
                  disabled={!callForm.from || !callForm.to || initiating}
                >
                  {initiating ? "Calling..." : "Call"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="history" className="flex flex-col flex-1 min-h-0 px-6">
        <TabsList className="w-auto shrink-0 self-start">
          <TabsTrigger value="history">Call History</TabsTrigger>
          <TabsTrigger value="live" className="gap-1.5">
            <Phone className="h-3.5 w-3.5" />
            Live Calls
            {!liveLoading && liveCalls.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {liveCalls.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Live Calls */}
        <TabsContent value="live" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Auto-refreshing every 3s{" "}
              {lastRefresh && `· Last: ${lastRefresh.toLocaleTimeString()}`}
            </p>
            <div className="flex gap-1.5">
              <Dialog open={phonebookOpen} onOpenChange={setPhonebookOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <BookOpen className="h-3 w-3" />
                    Phonebook
                    {phonebook.length > 0 && (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                        {phonebook.length}
                      </Badge>
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Phonebook</DialogTitle>
                    <DialogDescription>Save contacts for quick transfer</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Name"
                        value={newContact.name}
                        onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                        className="h-8 text-xs"
                      />
                      <Input
                        placeholder="Number"
                        value={newContact.number}
                        onChange={(e) => setNewContact({ ...newContact, number: e.target.value })}
                        className="h-8 text-xs"
                      />
                      <Button size="sm" className="h-8 shrink-0" onClick={addContact}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    {phonebook.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        No contacts yet
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-60 overflow-y-auto">
                        {phonebook.map((c, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50 text-sm"
                          >
                            <div>
                              <span className="font-medium">{c.name}</span>
                              <span className="text-muted-foreground ml-2 font-mono text-xs">
                                {c.number}
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => removeContact(i)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={refreshLive}
                disabled={liveLoading}
              >
                <RefreshCw className={`h-3 w-3 ${liveLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
          <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-2">
            <div className="overflow-auto flex-1 relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
                  <TableRow className="border-b-border/50 hover:bg-transparent">
                    <TableHead>From</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>CallerID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liveLoading ? (
                    <TableSkeleton cols={8} />
                  ) : liveCalls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No active calls
                      </TableCell>
                    </TableRow>
                  ) : (
                    liveCalls
                      .slice((livePage - 1) * livePageSize, livePage * livePageSize)
                      .map((call) => {
                        const number = String(call.from || call.from_number || "---");
                        const direction = String(call.direction || "unknown");
                        const status = String(call.status || "unknown");
                        const agent = String(call.to || call.to_number || call.extension || "---");
                        const callerId = String(
                          call.caller_id || call.caller_id_name || call.from_name || "<unknown>"
                        );

                        const statusLabel =
                          status === "answered" || status === "Up"
                            ? "Answered"
                            : status === "ringing" || status === "Ring"
                              ? "Ringing"
                              : status;
                        const statusVariant = statusLabel === "Answered" ? "default" : "secondary";

                        return (
                          <TableRow key={String(call.channel_id)}>
                            <TableCell className="font-mono font-medium">{number}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs capitalize">
                                {direction === "inbound"
                                  ? "Incoming"
                                  : direction === "outbound"
                                    ? "Outgoing"
                                    : direction}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {callerId || "---"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={statusVariant as "default" | "secondary"}
                                className="text-xs"
                              >
                                {statusLabel}
                              </Badge>
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {formatDuration(Number(call.duration) || 0)}
                            </TableCell>
                            <TableCell className="text-sm">{agent}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {!!call.monitoring && (
                                  <Badge variant="outline" className="text-[10px] gap-1">
                                    <Ear className="h-3 w-3" />
                                    Monitored
                                  </Badge>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7"
                                  onClick={() => {
                                    setTransferChannel(String(call.channel_id));
                                    setTransferDest("");
                                  }}
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                                  Transfer
                                </Button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 w-7 p-0">
                                      <MoreHorizontal className="h-3.5 w-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => {
                                        const ext = prompt("Enter your extension to listen:");
                                        if (ext)
                                          pbxCalls
                                            .monitor(String(call.channel_id), ext, "spy")
                                            .then(() => showToast("Monitoring started", "success"))
                                            .catch((e) => showToast(String(e), "error"));
                                      }}
                                    >
                                      <Ear className="h-4 w-4 mr-2" />
                                      Monitor (Listen)
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        const ext = prompt("Enter your extension to whisper:");
                                        if (ext)
                                          pbxCalls
                                            .monitor(String(call.channel_id), ext, "whisper")
                                            .then(() => showToast("Whisper started", "success"))
                                            .catch((e) => showToast(String(e), "error"));
                                      }}
                                    >
                                      <Mic className="h-4 w-4 mr-2" />
                                      Whisper (Coach Agent)
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        const ext = prompt("Enter your extension to barge:");
                                        if (ext)
                                          pbxCalls
                                            .monitor(String(call.channel_id), ext, "barge")
                                            .then(() => showToast("Barged in", "success"))
                                            .catch((e) => showToast(String(e), "error"));
                                      }}
                                    >
                                      <UserPlus className="h-4 w-4 mr-2" />
                                      Barge (Join Call)
                                    </DropdownMenuItem>
                                    {!!call.monitoring && (
                                      <DropdownMenuItem
                                        onClick={() =>
                                          pbxCalls
                                            .stopMonitor(String(call.channel_id))
                                            .then(() => showToast("Monitoring stopped", "success"))
                                            .catch((e) => showToast(String(e), "error"))
                                        }
                                      >
                                        Stop Monitoring
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => handleHangup(String(call.channel_id))}
                                    >
                                      <PhoneOff className="h-4 w-4 mr-2" />
                                      Hangup
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                  )}
                </TableBody>
              </Table>
            </div>
            {liveCalls.length > 10 && (
              <div className="border-t border-border/50 bg-muted/30 px-4 py-3 sticky bottom-0 z-10 flex items-center justify-between">
                <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                  Showing {(livePage - 1) * livePageSize + 1}–
                  {Math.min(livePage * livePageSize, liveCalls.length)} of {liveCalls.length}{" "}
                  entries
                </div>
                <div className="flex w-full items-center gap-8 lg:w-fit">
                  <div className="hidden items-center gap-2 lg:flex">
                    <Label className="text-sm font-medium">Rows per page</Label>
                    <Select
                      value={`${livePageSize}`}
                      onValueChange={(value) => {
                        setLivePageSize(Number(value));
                        setLivePage(1);
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue placeholder={livePageSize} />
                      </SelectTrigger>
                      <SelectContent side="top">
                        {[10, 20, 30, 40, 50].map((size) => (
                          <SelectItem key={size} value={`${size}`}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex w-fit items-center justify-center text-sm font-medium">
                    Page {livePage} of {Math.ceil(liveCalls.length / livePageSize) || 1}
                  </div>
                  <div className="ml-auto flex items-center gap-2 lg:ml-0">
                    <Button
                      variant="outline"
                      className="hidden h-8 w-8 p-0 lg:flex"
                      onClick={() => setLivePage(1)}
                      disabled={livePage <= 1}
                    >
                      <span className="sr-only">Go to first page</span>
                      <ChevronsLeft className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="size-8"
                      size="icon"
                      onClick={() => setLivePage((p) => p - 1)}
                      disabled={livePage <= 1}
                    >
                      <span className="sr-only">Go to previous page</span>
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="size-8"
                      size="icon"
                      onClick={() => setLivePage((p) => p + 1)}
                      disabled={livePage * livePageSize >= liveCalls.length}
                    >
                      <span className="sr-only">Go to next page</span>
                      <ChevronRight className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="hidden size-8 lg:flex"
                      size="icon"
                      onClick={() => setLivePage(Math.ceil(liveCalls.length / livePageSize))}
                      disabled={livePage * livePageSize >= liveCalls.length}
                    >
                      <span className="sr-only">Go to last page</span>
                      <ChevronsRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Call History */}
        <TabsContent value="history" className="flex flex-col flex-1 min-h-0 mt-4">
          <div className="flex flex-wrap items-center gap-2 shrink-0 mb-3">
            <Input
              placeholder="Search phone or caller ID"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadHistory(1)}
              className="w-56 h-8 text-xs shadow-none"
            />
            <Select value={directionFilter || "all"} onValueChange={setDirectionFilter}>
              <SelectTrigger className="w-36 h-8 text-xs shadow-none">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All directions</SelectItem>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter || "all"} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32 h-8 text-xs shadow-none">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="ANSWERED">Answered</SelectItem>
                <SelectItem value="NO ANSWER">Missed</SelectItem>
                <SelectItem value="BUSY">Busy</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dateRange || "all"} onValueChange={applyDatePreset}>
              <SelectTrigger className="w-32 h-8 text-xs shadow-none">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">Last 7 days</SelectItem>
                <SelectItem value="month">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v))}>
              <SelectTrigger className="w-20 h-8 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs ml-auto"
              onClick={() => loadHistory(page)}
              disabled={historyLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${historyLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col flex-1 min-h-0 mb-5">
            <div className="flex-1 relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
                  <TableRow className="border-b-border/50 hover:bg-transparent">
                    <TableHead>To</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Disconnected by</TableHead>
                    <TableHead>Recording</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="overflow-auto">
                  {historyLoading ? (
                    <TableSkeleton cols={8} />
                  ) : logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No call records
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => (
                      <>
                        <TableRow
                          key={log.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={async () => {
                            const lid = (log as any).linkedid || log.call_id;
                            if (expandedCall === lid) {
                              setExpandedCall(null);
                              setJourney(null);
                              return;
                            }
                            setExpandedCall(lid);
                            setJourneyLoading(true);
                            try {
                              const j = await pbxCalls.journey(lid);
                              setJourney(j);
                            } catch {
                              setJourney(null);
                            } finally {
                              setJourneyLoading(false);
                            }
                          }}
                        >
                          {/* Phone-book-style "To" cell.
                        Queue strings ("Queue 5002 [1009]") get split into
                        queue name + answered-member name. Bare numbers
                        and extensions fall through to the generic
                        resolver. Tooltip shows the raw value the row
                        was built from. */}
                          <TableCell className="text-sm">
                            {(() => {
                              const toRaw = log.to_number || "";
                              if (!toRaw) return <span className="text-muted-foreground">---</span>;
                              const { queueNum, ansExt } = parseQueueTo(toRaw);
                              if (queueNum) {
                                const q = resolver.queueByNumber(queueNum);
                                const u = ansExt ? resolver.userByExtension(ansExt) : undefined;
                                return (
                                  <span title={toRaw} className="flex items-baseline gap-1.5">
                                    <span>{q?.name || `Queue ${queueNum}`}</span>
                                    {u && (
                                      <span className="text-xs text-muted-foreground">
                                        · {u.full_name || u.username}
                                      </span>
                                    )}
                                  </span>
                                );
                              }
                              const r = resolver.resolve(toRaw, { callerIdName: null });
                              return (
                                <span title={toRaw} className="flex items-baseline gap-1.5">
                                  <span>{r.primary}</span>
                                  {r.secondary && (
                                    <span className="text-xs text-muted-foreground">
                                      · {r.secondary}
                                    </span>
                                  )}
                                </span>
                              );
                            })()}
                          </TableCell>
                          {/* "From" cell — pass caller_id_name so the
                        resolver can dual-display "JIO Service · +91
                        63821 36190" when the trunk supplied a name but
                        we have no user match. */}
                          <TableCell className="text-sm">
                            {(() => {
                              const fromRaw = log.from_number || "";
                              if (!fromRaw)
                                return <span className="text-muted-foreground">---</span>;
                              const r = resolver.resolve(fromRaw, {
                                callerIdName: (log as { caller_id_name?: string }).caller_id_name,
                              });
                              return (
                                <span title={fromRaw} className="flex items-baseline gap-1.5">
                                  <span>{r.primary}</span>
                                  {r.secondary && (
                                    <span className="text-xs text-muted-foreground">
                                      · {r.secondary}
                                    </span>
                                  )}
                                </span>
                              );
                            })()}
                          </TableCell>
                          {/* Show talk_time (billsec) rather than duration (billsec+ring) so the
                        displayed value matches the recording audio length. NO ANSWER calls
                        will show 0s here — the Status column already conveys they weren't
                        picked up. */}
                          <TableCell className="text-sm">
                            {formatDuration(log.talk_time || 0)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">
                              {log.direction || "---"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const eff = effectiveCallStatus(log, { orgHasAiAgent });
                              const map: Record<
                                string,
                                {
                                  label: string;
                                  variant: "default" | "secondary" | "destructive" | "outline";
                                }
                              > = {
                                completed: { label: "Completed", variant: "default" },
                                missed: { label: "Missed", variant: "secondary" },
                                abandoned: { label: "Abandoned", variant: "secondary" },
                                ai_handled: { label: "AI Handled", variant: "outline" },
                                busy: { label: "Busy", variant: "destructive" },
                                failed: { label: "Failed", variant: "destructive" },
                              };
                              const m = map[eff];
                              return (
                                <Badge
                                  variant={m.variant}
                                  className="text-xs"
                                  title={`Raw disposition: ${log.disposition}`}
                                >
                                  {m.label}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {(() => {
                              // "Disconnected by" — same resolver as From/To
                              // so a hangup attributed to "9876543210" shows
                              // as "Hari Surya" when that's a registered user.
                              // System / timeout / busy stay as plain labels.
                              const by = (log.disconnected_by || "").toLowerCase();
                              let label: React.ReactNode;
                              if (by === "caller") {
                                const r = resolver.resolve(log.from_number || "");
                                label = r.primary;
                              } else if (by === "callee") {
                                const r = resolver.resolve(log.to_number || "");
                                label = r.primary;
                              } else if (by === "agent") {
                                const ansExt = log.answered_by;
                                const u = ansExt ? resolver.userByExtension(ansExt) : undefined;
                                label = (u && (u.full_name || u.username)) || ansExt || "Agent";
                              } else if (by === "timeout") label = "No answer (timeout)";
                              else if (by === "busy") label = "Busy";
                              else if (by === "system" || by === "normal" || by === "unknown")
                                label = "—";
                              else label = log.disconnected_by || "—";
                              const tooltip = [
                                log.hangup_reason && `Reason: ${log.hangup_reason}`,
                                by &&
                                  !["caller", "callee", "agent"].includes(by) &&
                                  `Source: ${by}`,
                              ]
                                .filter(Boolean)
                                .join(" · ");
                              return (
                                <span className="text-xs" title={tooltip}>
                                  {label}
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {/* Gate on recording_url (set to NULL by the backend when billsec=0)
                          rather than recording_file (pre-filled at originate time before we
                          know if the call will be answered). Prevents a broken Play button
                          on NO ANSWER calls where no audio was ever recorded. */}
                            {log.recording_url ? (
                              (() => {
                                const role =
                                  typeof window !== "undefined"
                                    ? localStorage.getItem("user_role")
                                    : null;
                                const canListen =
                                  !role || ["owner", "admin", "manager"].includes(role);
                                const canDownload = !role || ["owner", "admin"].includes(role);
                                return (
                                  <div className="flex items-center gap-1">
                                    {canListen ? (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1 text-xs"
                                        onClick={() => {
                                          const token =
                                            typeof window !== "undefined"
                                              ? localStorage.getItem("pbx_org_token") || ""
                                              : "";
                                          setPlayingLog({
                                            ...log,
                                            recording_url: `/api/pbx/calls/${log.id}/recording?token=${token}`,
                                          });
                                        }}
                                      >
                                        <Play className="h-3 w-3" />
                                        Play
                                      </Button>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1 text-xs opacity-40"
                                        onClick={() =>
                                          showToast(
                                            "You don't have permission to access recordings",
                                            "error"
                                          )
                                        }
                                      >
                                        <Play className="h-3 w-3" />
                                        Play
                                      </Button>
                                    )}
                                    {canDownload && (
                                      <a
                                        href={`/api/pbx/calls/${log.id}/recording?token=${typeof window !== "undefined" ? localStorage.getItem("pbx_org_token") || "" : ""}`}
                                        download
                                      >
                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                          <Download className="h-3 w-3" />
                                        </Button>
                                      </a>
                                    )}
                                  </div>
                                );
                              })()
                            ) : (
                              <span className="text-xs text-muted-foreground">---</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {log.started_at
                              ? format(new Date(log.started_at), "MMM d, h:mm a")
                              : "---"}
                          </TableCell>
                        </TableRow>
                        {expandedCall ===
                          ((log as { linkedid?: string }).linkedid || log.call_id) && (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/30 p-4">
                              {/*
                          Phone-book-style expansion. Three contact-style
                          cards across the top (caller / routed-to /
                          answered-by) summarise who participated, then
                          the existing call-journey timeline, then a
                          metadata grid (call IDs, hangup reason). Keeps
                          the row scrollable on small screens by laying
                          the cards out in a responsive grid.
                        */}
                              <div className="space-y-4">
                                {/*
                            Each card gets a one-click Call button when the
                            contact is dialable. We skip the button for:
                              - DIDs (your own DIDs aren't useful targets)
                              - "Not answered" (nothing to call)
                              - unknown / empty raw
                            Operator still confirms via the existing dialog.
                          */}
                                <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
                                  {(() => {
                                    const r = resolver.resolve(log.from_number || "", {
                                      callerIdName: (log as { caller_id_name?: string })
                                        .caller_id_name,
                                    });
                                    const callable =
                                      r.kind === "user-ext" ||
                                      r.kind === "user-phone" ||
                                      r.kind === "external";
                                    return (
                                      <ContactCard
                                        label={
                                          log.direction === "outbound" ? "Dialed by" : "Caller"
                                        }
                                        resolved={r}
                                        onCall={
                                          callable ? () => quickCallFromContact(r) : undefined
                                        }
                                      />
                                    );
                                  })()}
                                  {(() => {
                                    const toRaw = log.to_number || "";
                                    const { queueNum } = parseQueueTo(toRaw);
                                    let r: ResolvedContact;
                                    if (queueNum) {
                                      const q = resolver.queueByNumber(queueNum);
                                      r = q
                                        ? {
                                            kind: "queue" as const,
                                            primary: q.name,
                                            secondary: `queue · ${q.number} · ${q.strategy}`,
                                            raw: toRaw,
                                            queue: q,
                                          }
                                        : resolver.resolve(toRaw);
                                    } else {
                                      r = resolver.resolve(toRaw);
                                    }
                                    const callable =
                                      r.kind === "queue" ||
                                      r.kind === "user-ext" ||
                                      r.kind === "user-phone" ||
                                      r.kind === "external";
                                    return (
                                      <ContactCard
                                        label="Routed to"
                                        resolved={r}
                                        onCall={
                                          callable ? () => quickCallFromContact(r) : undefined
                                        }
                                      />
                                    );
                                  })()}
                                  {(() => {
                                    const ansExt =
                                      log.answered_by || parseQueueTo(log.to_number || "").ansExt;
                                    let r: ResolvedContact;
                                    if (!ansExt) {
                                      r = {
                                        kind: "unknown" as const,
                                        primary: "Not answered",
                                        raw: "",
                                      };
                                    } else {
                                      const u = resolver.userByExtension(ansExt);
                                      r = u
                                        ? {
                                            kind: "user-ext" as const,
                                            primary: u.full_name || u.username,
                                            secondary: `ext ${u.extension}`,
                                            raw: ansExt,
                                            user: u,
                                          }
                                        : {
                                            kind: "external" as const,
                                            primary: `ext ${ansExt}`,
                                            raw: ansExt,
                                          };
                                    }
                                    const callable = r.kind === "user-ext";
                                    return (
                                      <ContactCard
                                        label="Answered by"
                                        resolved={r}
                                        onCall={
                                          callable ? () => quickCallFromContact(r) : undefined
                                        }
                                      />
                                    );
                                  })()}
                                </div>

                                {journeyLoading ? (
                                  <p className="text-sm text-muted-foreground">
                                    Loading call journey…
                                  </p>
                                ) : journey ? (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-4 text-sm">
                                      <span className="font-medium">Call journey</span>
                                      <Badge
                                        variant={
                                          journey.status === "answered" ? "default" : "secondary"
                                        }
                                      >
                                        {journey.status}
                                      </Badge>
                                      <span className="text-muted-foreground">
                                        {journey.total_duration}s total
                                      </span>
                                    </div>
                                    <div className="space-y-1">
                                      {journey.steps
                                        .filter((s) => !s.channel.includes("UnicastRTP"))
                                        .map((step, i) => {
                                          // Rewrite step labels using the resolver
                                          // so "Dial 9876543210" becomes "Dial
                                          // Hari Surya" etc. The raw target lives
                                          // on `step.to` or in the action string.
                                          // Server now resolves `qm<hex>` → "Full Name (ext NNNN)"
                                          // and `Queue <num>` → `Queue <name>` in the journey
                                          // endpoint, so most actions arrive operator-ready.
                                          // The regex below only fires when a single-token
                                          // raw target slips through (bare extension or queue
                                          // number) and falls back to client-side resolution.
                                          const m = step.action.match(
                                            /^(Dial|Ring|Queue)\s+(\S+)$/
                                          );
                                          let prettyAction: React.ReactNode = step.action;
                                          if (m) {
                                            const verb = m[1];
                                            const target = m[2];
                                            const ext = target.startsWith("qm") ? null : target;
                                            const u = ext ? resolver.userByExtension(ext) : null;
                                            const q = ext ? resolver.queueByNumber(ext) : null;
                                            if (q) prettyAction = `${verb} ${q.name}`;
                                            else if (u)
                                              prettyAction = `${verb} ${u.full_name || u.username} (ext ${u.extension})`;
                                            else if (!target.startsWith("qm")) {
                                              const r = resolver.resolve(target);
                                              prettyAction = `${verb} ${r.primary}`;
                                            }
                                            // `qm<hex>` that didn't get resolved server-side
                                            // (rare — only if the queue_member row is gone):
                                            // keep step.action verbatim so we don't render a
                                            // misleading "Ring qm…" with no context.
                                          }
                                          return (
                                            <div
                                              key={i}
                                              className="flex items-center gap-3 text-xs border-l-2 border-muted-foreground/20 pl-3 py-1"
                                            >
                                              <span className="text-muted-foreground w-16 shrink-0">
                                                {format(new Date(step.time), "h:mm:ss a")}
                                              </span>
                                              <span
                                                className="font-medium flex-1 min-w-0 truncate"
                                                title={step.action}
                                              >
                                                {prettyAction}
                                              </span>
                                              <Badge
                                                variant={
                                                  step.status === "ANSWERED"
                                                    ? "default"
                                                    : "secondary"
                                                }
                                                className="text-[10px]"
                                              >
                                                {step.status}
                                              </Badge>
                                              {step.duration > 0 && (
                                                <span className="text-muted-foreground w-12 text-right">
                                                  {step.duration}s
                                                </span>
                                              )}
                                            </div>
                                          );
                                        })}
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground">No journey data</p>
                                )}

                                {/* Metadata grid — IDs + hangup reason. */}
                                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 text-xs pt-2 border-t border-border/60">
                                  <MetaRow label="Call ID" value={log.call_id} />
                                  <MetaRow
                                    label="Linked ID"
                                    value={(log as { linkedid?: string }).linkedid || "—"}
                                  />
                                  <MetaRow label="Hangup reason" value={log.hangup_reason || "—"} />
                                  <MetaRow
                                    label="Started"
                                    value={
                                      log.started_at
                                        ? format(new Date(log.started_at), "PPpp")
                                        : "—"
                                    }
                                  />
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {totalPages > 0 && (
              <div className="border-t border-border/50 bg-muted/30 px-4 py-3 sticky bottom-0 z-10 flex items-center justify-between">
                <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                  Page {page} of {totalPages}
                </div>
                <div className="flex w-full items-center gap-8 lg:w-fit">
                  <div className="hidden items-center gap-2 lg:flex">
                    <Label className="text-sm font-medium">Rows per page</Label>
                    <Select
                      value={`${pageSize}`}
                      onValueChange={(value) => {
                        setPageSize(Number(value));
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue placeholder={pageSize} />
                      </SelectTrigger>
                      <SelectContent side="top">
                        {[10, 20, 30, 40, 50].map((size) => (
                          <SelectItem key={size} value={`${size}`}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex w-fit items-center justify-center text-sm font-medium">
                    Page {page} of {totalPages || 1}
                  </div>
                  <div className="ml-auto flex items-center gap-2 lg:ml-0">
                    <Button
                      variant="outline"
                      className="hidden h-8 w-8 p-0 lg:flex"
                      onClick={() => loadHistory(1)}
                      disabled={page <= 1}
                    >
                      <span className="sr-only">Go to first page</span>
                      <ChevronsLeft className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="size-8"
                      size="icon"
                      onClick={() => loadHistory(page - 1)}
                      disabled={page <= 1}
                    >
                      <span className="sr-only">Go to previous page</span>
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="size-8"
                      size="icon"
                      onClick={() => loadHistory(page + 1)}
                      disabled={!hasMore}
                    >
                      <span className="sr-only">Go to next page</span>
                      <ChevronRight className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="hidden size-8 lg:flex"
                      size="icon"
                      onClick={() => loadHistory(totalPages)}
                      disabled={!hasMore}
                    >
                      <span className="sr-only">Go to last page</span>
                      <ChevronsRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Audio Player Popup */}
      {playingLog && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg">
          <div className="bg-card border rounded-xl shadow-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-medium">{playingLog.from_number || "Unknown"}</span>
                <span className="text-muted-foreground mx-1.5">&rarr;</span>
                <span>{playingLog.to_number || "---"}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {playingLog.started_at
                    ? format(new Date(playingLog.started_at), "MMM d, h:mm a")
                    : ""}
                </span>
                {playingLog.duration > 0 && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    {formatDuration(playingLog.duration)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <a href={playingLog.recording_url} download>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setPlayingLog(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <AudioPlayerProvider key={String(playingLog.id)}>
              <AutoPlayTrack src={playingLog.recording_url} id={String(playingLog.id)} />
              <div className="flex items-center gap-3">
                <AudioPlayerButton
                  item={{ id: String(playingLog.id), src: playingLog.recording_url }}
                  size="sm"
                  className="h-8 w-8 shrink-0"
                />
                <AudioPlayerProgress className="flex-1" />
                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 tabular-nums">
                  <AudioPlayerTime />
                  <span>/</span>
                  <AudioPlayerDuration fallbackSeconds={playingLog.duration} />
                </div>
              </div>
            </AudioPlayerProvider>
          </div>
        </div>
      )}

      {/* Transfer Dialog */}
      <Dialog open={!!transferChannel} onOpenChange={(open) => !open && setTransferChannel(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Transfer Call</DialogTitle>
            <DialogDescription>Search for a user or enter an extension number</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Transfer To</Label>
              <Select
                value={transferType}
                onValueChange={(v) => setTransferType(v as "extension" | "queue" | "external")}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="extension">Extension</SelectItem>
                  <SelectItem value="queue">Queue</SelectItem>
                  <SelectItem value="external">External Number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {transferType === "extension" && (
              <>
                <Input
                  placeholder="Search by name or extension..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
                {userSearch && filteredUsers.length > 0 && (
                  <div className="border rounded-md max-h-40 overflow-y-auto">
                    {filteredUsers.map((u) => (
                      <button
                        key={u.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between"
                        onClick={() => {
                          setTransferDest(u.extension);
                          setUserSearch("");
                        }}
                      >
                        <span>{u.full_name || u.username}</span>
                        <span className="text-muted-foreground font-mono text-xs">
                          {u.extension}
                          {u.phone_number ? ` · ${u.phone_number}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {transferType === "external" && phonebook.length > 0 && (
              <div className="border rounded-md max-h-40 overflow-y-auto">
                <p className="text-[10px] text-muted-foreground px-3 pt-1.5">Phonebook</p>
                {phonebook
                  .filter(
                    (c) =>
                      !userSearch ||
                      c.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                      c.number.includes(userSearch)
                  )
                  .map((c, i) => (
                    <button
                      key={i}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex justify-between"
                      onClick={() => {
                        setTransferDest(c.number);
                      }}
                    >
                      <span>{c.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">{c.number}</span>
                    </button>
                  ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Destination</Label>
              <Input
                value={transferDest}
                onChange={(e) => setTransferDest(e.target.value)}
                placeholder={
                  transferType === "external"
                    ? "Phone number e.g. 7667745279"
                    : transferType === "queue"
                      ? "Queue number e.g. 5001"
                      : "Extension e.g. 1001"
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferChannel(null)}>
              Cancel
            </Button>
            <Button onClick={handleTransfer} disabled={!transferDest}>
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Small presentational components for the expanded call-log row.
// Kept in the same file to avoid creating a directory of micro-files
// for what's effectively one feature's UI.

function ContactCard({
  label,
  resolved,
  onCall,
}: {
  label: string;
  resolved: ResolvedContact;
  // When set, renders a "Call" button on the card that fires this
  // handler. We deliberately route through a parent handler (which
  // pre-fills the existing Initiate Call dialog) instead of dialing
  // straight from the card — operator still gets to pick their own
  // "from" extension and confirm before the call fires. Cards that
  // can't usefully be dialed (DID, "Not answered") leave it undefined.
  onCall?: () => void;
}) {
  const tag =
    resolved.kind === "queue"
      ? "Queue"
      : resolved.kind === "user-ext"
        ? "Internal"
        : resolved.kind === "user-phone"
          ? "User"
          : resolved.kind === "did"
            ? "DID"
            : resolved.kind === "external"
              ? "External"
              : "—";
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[10px]">
            {tag}
          </Badge>
          {onCall && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              title={`Call ${resolved.primary}`}
              onClick={(e) => {
                e.stopPropagation();
                onCall();
              }}
            >
              <Phone className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm font-medium truncate" title={resolved.raw}>
        {resolved.primary}
      </p>
      {resolved.secondary && (
        <p className="text-xs text-muted-foreground truncate">{resolved.secondary}</p>
      )}
      {resolved.user?.extension && resolved.kind === "user-phone" && (
        <p className="text-[10px] text-muted-foreground">ext {resolved.user.extension}</p>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="font-mono truncate" title={value}>
        {value}
      </span>
    </div>
  );
}
