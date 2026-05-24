"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  PhoneOff,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  BookOpen,
  Plus,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { showToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import {
  calls as pbxCalls,
  users as pbxUsers,
  queues as pbxQueues,
  type PbxUser,
  type PbxQueue,
} from "@/lib/pbx/client";
import { InitiateCallDialog } from "@/components/calls/initiate-call-dialog";
import { ASTRAPBX_ROOT } from "@/lib/firebase/firestore";
import { db as firestoreDb } from "@/lib/firebase/config";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

function formatDuration(secs: number) {
  if (!secs) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function LiveCallsPage() {
  const { orgId } = useParams<{ orgId: string }>();

  // Live calls state
  const [liveCalls, setLiveCalls] = useState<Record<string, unknown>[]>([]);
  const [livePage, setLivePage] = useState(1);
  const [livePageSize, setLivePageSize] = useState(10);
  const [liveLoading, setLiveLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Users + queues for the per-row transfer popover. Loaded once on mount.
  const [userList, setUserList] = useState<PbxUser[]>([]);
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);

  // Phonebook
  const [phonebook, setPhonebook] = useState<{ name: string; number: string }[]>([]);
  const [phonebookOpen, setPhonebookOpen] = useState(false);
  const [newContact, setNewContact] = useState({ name: "", number: "" });

  // Poll live calls every 3 seconds — no loading flicker on subsequent polls
  const isFirstLoad = useRef(true);
  const prevCallCount = useRef(0);

  async function refreshLive() {
    try {
      if (isFirstLoad.current) setLiveLoading(true);
      const data = await pbxCalls.live();
      const calls = Array.isArray(data) ? data : [];
      // Anti-flicker: if we had calls and now get 0, it's likely a stale AMI response.
      // Keep previous data for one more poll before clearing.
      if (calls.length === 0 && prevCallCount.current > 0) {
        prevCallCount.current = 0;
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

  useEffect(() => {
    pbxUsers.list().then(setUserList).catch(() => {});
    pbxQueues.list().then(setQueueList).catch(() => {});
  }, []);

  // Load phonebook from Firestore (shared across all agents)
  useEffect(() => {
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
    try {
      await setDoc(doc(firestoreDb!, ASTRAPBX_ROOT, orgId, "settings", "phonebook"), { contacts: entries });
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

  async function handleHangup(channelId: string) {
    try {
      await pbxCalls.hangup(channelId);
      showToast("Call ended", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Hangup failed", "error");
    }
  }

  async function handleStopMonitor(channelId: string) {
    try {
      await pbxCalls.stopMonitor(channelId);
      showToast("Monitoring stopped", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Stop monitoring failed", "error");
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header — same shape as Call Logs page so the two pages
          read as siblings. Initiate Call dialog is shared via the
          InitiateCallDialog component. */}
      <div className="p-6 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Live Calls</h1>
            <p className="text-sm text-muted-foreground">Monitor in-progress calls and take action — transfer, listen, barge, hangup</p>
          </div>
          <InitiateCallDialog />
        </div>
      </div>

      <div className="px-6">
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Auto-refreshing every 3s {lastRefresh && `· Last: ${lastRefresh.toLocaleTimeString()}`}
            </p>
            <div className="flex gap-1.5">
              <Dialog open={phonebookOpen} onOpenChange={setPhonebookOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <BookOpen className="h-3 w-3" />
                    Phonebook
                    {phonebook.length > 0 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{phonebook.length}</Badge>}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Phonebook</DialogTitle>
                    <DialogDescription>Save contacts for quick transfer</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div className="flex gap-2">
                      <Input placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} className="h-8 text-xs" />
                      <Input placeholder="Number" value={newContact.number} onChange={(e) => setNewContact({ ...newContact, number: e.target.value })} className="h-8 text-xs" />
                      <Button size="sm" className="h-8 shrink-0" onClick={addContact}><Plus className="h-3 w-3" /></Button>
                    </div>
                    {phonebook.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No contacts yet</p>
                    ) : (
                      <div className="space-y-1 max-h-60 overflow-y-auto">
                        {phonebook.map((c, i) => (
                          <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/50 text-sm">
                            <div>
                              <span className="font-medium">{c.name}</span>
                              <span className="text-muted-foreground ml-2 font-mono text-xs">{c.number}</span>
                            </div>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeContact(i)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={refreshLive} disabled={liveLoading}>
                <RefreshCw className={`h-3 w-3 ${liveLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Table container sizes to its content rather than viewport — see
              feedback note in PR description. flex-1/min-h-0 removed so the
              card collapses to the table's natural height. */}
          <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden mb-5">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50 border-b">
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
                    <TableSkeleton cols={7} />
                  ) : liveCalls.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No active calls</TableCell></TableRow>
                  ) : liveCalls.slice((livePage - 1) * livePageSize, livePage * livePageSize).map((call) => {
                    const number = String(call.from || call.from_number || "---");
                    const direction = String(call.direction || "unknown");
                    const status = String(call.status || "unknown");
                    const agent = String(call.to || call.to_number || call.extension || "---");
                    const callerId = String(call.caller_id || call.caller_id_name || call.from_name || "<unknown>");

                    const statusLabel = status === "answered" || status === "Up" ? "Answered" : status === "ringing" || status === "Ring" ? "Ringing" : status;
                    const statusVariant = statusLabel === "Answered" ? "default" : "secondary";

                    const channelId = String(call.channel_id);

                    return (
                      <TableRow key={channelId}>
                        <TableCell className="font-mono font-medium">{number}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">{direction === "inbound" ? "Incoming" : direction === "outbound" ? "Outgoing" : direction}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{callerId || "---"}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant as "default" | "secondary"} className="text-xs">{statusLabel}</Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">{formatDuration(Number(call.duration) || 0)}</TableCell>
                        <TableCell className="text-sm">{agent}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Live "Monitored" indicator. Visible only when a
                                supervisor is currently attached to this
                                channel. Amber pulse-dot signals the active
                                state at a glance, paired with the "Stop"
                                button on the right of this group. */}
                            {!!call.monitoring && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                                Monitored
                              </span>
                            )}
                            <ActionPopover
                              label="Transfer"
                              userList={userList}
                              queueList={queueList}
                              phonebook={phonebook}
                              onSelect={async (dest, kind) => {
                                await pbxCalls.transfer(channelId, dest, kind);
                                showToast("Call transferred", "success");
                              }}
                            />
                            <ActionPopover
                              label="Monitor"
                              userList={userList}
                              queueList={queueList}
                              phonebook={phonebook}
                              modes={["extension", "external"]}
                              onSelect={async (dest) => {
                                await pbxCalls.monitor(channelId, dest, "spy");
                                showToast("Monitoring started", "success");
                              }}
                            />
                            <ActionPopover
                              label="Whisper"
                              userList={userList}
                              queueList={queueList}
                              phonebook={phonebook}
                              modes={["extension", "external"]}
                              onSelect={async (dest) => {
                                await pbxCalls.monitor(channelId, dest, "whisper");
                                showToast("Whisper started", "success");
                              }}
                            />
                            <ActionPopover
                              label="Barge"
                              userList={userList}
                              queueList={queueList}
                              phonebook={phonebook}
                              modes={["extension", "external"]}
                              onSelect={async (dest) => {
                                await pbxCalls.monitor(channelId, dest, "barge");
                                showToast("Barged in", "success");
                              }}
                            />
                            {!!call.monitoring && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs text-amber-700 border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                                onClick={() => handleStopMonitor(channelId)}
                              >
                                Stop
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              title="Hangup"
                              onClick={() => handleHangup(channelId)}
                            >
                              <PhoneOff className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {liveCalls.length > 10 && (
              <div className="border-t border-border/50 bg-muted/30 px-4 py-3 flex items-center justify-between">
                <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                  Showing {(livePage - 1) * livePageSize + 1}–{Math.min(livePage * livePageSize, liveCalls.length)} of {liveCalls.length} entries
                </div>
                <div className="flex w-full items-center gap-8 lg:w-fit">
                  <div className="hidden items-center gap-2 lg:flex">
                    <Label className="text-sm font-medium">Rows per page</Label>
                    <Select value={`${livePageSize}`} onValueChange={(value) => { setLivePageSize(Number(value)); setLivePage(1); }}>
                      <SelectTrigger className="w-20">
                        <SelectValue placeholder={livePageSize} />
                      </SelectTrigger>
                      <SelectContent side="top">
                        {[10, 20, 30, 40, 50].map((size) => (
                          <SelectItem key={size} value={`${size}`}>{size}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex w-fit items-center justify-center text-sm font-medium">
                    Page {livePage} of {Math.ceil(liveCalls.length / livePageSize) || 1}
                  </div>
                  <div className="ml-auto flex items-center gap-2 lg:ml-0">
                    <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => setLivePage(1)} disabled={livePage <= 1}>
                      <span className="sr-only">Go to first page</span>
                      <ChevronsLeft className="size-4" />
                    </Button>
                    <Button variant="outline" className="size-8" size="icon" onClick={() => setLivePage(p => p - 1)} disabled={livePage <= 1}>
                      <span className="sr-only">Go to previous page</span>
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button variant="outline" className="size-8" size="icon" onClick={() => setLivePage(p => p + 1)} disabled={livePage * livePageSize >= liveCalls.length}>
                      <span className="sr-only">Go to next page</span>
                      <ChevronRight className="size-4" />
                    </Button>
                    <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => setLivePage(Math.ceil(liveCalls.length / livePageSize))} disabled={livePage * livePageSize >= liveCalls.length}>
                      <span className="sr-only">Go to last page</span>
                      <ChevronsRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Generalised per-row action popover. Anchored on a row action button (Transfer,
 * Monitor, Whisper, Barge); opens the same 3-tab destination picker
 * (Extension / Queue / External) regardless of action. The caller passes an
 * `onSelect` callback that knows which `pbxCalls.*` method to invoke — keeps
 * the popover UI a thin reusable shell and pushes API semantics to the
 * caller. Extension + Queue use the Command pattern for type-ahead search;
 * the ~5-row cap with scroll keeps the popover compact even for orgs with
 * many users. External shows an input + an inline phonebook quick-pick list.
 *
 * Errors thrown by `onSelect` surface as a toast; the popover stays open so
 * the operator can retry. Success closes the popover and resets local state.
 * The success toast is the caller's responsibility (different copy per
 * action: "Call transferred" vs "Monitoring started" etc.).
 */
type ActionMode = "extension" | "queue" | "external";
const DEFAULT_ACTION_MODES: ActionMode[] = ["extension", "queue", "external"];

function ActionPopover({
  label,
  userList,
  queueList,
  phonebook,
  onSelect,
  modes = DEFAULT_ACTION_MODES,
}: {
  label: string;
  userList: PbxUser[];
  queueList: PbxQueue[];
  phonebook: { name: string; number: string }[];
  onSelect: (destination: string, kind: ActionMode) => Promise<void>;
  /**
   * Which destination tabs to expose. Defaults to all three. Monitor /
   * Whisper / Barge pass `["extension", "external"]` because a queue isn't
   * a valid supervisor target — supervision attaches a single SIP endpoint
   * (or external number) to the bridged channel.
   */
  modes?: ActionMode[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ActionMode>(modes[0]);
  const [external, setExternal] = useState("");

  async function pick(dest: string, kind: "extension" | "queue" | "external") {
    if (!dest) return;
    try {
      await onSelect(dest, kind);
      setOpen(false);
      setExternal("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : `${label} failed`, "error");
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        {/* Mode tabs — rendered only for modes this caller exposes. */}
        <div className="flex border-b">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 px-3 py-2 text-xs capitalize transition-colors",
                mode === m
                  ? "border-b-2 border-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "extension" && (
          <Command>
            <CommandInput placeholder="Search name or extension…" className="h-9" />
            {/* ~5 rows of ~36px each + room for the empty state */}
            <CommandList className="max-h-[200px]">
              <CommandEmpty>No users found.</CommandEmpty>
              <CommandGroup>
                {userList.filter((u) => u.status === "active").map((u) => (
                  <CommandItem
                    key={u.id}
                    value={`${u.full_name || ""} ${u.username} ${u.extension} ${u.phone_number || ""}`}
                    onSelect={() => pick(u.extension, "extension")}
                  >
                    <span className="flex-1 truncate">{u.full_name || u.username}</span>
                    <span className="text-muted-foreground font-mono text-[10px] ml-2">{u.extension}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}

        {mode === "queue" && (
          <Command>
            <CommandInput placeholder="Search queues…" className="h-9" />
            <CommandList className="max-h-[200px]">
              <CommandEmpty>No queues found.</CommandEmpty>
              <CommandGroup>
                {queueList.filter((q) => q.status === "active").map((q) => (
                  <CommandItem
                    key={q.id}
                    value={`${q.name} ${q.number}`}
                    onSelect={() => pick(q.number, "queue")}
                  >
                    <span className="flex-1 truncate">{q.name}</span>
                    <span className="text-muted-foreground font-mono text-[10px] ml-2">{q.number}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}

        {mode === "external" && (
          <div className="p-3 space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="e.g. 9944421125"
                value={external}
                onChange={(e) => setExternal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") pick(external.trim(), "external"); }}
                className="h-8 text-xs"
                autoFocus
              />
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={!external.trim()}
                onClick={() => pick(external.trim(), "external")}
              >
                {label}
              </Button>
            </div>
            {phonebook.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Phonebook</p>
                <div className="max-h-[140px] overflow-y-auto -mx-1">
                  {phonebook.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pick(c.number, "external")}
                      className="w-full text-left px-2 py-1 text-xs rounded hover:bg-accent flex justify-between"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="text-muted-foreground font-mono ml-2">{c.number}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
