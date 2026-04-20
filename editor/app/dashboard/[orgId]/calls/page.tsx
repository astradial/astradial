"use client";

import { useParams } from "next/navigation";
import { useEffect, useId, useMemo, useState, useCallback, useRef } from "react";
import { format } from "date-fns";
import { Phone, PhoneOff, ArrowRightLeft, Play, Download, RefreshCw, BookOpen, Plus, Trash2, Ear, Mic, UserPlus } from "lucide-react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconLoader,
} from "@tabler/icons-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DragHandle, DraggableRow } from "@/components/ui/data-table-parts";
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
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Separator } from "@/components/ui/separator";
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
import { calls as pbxCalls, users as pbxUsers, queues as pbxQueues, dids as pbxDids, clickToCall, type PbxUser, type PbxQueue, type PbxDid, type CallHistoryItem, type CallJourney } from "@/lib/pbx/client";
import {
  AudioPlayerButton,
  AudioPlayerDuration,
  AudioPlayerProgress,
  AudioPlayerProvider,
  AudioPlayerTime,
  useAudioPlayer,
} from "@/components/ui/audio-player";
import { useIsMobile } from "@/hooks/use-mobile";

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

function formatDuration(secs: number) {
  if (!secs) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function CallsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const isMobile = useIsMobile();

  // Live calls state
  const [liveCalls, setLiveCalls] = useState<Record<string, unknown>[]>([]);
  const [liveLoading, setLiveLoading] = useState(true);

  // Call history state
  const [logs, setLogs] = useState<CallHistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit, setLimit] = useState(20);
  const [directionFilter, setDirectionFilter] = useState<string>("");

  // Journey drawer state
  const [drawerCall, setDrawerCall] = useState<CallHistoryItem | null>(null);
  const [journey, setJourney] = useState<CallJourney | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [playingLog, setPlayingLog] = useState<(CallHistoryItem & { recording_url: string }) | null>(null);

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
    from: "", from_type: "extension" as "extension" | "external",
    to: "", to_type: "extension" as "extension" | "queue" | "external",
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

  // Load call history from PBX API
  const loadHistory = useCallback(async (p = 1, lim = limit) => {
    setHistoryLoading(true);
    try {
      const result = await pbxCalls.history({
        page: p,
        limit: lim,
        direction: directionFilter || undefined,
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
  }, [orgId, directionFilter, limit]);

  useEffect(() => {
    loadHistory(1);
  }, [orgId, directionFilter]);

  // Load users + queues + DIDs for transfer/initiate
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);
  const [didList, setDidList] = useState<PbxDid[]>([]);
  useEffect(() => {
    pbxUsers.list().then(setUserList).catch(() => {});
    pbxQueues.list().then(setQueueList).catch(() => {});
    pbxDids.list().then((dids) => {
      setDidList(dids.filter((d) => d.status === "active"));
      // Set default caller ID to first active DID
      if (dids.length > 0) {
        setCallForm((f) => ({ ...f, caller_id: dids[0].number }));
      }
    }).catch(() => {});
  }, []);

  // Initiate call
  async function handleInitiateCall() {
    if (!callForm.from || !callForm.to) return;
    setInitiating(true);
    try {
      await clickToCall.initiate({
        from: callForm.from, from_type: callForm.from_type,
        to: callForm.to, to_type: callForm.to_type,
        caller_id: callForm.caller_id,
      });
      showToast("Call initiated — ringing 'From' first, then connecting to 'To'", "success");
      setInitiateOpen(false);
      setCallForm({ from: "", from_type: "extension", to: "", to_type: "extension", caller_id: "08065978002" });
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed to initiate call", "error"); }
    finally { setInitiating(false); }
  }

  // Load phonebook from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`phonebook_${orgId}`);
      if (saved) setPhonebook(JSON.parse(saved));
    } catch {}
  }, [orgId]);

  function savePhonebook(entries: { name: string; number: string }[]) {
    setPhonebook(entries);
    try {
      localStorage.setItem(`phonebook_${orgId}`, JSON.stringify(entries));
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
      console.log("Transfer:", { channel: transferChannel, dest: transferDest, type: transferType });
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

  const filteredUsers = userList.filter((u) =>
    `${u.full_name || ""} ${u.username} ${u.extension} ${u.phone_number || ""}`.toLowerCase().includes(userSearch.toLowerCase())
  );

  // Strip phone to last 10 digits
  function cleanPhone(val: string) {
    const digits = val.replace(/\D/g, "");
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  // Open journey drawer — load journey for the clicked CDR row
  const openJourney = useCallback(async (log: CallHistoryItem) => {
    setDrawerCall(log);
    setJourney(null);
    setJourneyLoading(true);
    try {
      const lid = log.linkedid || log.call_id;
      const j = await pbxCalls.journey(lid);
      setJourney(j);
    } catch {
      setJourney(null);
    } finally {
      setJourneyLoading(false);
    }
  }, []);

  // Play recording (sets playingLog that renders inside the drawer)
  const playRecording = useCallback((log: CallHistoryItem) => {
    if (!log.recording_url) return;
    const token = typeof window !== "undefined" ? localStorage.getItem("pbx_org_token") || "" : "";
    setPlayingLog({ ...log, recording_url: `/api/pbx/calls/${log.id}/recording?token=${token}` });
  }, []);

  // ── Call History data-table wiring ──────────────────────────────────────
  const columns: ColumnDef<CallHistoryItem>[] = useMemo(() => [
    {
      id: "drag",
      header: () => null,
      cell: ({ row }) => <DragHandle id={row.original.id} />,
    },
    {
      id: "select",
      header: ({ table }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "from_number",
      header: "From",
      cell: ({ row }) => <span className="text-sm">{row.original.from_number || "---"}</span>,
    },
    {
      accessorKey: "to_number",
      header: "To",
      cell: ({ row }) => <span className="text-sm">{row.original.to_number || "---"}</span>,
    },
    {
      accessorKey: "talk_time",
      header: "Duration",
      cell: ({ row }) => <span className="text-sm">{formatDuration(row.original.talk_time || 0)}</span>,
    },
    {
      accessorKey: "direction",
      header: "Direction",
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs capitalize">
          {row.original.direction || "---"}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="outline" className="px-1.5 text-muted-foreground capitalize">
          {row.original.status === "ANSWERED" ? (
            <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
          ) : (
            <IconLoader />
          )}
          {row.original.status || "---"}
        </Badge>
      ),
    },
    {
      id: "recording",
      header: "Recording",
      cell: ({ row }) => {
        const log = row.original;
        if (!log.recording_url) return <span className="text-xs text-muted-foreground">---</span>;
        const role = typeof window !== "undefined" ? localStorage.getItem("user_role") : null;
        const canListen = !role || ["owner", "admin", "manager"].includes(role);
        const canDownload = !role || ["owner", "admin"].includes(role);
        return (
          <div className="flex items-center gap-1">
            {canListen ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-xs"
                onClick={(e) => { e.stopPropagation(); playRecording(log); }}
              >
                <Play className="h-3 w-3" />Play
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-xs opacity-40"
                onClick={(e) => { e.stopPropagation(); showToast("You don't have permission to access recordings", "error"); }}
              >
                <Play className="h-3 w-3" />Play
              </Button>
            )}
            {canDownload && (
              <a
                href={`/api/pbx/calls/${log.id}/recording?token=${typeof window !== "undefined" ? localStorage.getItem("pbx_org_token") || "" : ""}`}
                download
                onClick={(e) => e.stopPropagation()}
              >
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <Download className="h-3 w-3" />
                </Button>
              </a>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "started_at",
      header: () => <div className="text-right">Time</div>,
      cell: ({ row }) => (
        <div className="text-right text-sm text-muted-foreground">
          {row.original.started_at ? format(new Date(row.original.started_at), "MMM d, h:mm a") : "---"}
        </div>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const log = row.original;
        const role = typeof window !== "undefined" ? localStorage.getItem("user_role") : null;
        const canListen = !role || ["owner", "admin", "manager"].includes(role);
        const canDownload = !role || ["owner", "admin"].includes(role);
        const token = typeof window !== "undefined" ? localStorage.getItem("pbx_org_token") || "" : "";
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex size-8 text-muted-foreground data-[state=open]:bg-muted"
                size="icon"
              >
                <IconDotsVertical />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => openJourney(log)}>
                View Journey
              </DropdownMenuItem>
              {log.recording_url && canListen && (
                <DropdownMenuItem onClick={() => playRecording(log)}>
                  <Play className="h-4 w-4 mr-2" />Play Recording
                </DropdownMenuItem>
              )}
              {log.recording_url && canDownload && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={`/api/pbx/calls/${log.id}/recording?token=${token}`} download>
                      <Download className="h-4 w-4 mr-2" />Download Recording
                    </a>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ], [openJourney, playRecording]);

  const [data, setData] = useState<CallHistoryItem[]>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const sortableId = useId();
  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  useEffect(() => { setData(logs); }, [logs]);
  const dataIds = useMemo<UniqueIdentifier[]>(() => data.map((l) => l.id), [data]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination: { pageIndex: page - 1, pageSize: limit },
    },
    manualPagination: true,
    pageCount: totalPages,
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setData((prev) => {
        const oldIndex = dataIds.indexOf(active.id);
        const newIndex = dataIds.indexOf(over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header */}
      <div className="p-6 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
            <p className="text-sm text-muted-foreground">Monitor live calls and view call history</p>
          </div>
          <Dialog open={initiateOpen} onOpenChange={setInitiateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Phone className="h-4 w-4 mr-1.5" />Initiate Call</Button>
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
                    <Select value={callForm.from_type} onValueChange={(v) => setCallForm({ ...callForm, from_type: v as "extension" | "external", from: "" })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="extension">Extension</SelectItem>
                        <SelectItem value="external">Phone Number</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="col-span-2">
                      {callForm.from_type === "extension" ? (
                        <Select value={callForm.from} onValueChange={(v) => setCallForm({ ...callForm, from: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select extension" /></SelectTrigger>
                          <SelectContent>{userList.filter((u) => u.status === "active").map((u) => (
                            <SelectItem key={u.id} value={u.extension}>{u.extension} — {u.full_name || u.username}</SelectItem>
                          ))}</SelectContent>
                        </Select>
                      ) : (
                        <Input value={callForm.from} onChange={(e) => setCallForm({ ...callForm, from: cleanPhone(e.target.value) })} placeholder="9944421125" maxLength={10} className="h-8 text-xs" />
                      )}
                    </div>
                  </div>
                </div>
                {/* To */}
                <div className="space-y-1.5">
                  <Label>To (connected after From answers)</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Select value={callForm.to_type} onValueChange={(v) => setCallForm({ ...callForm, to_type: v as "extension" | "queue" | "external", to: "" })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="extension">Extension</SelectItem>
                        <SelectItem value="queue">Queue</SelectItem>
                        <SelectItem value="external">Phone Number</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="col-span-2">
                      {callForm.to_type === "extension" ? (
                        <Select value={callForm.to} onValueChange={(v) => setCallForm({ ...callForm, to: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select extension" /></SelectTrigger>
                          <SelectContent>{userList.filter((u) => u.status === "active").map((u) => (
                            <SelectItem key={u.id} value={u.extension}>{u.extension} — {u.full_name || u.username}</SelectItem>
                          ))}</SelectContent>
                        </Select>
                      ) : callForm.to_type === "queue" ? (
                        <Select value={callForm.to} onValueChange={(v) => setCallForm({ ...callForm, to: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select queue" /></SelectTrigger>
                          <SelectContent>{queueList.filter((q) => q.status === "active").map((q) => (
                            <SelectItem key={q.id} value={q.number}>{q.number} — {q.name}</SelectItem>
                          ))}</SelectContent>
                        </Select>
                      ) : (
                        <Input value={callForm.to} onChange={(e) => setCallForm({ ...callForm, to: cleanPhone(e.target.value) })} placeholder="9944421125" maxLength={10} className="h-8 text-xs" />
                      )}
                    </div>
                  </div>
                </div>
                {/* Caller ID — from DID list */}
                <div className="space-y-1.5">
                  <Label>Caller ID</Label>
                  {didList.length > 1 ? (
                    <Select value={callForm.caller_id} onValueChange={(v) => setCallForm({ ...callForm, caller_id: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select DID" /></SelectTrigger>
                      <SelectContent>
                        {didList.map((d) => (
                          <SelectItem key={d.id} value={d.number}>{d.number}{d.description ? ` — ${d.description}` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={callForm.caller_id} disabled className="h-8 text-xs bg-muted" />
                  )}
                  <p className="text-[10px] text-muted-foreground">Number shown to the 'To' party</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInitiateOpen(false)}>Cancel</Button>
                <Button onClick={handleInitiateCall} disabled={!callForm.from || !callForm.to || initiating}>
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
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{liveCalls.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Live Calls */}
        <TabsContent value="live" className="mt-4 space-y-3">
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
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
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
                ) : liveCalls.map((call) => {
                  const number = String(call.from || call.from_number || "---");
                  const direction = String(call.direction || "unknown");
                  const status = String(call.status || "unknown");
                  const agent = String(call.to || call.to_number || call.extension || "---");
                  const callerId = String(call.caller_id || call.caller_id_name || call.from_name || "<unknown>");

                  const statusLabel = status === "answered" || status === "Up" ? "Answered" : status === "ringing" || status === "Ring" ? "Ringing" : status;
                  const statusVariant = statusLabel === "Answered" ? "default" : "secondary";

                  return (
                    <TableRow key={String(call.channel_id)}>
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
                        <div className="flex items-center justify-end gap-1">
                          {!!call.monitoring && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Ear className="h-3 w-3" />
                              Monitored
                            </Badge>
                          )}
                          <Button variant="outline" size="sm" className="h-7" onClick={() => { setTransferChannel(String(call.channel_id)); setTransferDest(""); }}>
                            <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />Transfer
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 w-7 p-0">
                                <IconDotsVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { const ext = prompt("Enter your extension to listen:"); if (ext) pbxCalls.monitor(String(call.channel_id), ext, "spy").then(() => showToast("Monitoring started", "success")).catch((e) => showToast(String(e), "error")); }}>
                                <Ear className="h-4 w-4 mr-2" />Monitor (Listen)
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { const ext = prompt("Enter your extension to whisper:"); if (ext) pbxCalls.monitor(String(call.channel_id), ext, "whisper").then(() => showToast("Whisper started", "success")).catch((e) => showToast(String(e), "error")); }}>
                                <Mic className="h-4 w-4 mr-2" />Whisper (Coach Agent)
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { const ext = prompt("Enter your extension to barge:"); if (ext) pbxCalls.monitor(String(call.channel_id), ext, "barge").then(() => showToast("Barged in", "success")).catch((e) => showToast(String(e), "error")); }}>
                                <UserPlus className="h-4 w-4 mr-2" />Barge (Join Call)
                              </DropdownMenuItem>
                              {!!call.monitoring && (
                                <DropdownMenuItem onClick={() => pbxCalls.stopMonitor(String(call.channel_id)).then(() => showToast("Monitoring stopped", "success")).catch((e) => showToast(String(e), "error"))}>
                                  Stop Monitoring
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleHangup(String(call.channel_id))}>
                                <PhoneOff className="h-4 w-4 mr-2" />Hangup
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Call History */}
        <TabsContent value="history" className="flex flex-col flex-1 min-h-0 mt-4">
          <div className="flex items-center gap-2 shrink-0 mb-3">
            <Select value={directionFilter} onValueChange={setDirectionFilter}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All directions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All directions</SelectItem>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => loadHistory(page)} disabled={historyLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${historyLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border flex-1 min-h-0 overflow-y-auto">
            <DndContext
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
              sensors={sensors}
              id={sortableId}
            >
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} colSpan={header.colSpan}>
                          {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody className="**:data-[slot=table-cell]:first:w-8">
                  {historyLoading ? (
                    <TableSkeleton cols={columns.length} />
                  ) : table.getRowModel().rows?.length ? (
                    <SortableContext items={dataIds} strategy={verticalListSortingStrategy}>
                      {table.getRowModel().rows.map((row) => (
                        <DraggableRow key={row.id} row={row} />
                      ))}
                    </SortableContext>
                  ) : (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                        No call records
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DndContext>
          </div>

          <div className="flex items-center justify-between px-2 pt-3 pb-2 shrink-0">
            <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
              {table.getFilteredSelectedRowModel().rows.length} of {table.getFilteredRowModel().rows.length} row(s) selected.
            </div>
            <div className="flex w-full items-center gap-8 lg:w-fit">
              <div className="hidden items-center gap-2 lg:flex">
                <Label htmlFor="rows-per-page" className="text-sm font-medium">Rows per page</Label>
                <Select
                  value={`${limit}`}
                  onValueChange={(value) => {
                    const newLimit = Number(value);
                    setLimit(newLimit);
                    loadHistory(1, newLimit);
                  }}
                >
                  <SelectTrigger className="w-20" id="rows-per-page">
                    <SelectValue placeholder={limit} />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
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
                  disabled={page <= 1 || historyLoading}
                >
                  <span className="sr-only">Go to first page</span>
                  <IconChevronsLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="size-8"
                  size="icon"
                  onClick={() => loadHistory(page - 1)}
                  disabled={page <= 1 || historyLoading}
                >
                  <span className="sr-only">Go to previous page</span>
                  <IconChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="size-8"
                  size="icon"
                  onClick={() => loadHistory(page + 1)}
                  disabled={!hasMore || historyLoading}
                >
                  <span className="sr-only">Go to next page</span>
                  <IconChevronRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="hidden size-8 lg:flex"
                  size="icon"
                  onClick={() => loadHistory(totalPages)}
                  disabled={page >= totalPages || historyLoading}
                >
                  <span className="sr-only">Go to last page</span>
                  <IconChevronsRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Journey + Recording Drawer */}
      <Drawer
        direction={isMobile ? "bottom" : "right"}
        open={!!drawerCall}
        onOpenChange={(open) => {
          if (!open) {
            setDrawerCall(null);
            setJourney(null);
            setPlayingLog(null);
          }
        }}
      >
        <DrawerContent>
          <DrawerHeader className="gap-1">
            <DrawerTitle>
              {drawerCall?.from_number || "---"} → {drawerCall?.to_number || "---"}
            </DrawerTitle>
            <DrawerDescription>
              {drawerCall?.started_at ? format(new Date(drawerCall.started_at), "MMM d, h:mm a") : "Call details"}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm pb-4">
            {/* Journey */}
            {journeyLoading ? (
              <p className="text-sm text-muted-foreground">Loading call journey...</p>
            ) : journey ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium">Call Journey</span>
                  <Badge variant={journey.status === "answered" ? "default" : "secondary"}>{journey.status}</Badge>
                  {journey.answered_by && <span className="text-muted-foreground">Answered by ext {journey.answered_by}</span>}
                  <span className="text-muted-foreground">{journey.total_duration}s total</span>
                </div>
                <div className="space-y-1">
                  {journey.steps.filter(s => !s.channel.includes("UnicastRTP")).map((step, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs border-l-2 border-muted-foreground/20 pl-3 py-1">
                      <span className="text-muted-foreground w-16 shrink-0">{format(new Date(step.time), "h:mm:ss a")}</span>
                      <span className="font-medium w-28 shrink-0">{step.action}</span>
                      <Badge variant={step.status === "ANSWERED" ? "default" : "secondary"} className="text-[10px]">{step.status}</Badge>
                      {step.duration > 0 && <span className="text-muted-foreground">{step.duration}s</span>}
                    </div>
                  ))}
                </div>
              </div>
            ) : drawerCall ? (
              <p className="text-sm text-muted-foreground">No journey data</p>
            ) : null}

            <Separator />

            {/* Recording player */}
            {playingLog ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Recording</span>
                  <a href={playingLog.recording_url} download>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </Button>
                  </a>
                </div>
                <AudioPlayerProvider key={playingLog.id}>
                  <AutoPlayTrack src={playingLog.recording_url} id={playingLog.id} />
                  <div className="flex items-center gap-3">
                    <AudioPlayerButton
                      item={{ id: playingLog.id, src: playingLog.recording_url }}
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
            ) : drawerCall?.recording_url ? (
              <Button
                variant="outline"
                size="sm"
                className="w-fit gap-1.5 text-xs"
                onClick={() => drawerCall && playRecording(drawerCall)}
              >
                <Play className="h-3.5 w-3.5" />
                Play Recording
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">No recording available</p>
            )}
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline">Close</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

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
              <Select value={transferType} onValueChange={(v) => setTransferType(v as "extension" | "queue" | "external")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="extension">Extension</SelectItem>
                  <SelectItem value="queue">Queue</SelectItem>
                  <SelectItem value="external">External Number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {transferType === "extension" && (
              <>
                <Input placeholder="Search by name or extension..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
                {userSearch && filteredUsers.length > 0 && (
                  <div className="border rounded-md max-h-40 overflow-y-auto">
                    {filteredUsers.map((u) => (
                      <button key={u.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between" onClick={() => { setTransferDest(u.extension); setUserSearch(""); }}>
                        <span>{u.full_name || u.username}</span>
                        <span className="text-muted-foreground font-mono text-xs">{u.extension}{u.phone_number ? ` · ${u.phone_number}` : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {transferType === "external" && phonebook.length > 0 && (
              <div className="border rounded-md max-h-40 overflow-y-auto">
                <p className="text-[10px] text-muted-foreground px-3 pt-1.5">Phonebook</p>
                {phonebook.filter((c) => !userSearch || c.name.toLowerCase().includes(userSearch.toLowerCase()) || c.number.includes(userSearch)).map((c, i) => (
                  <button key={i} className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex justify-between" onClick={() => { setTransferDest(c.number); }}>
                    <span>{c.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">{c.number}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Destination</Label>
              <Input value={transferDest} onChange={(e) => setTransferDest(e.target.value)} placeholder={transferType === "external" ? "Phone number e.g. 7667745279" : transferType === "queue" ? "Queue number e.g. 5001" : "Extension e.g. 1001"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferChannel(null)}>Cancel</Button>
            <Button onClick={handleTransfer} disabled={!transferDest}>Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
