"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Plus, Phone, Mail } from "lucide-react";
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
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DragHandle, DraggableRow } from "@/components/ui/data-table-parts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { showToast } from "@/components/ui/Toast";
import { trunks, type PbxTrunk } from "@/lib/pbx/client";

const regStatusColors: Record<string, string> = {
  registered: "default",
  unregistered: "secondary",
  failed: "destructive",
};

export default function TrunksPage() {
  const [trunkList, setTrunkList] = useState<PbxTrunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingTrunk, setEditingTrunk] = useState<PbxTrunk | null>(null);
  const isAdmin = typeof window !== "undefined" && (!!localStorage.getItem("gateway_admin_key") || localStorage.getItem("user_role") === "owner" || localStorage.getItem("user_role") === "admin");
  const [form, setForm] = useState({ name: "", host: "", port: "5060", username: "", password: "", transport: "udp", trunk_type: "outbound", max_channels: "10" });
  const [editForm, setEditForm] = useState({ name: "", host: "", port: "5060", username: "", password: "", transport: "udp", trunk_type: "outbound", max_channels: "10", status: "active" });

  useEffect(() => { loadTrunks(); }, []);

  async function loadTrunks() {
    try { setLoading(true); setTrunkList(await trunks.list()); }
    catch (e) { showToast(e instanceof Error ? e.message : "Failed to load", "error"); }
    finally { setLoading(false); }
  }

  async function handleCreate() {
    try {
      await trunks.create({ name: form.name, host: form.host, port: parseInt(form.port), username: form.username, password: form.password, transport: form.transport as PbxTrunk["transport"], trunk_type: form.trunk_type as PbxTrunk["trunk_type"], max_channels: parseInt(form.max_channels) } as Partial<PbxTrunk>);
      showToast("Trunk created", "success");
      setCreateOpen(false);
      setForm({ name: "", host: "", port: "5060", username: "", password: "", transport: "udp", trunk_type: "outbound", max_channels: "10" });
      await loadTrunks();
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed to create", "error"); }
  }

  function openEdit(t: PbxTrunk) {
    setEditingTrunk(t);
    setEditForm({ name: t.name, host: t.host, port: String(t.port), username: (t as unknown as Record<string, unknown>).username as string || "", password: "", transport: t.transport, trunk_type: t.trunk_type, max_channels: String(t.max_channels), status: t.status });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editingTrunk) return;
    try {
      const updateData: Record<string, unknown> = { name: editForm.name, host: editForm.host, port: parseInt(editForm.port), username: editForm.username, transport: editForm.transport, trunk_type: editForm.trunk_type, max_channels: parseInt(editForm.max_channels), status: editForm.status };
      if (editForm.password) updateData.password = editForm.password;
      await trunks.update(editingTrunk.id, updateData as Partial<PbxTrunk>);
      showToast("Trunk updated", "success");
      setEditOpen(false);
      await loadTrunks();
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this trunk?")) return;
    try { await trunks.delete(id); showToast("Trunk deleted", "success"); await loadTrunks(); }
    catch (e) { showToast(e instanceof Error ? e.message : "Failed to delete", "error"); }
  }

  // ── Data-table wiring ──────────────────────────────────────────────────
  const columns: ColumnDef<PbxTrunk>[] = [
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
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      enableHiding: false,
    },
    {
      id: "host",
      header: "Host",
      cell: ({ row }) => <span className="font-mono text-sm">{row.original.host}:{row.original.port}</span>,
    },
    {
      accessorKey: "trunk_type",
      header: "Type",
      cell: ({ row }) => <Badge variant="outline" className="text-xs capitalize">{row.original.trunk_type}</Badge>,
    },
    {
      accessorKey: "transport",
      header: "Transport",
      cell: ({ row }) => <span className="text-sm uppercase">{row.original.transport}</span>,
    },
    {
      accessorKey: "max_channels",
      header: "Channels",
      cell: ({ row }) => <span className="text-sm">{row.original.max_channels}</span>,
    },
    {
      accessorKey: "registration_status",
      header: "Registration",
      cell: ({ row }) => (
        <Badge variant={regStatusColors[row.original.registration_status] as "default" | "secondary" | "destructive" || "secondary"} className="text-xs capitalize">
          {row.original.registration_status || "unknown"}
        </Badge>
      ),
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
        isAdmin ? (
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
        ) : null
      ),
    },
  ];

  const [data, setData] = useState<PbxTrunk[]>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const sortableId = useId();
  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  useEffect(() => { setData(trunkList); }, [trunkList]);
  const dataIds = useMemo<UniqueIdentifier[]>(() => data.map((t) => t.id), [data]);

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
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SIP Trunks</h1>
          <p className="text-sm text-muted-foreground">Manage SIP trunk connections to carriers</p>
        </div>
        {isAdmin && <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1.5" />Add Trunk</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Create Trunk</DialogTitle><DialogDescription>Connect a SIP carrier</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tata SIP" /></div>
                <div className="space-y-1.5"><Label>Host</Label><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="sip.provider.com" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label>Port</Label><Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Transport</Label>
                  <Select value={form.transport} onValueChange={(v) => setForm({ ...form, transport: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="udp">UDP</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="tls">TLS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Type</Label>
                  <Select value={form.trunk_type} onValueChange={(v) => setForm({ ...form, trunk_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inbound">Inbound</SelectItem>
                      <SelectItem value="outbound">Outbound</SelectItem>
                      <SelectItem value="peer2peer">Peer-to-Peer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Username</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="SIP username" /></div>
                <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="SIP password" /></div>
              </div>
              <div className="space-y-1.5"><Label>Max Channels</Label><Input type="number" value={form.max_channels} onChange={(e) => setForm({ ...form, max_channels: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>}
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
                    No trunks configured
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

      {/* Developer trunk request */}
      <Card className="max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            <CardTitle className="text-base">Need a SIP trunk?</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Get a free developer SIP trunk with 1 channel and 1 Indian DID for 30 days. Perfect for testing.
          </p>
        </CardHeader>
        <CardFooter>
          <a href="mailto:cats@astradial.com?subject=Developer%20SIP%20Trunk%20Request&body=Hi%2C%20I%20would%20like%20a%20free%20developer%20SIP%20trunk%20for%20testing%20Astradial.%0A%0AMy%20name%3A%20%0AGitHub%3A%20" className="w-full">
            <Button variant="outline" className="w-full gap-2">
              <Mail className="h-4 w-4" />
              Request Free Trunk
            </Button>
          </a>
        </CardFooter>
      </Card>

      {/* Edit Trunk Dialog — admin only */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Trunk — {editingTrunk?.name}</DialogTitle>
            <DialogDescription>Update trunk configuration and channel limits</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Host</Label><Input value={editForm.host} onChange={(e) => setEditForm({ ...editForm, host: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Port</Label><Input value={editForm.port} onChange={(e) => setEditForm({ ...editForm, port: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Transport</Label>
                <Select value={editForm.transport} onValueChange={(v) => setEditForm({ ...editForm, transport: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="tls">TLS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Type</Label>
                <Select value={editForm.trunk_type} onValueChange={(v) => setEditForm({ ...editForm, trunk_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inbound">Inbound</SelectItem>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="peer2peer">Peer-to-Peer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Username</Label><Input value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} placeholder="SIP username" /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} placeholder="Leave blank to keep current" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Max Channels</Label>
                <Input type="number" value={editForm.max_channels} onChange={(e) => setEditForm({ ...editForm, max_channels: e.target.value })} />
              </div>
              <div className="space-y-1.5"><Label>Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
