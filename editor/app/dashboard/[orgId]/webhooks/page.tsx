"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, Copy, Eye, EyeOff } from "lucide-react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconLoader,
} from "@tabler/icons-react";
import { format } from "date-fns";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { apiKeys, type ApiKey } from "@/lib/workflow/client";

const PBX_BASE = "/api/pbx";

interface PbxApiKey {
  id: string;
  name: string;
  api_key: string;
  api_secret?: string;
  permissions: string[];
  status: string;
  last_used_at: string | null;
  created_by: string | null;
  createdAt: string;
}

const ALL_PERMISSIONS = [
  { id: "calls.read", label: "Read call logs" },
  { id: "calls.write", label: "Manage calls" },
  { id: "calls.click_to_call", label: "Click to call" },
  { id: "calls.originate_ai", label: "Originate to AI" },
  { id: "calls.recording", label: "Call recording" },
  { id: "calls.live", label: "Live calls" },
  { id: "calls.transfer", label: "Transfer calls" },
  { id: "calls.hangup", label: "Hangup calls" },
  { id: "calls.hold", label: "Hold/unhold calls" },
];

const API_ENDPOINTS = [
  { method: "GET", path: "/calls", desc: "List call logs", perm: "calls.read" },
  { method: "GET", path: "/calls/live", desc: "Get live active calls", perm: "calls.live" },
  { method: "GET", path: "/calls/count", desc: "Get call count and statistics", perm: "calls.read" },
  { method: "GET", path: "/calls/channels", desc: "Get active channels with details", perm: "calls.live" },
  { method: "GET", path: "/calls/{callId}/recording", desc: "Download call recording", perm: "calls.recording" },
  { method: "POST", path: "/calls/click-to-call", desc: "Initiate click-to-call between two parties", perm: "calls.click_to_call" },
  { method: "POST", path: "/calls/originate-to-ai", desc: "Originate call and connect to AI agent", perm: "calls.originate_ai" },
  { method: "POST", path: "/calls/{channelId}/hangup", desc: "Hang up an active call", perm: "calls.hangup" },
  { method: "POST", path: "/calls/{channelId}/hold", desc: "Put a call on hold", perm: "calls.hold" },
  { method: "POST", path: "/calls/{channelId}/unhold", desc: "Resume a call from hold", perm: "calls.hold" },
  { method: "POST", path: "/calls/{channelId}/transfer", desc: "Transfer an active call", perm: "calls.transfer" },
];

export default function WebhooksPage() {
  const { orgId } = useParams<{ orgId: string }>();

  // Workflow API keys (existing)
  const [wfKeys, setWfKeys] = useState<ApiKey[]>([]);
  const [wfLoading, setWfLoading] = useState(true);
  const [wfCreateOpen, setWfCreateOpen] = useState(false);
  const [wfKeyName, setWfKeyName] = useState("");

  // PBX API keys (new)
  const [pbxKeys, setPbxKeys] = useState<PbxApiKey[]>([]);
  const [pbxLoading, setPbxLoading] = useState(true);
  const [pbxCreateOpen, setPbxCreateOpen] = useState(false);
  const [pbxKeyName, setPbxKeyName] = useState("");
  const [pbxPerms, setPbxPerms] = useState<string[]>(ALL_PERMISSIONS.map(p => p.id));
  const [newPbxSecret, setNewPbxSecret] = useState<string | null>(null);

  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  useEffect(() => { loadWfKeys(); loadPbxKeys(); }, [orgId]);

  // ── Workflow keys ──
  async function loadWfKeys() {
    try { setWfLoading(true); setWfKeys(await apiKeys.list(orgId)); } catch {} finally { setWfLoading(false); }
  }
  async function handleWfCreate() {
    try {
      await apiKeys.create(orgId, wfKeyName || "Default");
      showToast("Workflow key created", "success");
      setWfCreateOpen(false); setWfKeyName(""); loadWfKeys();
    } catch (e) { showToast((e as Error).message, "error"); }
  }
  async function handleWfToggle(k: ApiKey) {
    try { await apiKeys.update(k.id, { is_active: !k.is_active }); loadWfKeys(); } catch {}
  }
  async function handleWfDelete(id: string) {
    try { await apiKeys.delete(id); showToast("Deleted", "success"); loadWfKeys(); } catch {}
  }

  // ── PBX API keys ──
  function pbxHeaders() {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const t = typeof window !== "undefined" ? localStorage.getItem("pbx_org_token") || "" : "";
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  }

  async function loadPbxKeys() {
    try {
      setPbxLoading(true);
      const res = await fetch(`${PBX_BASE}/api-keys`, { headers: pbxHeaders() });
      if (res.ok) { const data = await res.json(); setPbxKeys(data.keys || []); }
    } catch {} finally { setPbxLoading(false); }
  }

  async function handlePbxCreate() {
    try {
      const res = await fetch(`${PBX_BASE}/api-keys`, {
        method: "POST", headers: pbxHeaders(),
        body: JSON.stringify({ name: pbxKeyName || "Default", permissions: pbxPerms }),
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error, "error"); return; }
      const data = await res.json();
      setNewPbxSecret(data.api_secret);
      showToast("API key created — save the secret now!", "success");
      setPbxCreateOpen(false); setPbxKeyName(""); loadPbxKeys();
    } catch (e) { showToast((e as Error).message, "error"); }
  }

  async function handlePbxRevoke(id: string) {
    try {
      await fetch(`${PBX_BASE}/api-keys/${id}`, { method: "DELETE", headers: pbxHeaders() });
      showToast("API key revoked", "success"); loadPbxKeys();
    } catch {}
  }

  function toggleReveal(id: string) {
    setRevealedKeys(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function maskKey(key: string) { return key.slice(0, 8) + "••••••••" + key.slice(-4); }
  function copyKey(key: string) { navigator.clipboard.writeText(key); showToast("Copied", "success"); }

  const methodColor: Record<string, string> = { GET: "secondary", POST: "default" };

  // ── PBX keys data-table wiring ────────────────────────────────────────
  const pbxColumns: ColumnDef<PbxApiKey>[] = [
    { id: "drag", header: () => null, cell: ({ row }) => <DragHandle id={row.original.id} /> },
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
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium text-sm">{row.original.name}</span>,
    },
    {
      accessorKey: "api_key",
      header: "API Key",
      cell: ({ row }) => {
        const k = row.original;
        return (
          <div className="flex items-center gap-1.5">
            <code className="text-xs font-mono text-muted-foreground">{revealedKeys.has(k.id) ? k.api_key : maskKey(k.api_key)}</code>
            <button onClick={() => toggleReveal(k.id)} className="text-muted-foreground hover:text-foreground">
              {revealedKeys.has(k.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => copyKey(k.api_key)} className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
          </div>
        );
      },
    },
    {
      accessorKey: "permissions",
      header: "Permissions",
      cell: ({ row }) => <Badge variant="secondary" className="text-[10px]">{(row.original.permissions || []).length} perms</Badge>,
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
      accessorKey: "last_used_at",
      header: "Last Used",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.last_used_at ? format(new Date(row.original.last_used_at), "MMM d, h:mm a") : "Never"}</span>,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex size-8 text-muted-foreground data-[state=open]:bg-muted" size="icon">
              <IconDotsVertical />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => toggleReveal(row.original.id)}>
              {revealedKeys.has(row.original.id) ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
              {revealedKeys.has(row.original.id) ? "Hide Key" : "Reveal Key"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyKey(row.original.api_key)}>
              <Copy className="h-4 w-4 mr-2" />Copy Key
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => handlePbxRevoke(row.original.id)}
            >
              Revoke
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const [pbxData, setPbxData] = useState<PbxApiKey[]>([]);
  const [pbxRowSelection, setPbxRowSelection] = useState({});
  const [pbxColumnVisibility, setPbxColumnVisibility] = useState<VisibilityState>({});
  const [pbxSorting, setPbxSorting] = useState<SortingState>([]);
  const [pbxPagination, setPbxPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const pbxSortableId = useId();
  const pbxSensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  useEffect(() => { setPbxData(pbxKeys); }, [pbxKeys]);
  const pbxDataIds = useMemo<UniqueIdentifier[]>(() => pbxData.map((k) => k.id), [pbxData]);

  const pbxTable = useReactTable({
    data: pbxData,
    columns: pbxColumns,
    state: { sorting: pbxSorting, columnVisibility: pbxColumnVisibility, rowSelection: pbxRowSelection, pagination: pbxPagination },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setPbxRowSelection,
    onSortingChange: setPbxSorting,
    onColumnVisibilityChange: setPbxColumnVisibility,
    onPaginationChange: setPbxPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handlePbxDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setPbxData((prev) => {
        const oldIndex = pbxDataIds.indexOf(active.id);
        const newIndex = pbxDataIds.indexOf(over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  // ── Workflow keys data-table wiring ───────────────────────────────────
  const wfColumns: ColumnDef<ApiKey>[] = [
    { id: "drag", header: () => null, cell: ({ row }) => <DragHandle id={row.original.id} /> },
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
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium text-sm">{row.original.name}</span>,
    },
    {
      accessorKey: "key",
      header: "Key",
      cell: ({ row }) => {
        const k = row.original;
        return (
          <div className="flex items-center gap-1.5">
            <code className="text-xs font-mono text-muted-foreground">{revealedKeys.has(k.id) ? k.key : maskKey(k.key)}</code>
            <button onClick={() => toggleReveal(k.id)} className="text-muted-foreground hover:text-foreground">
              {revealedKeys.has(k.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => copyKey(k.key)} className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
          </div>
        );
      },
    },
    {
      accessorKey: "is_active",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="outline" className="px-1.5 text-muted-foreground">
          {row.original.is_active ? (
            <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
          ) : (
            <IconLoader />
          )}
          {row.original.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      accessorKey: "last_used_at",
      header: "Last Used",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.last_used_at ? format(new Date(row.original.last_used_at), "MMM d, h:mm a") : "Never"}</span>,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex size-8 text-muted-foreground data-[state=open]:bg-muted" size="icon">
              <IconDotsVertical />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => toggleReveal(row.original.id)}>
              {revealedKeys.has(row.original.id) ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
              {revealedKeys.has(row.original.id) ? "Hide Key" : "Reveal Key"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyKey(row.original.key)}>
              <Copy className="h-4 w-4 mr-2" />Copy Key
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleWfToggle(row.original)}>
              {row.original.is_active ? "Deactivate" : "Activate"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => handleWfDelete(row.original.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const [wfData, setWfData] = useState<ApiKey[]>([]);
  const [wfRowSelection, setWfRowSelection] = useState({});
  const [wfColumnVisibility, setWfColumnVisibility] = useState<VisibilityState>({});
  const [wfSorting, setWfSorting] = useState<SortingState>([]);
  const [wfPagination, setWfPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const wfSortableId = useId();
  const wfSensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  useEffect(() => { setWfData(wfKeys); }, [wfKeys]);
  const wfDataIds = useMemo<UniqueIdentifier[]>(() => wfData.map((k) => k.id), [wfData]);

  const wfTable = useReactTable({
    data: wfData,
    columns: wfColumns,
    state: { sorting: wfSorting, columnVisibility: wfColumnVisibility, rowSelection: wfRowSelection, pagination: wfPagination },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setWfRowSelection,
    onSortingChange: setWfSorting,
    onColumnVisibilityChange: setWfColumnVisibility,
    onPaginationChange: setWfPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handleWfDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setWfData((prev) => {
        const oldIndex = wfDataIds.indexOf(active.id);
        const newIndex = wfDataIds.indexOf(over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API & Webhooks</h1>
        <p className="text-sm text-muted-foreground">Manage API keys and integrations</p>
      </div>

      <Tabs defaultValue="api-keys">
        <TabsList>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="workflow-keys">Workflow Keys</TabsTrigger>
          <TabsTrigger value="reference">API Reference</TabsTrigger>
        </TabsList>

        {/* ── API Keys Tab ── */}
        <TabsContent value="api-keys" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">API keys for call management, click-to-call, and AI origination</p>
            <Button size="sm" onClick={() => setPbxCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Create API Key</Button>
          </div>

          {/* Show secret banner if just created */}
          {newPbxSecret && (
            <Card className="border-primary">
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-medium">Save your API secret — it won't be shown again</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-muted p-2 rounded break-all">{newPbxSecret}</code>
                  <Button variant="outline" size="sm" onClick={() => { copyKey(newPbxSecret); }}><Copy className="h-4 w-4" /></Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setNewPbxSecret(null)}>Dismiss</Button>
              </CardContent>
            </Card>
          )}

          <div className="overflow-hidden rounded-lg border">
            <DndContext
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handlePbxDragEnd}
              sensors={pbxSensors}
              id={pbxSortableId}
            >
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
                  {pbxTable.getHeaderGroups().map((headerGroup) => (
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
                  {pbxLoading ? (
                    <TableSkeleton cols={pbxColumns.length} />
                  ) : pbxTable.getRowModel().rows?.length ? (
                    <SortableContext items={pbxDataIds} strategy={verticalListSortingStrategy}>
                      {pbxTable.getRowModel().rows.map((row) => (
                        <DraggableRow key={row.id} row={row} />
                      ))}
                    </SortableContext>
                  ) : (
                    <TableRow>
                      <TableCell colSpan={pbxColumns.length} className="h-24 text-center text-muted-foreground">
                        No API keys yet. Create one to start integrating.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DndContext>
          </div>

          <div className="flex items-center justify-between px-2">
            <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
              {pbxTable.getFilteredSelectedRowModel().rows.length} of {pbxTable.getFilteredRowModel().rows.length} row(s) selected.
            </div>
            <div className="flex w-full items-center gap-8 lg:w-fit">
              <div className="hidden items-center gap-2 lg:flex">
                <Label htmlFor="pbx-rows-per-page" className="text-sm font-medium">Rows per page</Label>
                <Select value={`${pbxTable.getState().pagination.pageSize}`} onValueChange={(value) => pbxTable.setPageSize(Number(value))}>
                  <SelectTrigger className="w-20" id="pbx-rows-per-page">
                    <SelectValue placeholder={pbxTable.getState().pagination.pageSize} />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-fit items-center justify-center text-sm font-medium">
                Page {pbxTable.getState().pagination.pageIndex + 1} of {pbxTable.getPageCount() || 1}
              </div>
              <div className="ml-auto flex items-center gap-2 lg:ml-0">
                <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => pbxTable.setPageIndex(0)} disabled={!pbxTable.getCanPreviousPage()}>
                  <span className="sr-only">Go to first page</span>
                  <IconChevronsLeft className="size-4" />
                </Button>
                <Button variant="outline" className="size-8" size="icon" onClick={() => pbxTable.previousPage()} disabled={!pbxTable.getCanPreviousPage()}>
                  <span className="sr-only">Go to previous page</span>
                  <IconChevronLeft className="size-4" />
                </Button>
                <Button variant="outline" className="size-8" size="icon" onClick={() => pbxTable.nextPage()} disabled={!pbxTable.getCanNextPage()}>
                  <span className="sr-only">Go to next page</span>
                  <IconChevronRight className="size-4" />
                </Button>
                <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => pbxTable.setPageIndex(pbxTable.getPageCount() - 1)} disabled={!pbxTable.getCanNextPage()}>
                  <span className="sr-only">Go to last page</span>
                  <IconChevronsRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Usage examples */}
          <Card>
            <CardHeader><CardTitle className="text-base">Usage</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Click to Call</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST http://localhost:8000/api/v1/calls/click-to-call \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ak_your_key_here" \\
  -d '{
    "from": "1001",
    "to": "+919944421125",
    "caller_id": "+918065978005"
  }'`}</pre>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Originate to AI Agent (call extension)</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST http://localhost:8000/api/v1/calls/originate-to-ai \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ak_your_key_here" \\
  -d '{
    "to": "2001",
    "caller_id": "AI Assistant",
    "wss_url": "wss://ai.example.com/voice/stream"
  }'`}</pre>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Originate to AI Agent (external number + OpenAI)</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST http://localhost:8000/api/v1/calls/originate-to-ai \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ak_your_key_here" \\
  -d '{
    "to": "+919944421125",
    "caller_id": "Support Bot",
    "ai_agent_app": "ai_agent",
    "wss_url": "wss://api.openai.com/v1/realtime",
    "timeout": 45,
    "variables": {
      "CAMPAIGN_ID": "summer2024",
      "LANGUAGE": "en-US"
    }
  }'`}</pre>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Get Call Logs</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl http://localhost:8000/api/v1/calls \\
  -H "X-API-Key: ak_your_key_here"`}</pre>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Get Live Calls</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl http://localhost:8000/api/v1/calls/live \\
  -H "X-API-Key: ak_your_key_here"`}</pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Workflow Keys Tab ── */}
        <TabsContent value="workflow-keys" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Keys for triggering workflows via HTTP</p>
            <Dialog open={wfCreateOpen} onOpenChange={setWfCreateOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Create Key</Button></DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Create Workflow Key</DialogTitle><DialogDescription>Required to trigger workflows via HTTP</DialogDescription></DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1.5"><Label>Name</Label><Input value={wfKeyName} onChange={e => setWfKeyName(e.target.value)} placeholder="PMS Integration..." /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setWfCreateOpen(false)}>Cancel</Button>
                  <Button onClick={handleWfCreate}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <DndContext
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleWfDragEnd}
              sensors={wfSensors}
              id={wfSortableId}
            >
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
                  {wfTable.getHeaderGroups().map((headerGroup) => (
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
                  {wfLoading ? (
                    <TableSkeleton cols={wfColumns.length} />
                  ) : wfTable.getRowModel().rows?.length ? (
                    <SortableContext items={wfDataIds} strategy={verticalListSortingStrategy}>
                      {wfTable.getRowModel().rows.map((row) => (
                        <DraggableRow key={row.id} row={row} />
                      ))}
                    </SortableContext>
                  ) : (
                    <TableRow>
                      <TableCell colSpan={wfColumns.length} className="h-24 text-center text-muted-foreground">
                        No workflow keys
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DndContext>
          </div>

          <div className="flex items-center justify-between px-2">
            <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
              {wfTable.getFilteredSelectedRowModel().rows.length} of {wfTable.getFilteredRowModel().rows.length} row(s) selected.
            </div>
            <div className="flex w-full items-center gap-8 lg:w-fit">
              <div className="hidden items-center gap-2 lg:flex">
                <Label htmlFor="wf-rows-per-page" className="text-sm font-medium">Rows per page</Label>
                <Select value={`${wfTable.getState().pagination.pageSize}`} onValueChange={(value) => wfTable.setPageSize(Number(value))}>
                  <SelectTrigger className="w-20" id="wf-rows-per-page">
                    <SelectValue placeholder={wfTable.getState().pagination.pageSize} />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-fit items-center justify-center text-sm font-medium">
                Page {wfTable.getState().pagination.pageIndex + 1} of {wfTable.getPageCount() || 1}
              </div>
              <div className="ml-auto flex items-center gap-2 lg:ml-0">
                <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => wfTable.setPageIndex(0)} disabled={!wfTable.getCanPreviousPage()}>
                  <span className="sr-only">Go to first page</span>
                  <IconChevronsLeft className="size-4" />
                </Button>
                <Button variant="outline" className="size-8" size="icon" onClick={() => wfTable.previousPage()} disabled={!wfTable.getCanPreviousPage()}>
                  <span className="sr-only">Go to previous page</span>
                  <IconChevronLeft className="size-4" />
                </Button>
                <Button variant="outline" className="size-8" size="icon" onClick={() => wfTable.nextPage()} disabled={!wfTable.getCanNextPage()}>
                  <span className="sr-only">Go to next page</span>
                  <IconChevronRight className="size-4" />
                </Button>
                <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => wfTable.setPageIndex(wfTable.getPageCount() - 1)} disabled={!wfTable.getCanNextPage()}>
                  <span className="sr-only">Go to last page</span>
                  <IconChevronsRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>

          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-medium">Usage</p>
              <p className="text-xs text-muted-foreground">Include the key when triggering workflows:</p>
              <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : "http://localhost:3001"}/api/workflow/trigger/{workflow_id} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wfk_your_key_here" \\
  -d '{"name": "John", "phone": "9944421125"}'`}</pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── API Reference Tab ── */}
        <TabsContent value="reference" className="space-y-4">
          <p className="text-sm text-muted-foreground">All available API endpoints. Authenticate with <code className="text-xs bg-muted px-1 py-0.5 rounded">X-API-Key: ak_your_key</code></p>

          <Card>
            <CardHeader><CardTitle className="text-base">Call Management</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Method</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-32">Permission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {API_ENDPOINTS.map((ep, i) => (
                    <TableRow key={i}>
                      <TableCell><Badge variant={methodColor[ep.method] as "default" | "secondary" || "default"} className="text-xs font-mono">{ep.method}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/api/v1{ep.path}</TableCell>
                      <TableCell className="text-sm">{ep.desc}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{ep.perm}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Authentication</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">All requests require an API key in the header:</p>
              <pre className="text-xs font-mono bg-muted rounded-lg p-3">{`X-API-Key: ak_your_api_key_here`}</pre>
              <p className="text-sm text-muted-foreground">API keys are scoped to your organisation. You can only access your own DIDs, calls, and recordings.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* PBX Create Key Dialog */}
      <Dialog open={pbxCreateOpen} onOpenChange={setPbxCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create API Key</DialogTitle><DialogDescription>Generate a key for call management integrations</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Key Name</Label>
              <Input value={pbxKeyName} onChange={e => setPbxKeyName(e.target.value)} placeholder="CRM Integration, IVR System..." />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_PERMISSIONS.map(p => (
                  <div key={p.id} className="flex items-center gap-2">
                    <Checkbox checked={pbxPerms.includes(p.id)} onCheckedChange={c => {
                      setPbxPerms(prev => c ? [...prev, p.id] : prev.filter(x => x !== p.id));
                    }} id={p.id} />
                    <Label htmlFor={p.id} className="text-xs">{p.label}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPbxCreateOpen(false)}>Cancel</Button>
            <Button onClick={handlePbxCreate}>Create Key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
