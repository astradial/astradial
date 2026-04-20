"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus, MoreHorizontal, Upload, Play, Pause, Trash2, Volume2, Music, MessageSquare, X } from "lucide-react";
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
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DragHandle, DraggableRow } from "@/components/ui/data-table-parts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/Toast";
import { queues, moh, greetingsApi, users as pbxUsers, type PbxQueue, type PbxUser, type QueueMember, type MohOrgClass, type MohListResponse, type Greeting } from "@/lib/pbx/client";

export default function QueuesPage() {
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);
  const [mohData, setMohData] = useState<MohListResponse>({ org_classes: [], system_classes: [] });
  const [greetingList, setGreetingList] = useState<Greeting[]>([]);
  const [loading, setLoading] = useState(true);

  // Queue dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingQueue, setEditingQueue] = useState<PbxQueue | null>(null);
  const [form, setForm] = useState({ name: "", number: "", strategy: "ringall", timeout: "15" });
  const [editForm, setEditForm] = useState({ name: "", number: "", strategy: "ringall", timeout: "15", max_wait_time: "45", timeout_destination: "", timeout_destination_type: "extension", music_on_hold: "default", greeting_id: "", status: "active" });
  const [userList, setUserList] = useState<PbxUser[]>([]);

  // MOH dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mohClassName, setMohClassName] = useState("custom");
  const [mohFile, setMohFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Greeting dialog
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [greetingForm, setGreetingForm] = useState({ name: "", text: "", language: "en-IN", voice: "en-IN-Wavenet-D" });
  const [creatingGreeting, setCreatingGreeting] = useState(false);

  // Audio player
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingUrl, setPlayingUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [systemMohFiles, setSystemMohFiles] = useState<string[]>([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [q, m, g, sysFiles, u] = await Promise.all([
        queues.list(),
        moh.list().catch(() => ({ org_classes: [], system_classes: [] } as MohListResponse)),
        greetingsApi.list().catch(() => []),
        fetch("/api/audio/moh-list").then((r) => r.json()).then((d) => d.files || []).catch(() => []),
        pbxUsers.list().catch(() => []),
      ]);
      setQueueList(q);
      setUserList(u);
      // Handle both old format ({ org_classes, system_classes }) and simplified format ({ classes })
      const mohResult = m as any;
      if (mohResult?.classes && !mohResult?.system_classes) {
        const classNames = (mohResult.classes || []).map((c: any) => c.name || c);
        setMohData({ system_classes: classNames, org_classes: [] });
      } else {
        setMohData(mohResult?.system_classes ? mohResult : { org_classes: [], system_classes: [] });
      }
      setGreetingList(g);
      setSystemMohFiles(sysFiles);
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed to load", "error"); }
    finally { setLoading(false); }
  }

  // ─── Queue CRUD ───

  async function handleCreate() {
    try {
      await queues.create({ name: form.name, number: form.number, strategy: form.strategy, timeout: parseInt(form.timeout) });
      showToast("Queue created", "success");
      setCreateOpen(false);
      setForm({ name: "", number: "", strategy: "ringall", timeout: "15" });
      await loadAll();
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  }

  function openEdit(q: PbxQueue) {
    setEditingQueue(q);
    setEditForm({ name: q.name, number: q.number, strategy: q.strategy, timeout: String(q.timeout), max_wait_time: String(q.max_wait_time || 45), timeout_destination: (q as any).timeout_destination || "", timeout_destination_type: (q as any).timeout_destination_type || "extension", music_on_hold: q.music_on_hold || "default", greeting_id: q.greeting_id || "", status: q.status });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editingQueue) return;
    try {
      await queues.update(editingQueue.id, {
        name: editForm.name, number: editForm.number, strategy: editForm.strategy, timeout: parseInt(editForm.timeout),
        max_wait_time: parseInt(editForm.max_wait_time) || 45,
        timeout_destination: editForm.timeout_destination || null,
        timeout_destination_type: editForm.timeout_destination_type || "extension",
        music_on_hold: editForm.music_on_hold, greeting_id: editForm.greeting_id || null, status: editForm.status as PbxQueue["status"],
      } as any);
      showToast("Queue updated", "success");
      setEditOpen(false);
      await loadAll();
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this queue?")) return;
    try { await queues.delete(id); showToast("Queue deleted", "success"); await loadAll(); }
    catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  }

  // ─── MOH ───

  async function handleUploadMoh() {
    if (!mohFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("audio", mohFile);
      fd.append("class_name", mohClassName);
      await moh.upload(fd);
      showToast("Music uploaded", "success");
      setUploadOpen(false);
      setMohFile(null);
      setMohClassName("custom");
      await loadAll();
    } catch (e) { showToast(e instanceof Error ? e.message : "Upload failed", "error"); }
    finally { setUploading(false); }
  }

  async function handleDeleteMoh(className: string, filename: string) {
    if (!confirm(`Delete ${filename}?`)) return;
    try { await moh.delete(className, filename); showToast("Deleted", "success"); await loadAll(); }
    catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  }

  // ─── Greetings ───

  async function handleCreateGreeting() {
    setCreatingGreeting(true);
    try {
      await greetingsApi.create(greetingForm);
      showToast("Greeting created — audio generated", "success");
      setGreetingOpen(false);
      setGreetingForm({ name: "", text: "", language: "en-IN", voice: "en-IN-Wavenet-D" });
      await loadAll();
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
    finally { setCreatingGreeting(false); }
  }

  async function handleDeleteGreeting(id: string) {
    if (!confirm("Delete this greeting?")) return;
    try { await greetingsApi.delete(id); showToast("Deleted", "success"); await loadAll(); }
    catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  }

  // ─── Audio Preview ───

  function playPreview(url: string) {
    if (playingUrl === url && isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (playingUrl !== url) {
        setPlayingUrl(url);
        setIsPlaying(false);
        // Wait for src to update then play
        setTimeout(() => {
          audioRef.current?.load();
          audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
        }, 100);
      } else {
        audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  }

  function stopPreview() {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setPlayingUrl("");
  }

  // All MOH classes combined for display and dropdowns
  const allMohForDropdown = useMemo(() => [
    ...mohData.system_classes.map((name) => ({ value: name, label: name, is_system: true, file_count: 0 })),
    ...mohData.org_classes.map((c) => ({ value: c.moh_class_name, label: `${c.class} (custom)`, is_system: false, file_count: c.file_count })),
  ], [mohData]);

  // ── Data-table wiring ──────────────────────────────────────────────────
  const columns: ColumnDef<PbxQueue>[] = useMemo(() => [
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
      accessorKey: "number",
      header: "Ext",
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.number}</span>,
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      enableHiding: false,
    },
    {
      accessorKey: "strategy",
      header: "Strategy",
      cell: ({ row }) => <Badge variant="outline" className="text-xs capitalize">{row.original.strategy}</Badge>,
    },
    {
      id: "moh",
      header: "MOH",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {allMohForDropdown.find((m) => m.value === row.original.music_on_hold)?.label || row.original.music_on_hold || "default"}
        </span>
      ),
    },
    {
      accessorKey: "timeout",
      header: "Timeout",
      cell: ({ row }) => <span className="text-sm">{row.original.timeout}s</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="outline" className="px-1.5 text-muted-foreground capitalize">
          {row.original.status === "active" ? (
            <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
          ) : (
            <IconLoader />
          )}
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
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
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => openEdit(row.original)}>Edit</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => handleDelete(row.original.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [allMohForDropdown]);

  const [data, setData] = useState<PbxQueue[]>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const sortableId = useId();
  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  useEffect(() => { setData(queueList); }, [queueList]);
  const dataIds = useMemo<UniqueIdentifier[]>(() => data.map((q) => q.id), [data]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, rowSelection, pagination },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
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
    <div className="p-3 md:p-6 space-y-8">
      {/* Audio element */}
      <audio ref={audioRef} src={playingUrl} onEnded={() => { setIsPlaying(false); setPlayingUrl(""); }} onPause={() => setIsPlaying(false)} />

      {/* Sticky audio player bar */}
      {playingUrl && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border bg-background/95 backdrop-blur px-4 py-2 shadow-lg">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full" onClick={() => playPreview(playingUrl)}>
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <span className="text-xs text-muted-foreground max-w-[200px] truncate">
            {decodeURIComponent(playingUrl.split("/").pop() || "").replace(".wav", "")}
          </span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={stopPreview}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* ─── Queues Section ─── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Queues</h1>
            <p className="text-sm text-muted-foreground">Manage call queues, hold music, and greetings</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1.5" />Add Queue</Button></DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Create Queue</DialogTitle><DialogDescription>Set up a new call queue</DialogDescription></DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Support" /></div>
                  <div className="space-y-1.5"><Label>Extension</Label><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="5001" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Strategy</Label>
                    <Select value={form.strategy} onValueChange={(v) => setForm({ ...form, strategy: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ringall">Ring All</SelectItem>
                        <SelectItem value="leastrecent">Least Recent</SelectItem>
                        <SelectItem value="fewestcalls">Fewest Calls</SelectItem>
                        <SelectItem value="random">Random</SelectItem>
                        <SelectItem value="rrmemory">Round Robin</SelectItem>
                        <SelectItem value="linear">Linear</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Timeout (sec)</Label><Input type="number" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: e.target.value })} /></div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="overflow-hidden rounded-lg border">
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
                {loading ? (
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
                      No queues
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>

        <div className="flex items-center justify-between px-2">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            {table.getFilteredSelectedRowModel().rows.length} of {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">Rows per page</Label>
              <Select value={`${table.getState().pagination.pageSize}`} onValueChange={(value) => table.setPageSize(Number(value))}>
                <SelectTrigger className="w-20" id="rows-per-page">
                  <SelectValue placeholder={table.getState().pagination.pageSize} />
                </SelectTrigger>
                <SelectContent side="top">
                  {[10, 20, 30, 40, 50].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
                <span className="sr-only">Go to first page</span>
                <IconChevronsLeft className="size-4" />
              </Button>
              <Button variant="outline" className="size-8" size="icon" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                <span className="sr-only">Go to previous page</span>
                <IconChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" className="size-8" size="icon" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                <span className="sr-only">Go to next page</span>
                <IconChevronRight className="size-4" />
              </Button>
              <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
                <span className="sr-only">Go to last page</span>
                <IconChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Music on Hold Section ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2"><Music className="h-5 w-5" />Music on Hold</CardTitle>
            <CardDescription>Upload and manage hold music for queues</CardDescription>
          </div>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><Upload className="h-4 w-4 mr-1.5" />Upload Audio</Button></DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Upload Hold Music</DialogTitle><DialogDescription>MP3, WAV, OGG, FLAC — auto-converted to Asterisk format</DialogDescription></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label>Class Name</Label>
                  <Input value={mohClassName} onChange={(e) => setMohClassName(e.target.value)} placeholder="custom" />
                  <p className="text-[10px] text-muted-foreground">Group name for this music set</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Audio File</Label>
                  <Input type="file" accept=".mp3,.wav,.ogg,.flac,.m4a,.aac" onChange={(e) => setMohFile(e.target.files?.[0] || null)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
                <Button onClick={handleUploadMoh} disabled={!mohFile || uploading}>{uploading ? "Uploading..." : "Upload"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {/* Default system MOH files */}
            <div className="rounded-md border px-3 py-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">default</span>
                  <span className="text-xs text-muted-foreground">{systemMohFiles.length} file(s)</span>
                </div>
                <Badge variant="secondary" className="text-[10px]">System</Badge>
              </div>
              {systemMohFiles.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-7">
                  {systemMohFiles.map((f) => (
                    <Button key={f} variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => playPreview(`/api/audio/moh/${f}`)}>
                      <Play className="h-3 w-3" />{f.replace(".wav", "").slice(0, 25)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            {/* Other system classes — show only as labels (no files on disk) */}
            {mohData.system_classes.filter((n) => n !== "default").length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-xs text-muted-foreground">Other system classes:</span>
                {mohData.system_classes.filter((n) => n !== "default").map((name) => (
                  <Badge key={name} variant="outline" className="text-[10px]">{name}</Badge>
                ))}
                <span className="text-[10px] text-muted-foreground">(no audio files installed)</span>
              </div>
            )}
            {/* Org custom MOH classes */}
            {mohData.org_classes.map((c) => (
              <div key={c.moh_class_name} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="flex items-center gap-3">
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-sm font-medium">{c.class}</span>
                    <span className="text-xs text-muted-foreground ml-2">{c.file_count} file(s)</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.files?.map((f) => (
                    <div key={f.filename} className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => playPreview(`/api/audio/moh/${c.moh_class_name}/${f.filename}`)}>
                        <Play className="h-3 w-3 mr-1" />{f.filename.slice(0, 20)}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteMoh(c.moh_class_name, f.filename)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {mohData.org_classes.length === 0 && mohData.system_classes.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">No music classes configured</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Greetings (TTS) Section ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2"><MessageSquare className="h-5 w-5" />Greetings (TTS)</CardTitle>
            <CardDescription>Create text-to-speech greetings for callers</CardDescription>
          </div>
          <Dialog open={greetingOpen} onOpenChange={setGreetingOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1.5" />Create Greeting</Button></DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Create TTS Greeting</DialogTitle><DialogDescription>Type your greeting text — audio will be generated automatically</DialogDescription></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={greetingForm.name} onChange={(e) => setGreetingForm({ ...greetingForm, name: e.target.value })} placeholder="Welcome Greeting" />
                </div>
                <div className="space-y-1.5">
                  <Label>Greeting Text</Label>
                  <Textarea value={greetingForm.text} onChange={(e) => setGreetingForm({ ...greetingForm, text: e.target.value })} placeholder="Welcome to Grand Estancia. Please hold while we connect you to a team member." className="min-h-[80px]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Language</Label>
                    <Select value={greetingForm.language} onValueChange={(v) => setGreetingForm({ ...greetingForm, language: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en-IN">English (India)</SelectItem>
                        <SelectItem value="en-US">English (US)</SelectItem>
                        <SelectItem value="hi-IN">Hindi</SelectItem>
                        <SelectItem value="ta-IN">Tamil</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Voice</Label>
                    <Select value={greetingForm.voice} onValueChange={(v) => setGreetingForm({ ...greetingForm, voice: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en-IN-Wavenet-D">Wavenet D (Male)</SelectItem>
                        <SelectItem value="en-IN-Wavenet-A">Wavenet A (Female)</SelectItem>
                        <SelectItem value="en-IN-Wavenet-B">Wavenet B (Male)</SelectItem>
                        <SelectItem value="en-IN-Wavenet-C">Wavenet C (Female)</SelectItem>
                        <SelectItem value="en-US-Wavenet-D">US Wavenet D (Male)</SelectItem>
                        <SelectItem value="en-US-Wavenet-C">US Wavenet C (Female)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setGreetingOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateGreeting} disabled={!greetingForm.name || !greetingForm.text || creatingGreeting}>
                  {creatingGreeting ? "Generating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {greetingList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No greetings created yet</p>
          ) : (
            <div className="space-y-2">
              {greetingList.map((g) => (
                <div key={g.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{g.name}</span>
                      <p className="text-xs text-muted-foreground truncate">{g.text}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{g.voice?.split("-").pop()}</Badge>
                    <Badge
                      variant={g.status === "active" ? "default" : "secondary"}
                      className="text-[10px] cursor-pointer"
                      onClick={async () => {
                        try {
                          await greetingsApi.update(g.id, { status: g.status === "active" ? "inactive" : "active" });
                          showToast(g.status === "active" ? "Greeting disabled" : "Greeting enabled", "success");
                          await loadAll();
                        } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
                      }}
                    >
                      {g.status === "active" ? "Enabled" : "Disabled"}
                    </Badge>
                    {g.audio_file && (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => playPreview(`/api/audio/greetings/${g.id}/audio`)}>
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={async () => {
                          await greetingsApi.update(g.id, { status: g.status === "active" ? "inactive" : "active" });
                          await loadAll();
                        }}>{g.status === "active" ? "Disable" : "Enable"}</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteGreeting(g.id)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Edit Queue Dialog ─── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Queue — {editingQueue?.name}</DialogTitle>
            <DialogDescription>Update queue settings, hold music, and greeting</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Extension</Label><Input value={editForm.number} onChange={(e) => setEditForm({ ...editForm, number: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Strategy</Label>
                <Select value={editForm.strategy} onValueChange={(v) => setEditForm({ ...editForm, strategy: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ringall">Ring All</SelectItem>
                    <SelectItem value="leastrecent">Least Recent</SelectItem>
                    <SelectItem value="fewestcalls">Fewest Calls</SelectItem>
                    <SelectItem value="random">Random</SelectItem>
                    <SelectItem value="rrmemory">Round Robin</SelectItem>
                    <SelectItem value="linear">Linear</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Ring Timeout (sec)</Label><Input type="number" value={editForm.timeout} onChange={(e) => setEditForm({ ...editForm, timeout: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Max Wait (sec)</Label><Input type="number" value={editForm.max_wait_time} onChange={(e) => setEditForm({ ...editForm, max_wait_time: e.target.value })} placeholder="45" /></div>
              <div className="space-y-1.5"><Label>Timeout Destination</Label>
                <Select value={editForm.timeout_destination_type} onValueChange={(v) => setEditForm({ ...editForm, timeout_destination_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extension">Extension</SelectItem>
                    <SelectItem value="queue">Queue</SelectItem>
                    <SelectItem value="phone">Phone Number</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Destination {editForm.timeout_destination_type === "phone" ? "Number" : editForm.timeout_destination_type === "queue" ? "Queue" : "Extension"}</Label>
              <Input value={editForm.timeout_destination} onChange={(e) => setEditForm({ ...editForm, timeout_destination: e.target.value })} placeholder={editForm.timeout_destination_type === "phone" ? "9944421125" : editForm.timeout_destination_type === "queue" ? "5002" : "1003"} />
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label>Music on Hold</Label>
              <Select value={editForm.music_on_hold} onValueChange={(v) => setEditForm({ ...editForm, music_on_hold: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allMohForDropdown.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label} {c.is_system ? "(system)" : ""} {c.file_count > 0 ? `— ${c.file_count} files` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Greeting</Label>
              <Select value={editForm.greeting_id || "__none__"} onValueChange={(v) => setEditForm({ ...editForm, greeting_id: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="No greeting" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No greeting</SelectItem>
                  {greetingList.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Members</Label>
              {editingQueue?.members && editingQueue.members.length > 0 ? (
                <div className="space-y-1">
                  {editingQueue.members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-sm border rounded-md px-2.5 py-1.5">
                      <span>{m.user?.full_name || "Unknown"} <span className="text-muted-foreground">— ext {m.user?.extension}</span></span>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={async () => {
                        try {
                          await queues.removeMember(editingQueue.id, m.user_id);
                          showToast("Member removed", "success");
                          await loadAll();
                          // Refresh editingQueue
                          const updated = await queues.get(editingQueue.id);
                          setEditingQueue(updated);
                        } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
                      }}><X className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No members</p>
              )}
              {/* key forces a remount after each successful add so the Select resets to its placeholder */}
              <Select key={`add-member-${editingQueue?.members?.length ?? 0}`} onValueChange={async (userId) => {
                if (!editingQueue) return;
                try {
                  await queues.addMembers(editingQueue.id, [userId]);
                  showToast("Member added", "success");
                  await loadAll();
                  const updated = await queues.get(editingQueue.id);
                  setEditingQueue(updated);
                } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
              }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Add member..." /></SelectTrigger>
                <SelectContent>
                  {userList.filter(u => u.status === "active" && !editingQueue?.members?.some(m => m.user_id === u.id)).map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name || u.username} — {u.extension}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-1.5"><Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
