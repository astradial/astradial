"use client";

import { useParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { format } from "date-fns";
import { Plus, Search, Building2, Pencil, Trash2, UserPlus, Eye } from "lucide-react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconDotsVertical,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DragHandle, DraggableRow } from "@/components/ui/data-table-parts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/Toast";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { companies, type Company, activities, type Activity, stats as crmStats, type CrmStats } from "@/lib/crm/client";
import { users as pbxUsers, type PbxUser } from "@/lib/pbx/client";

const SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"];

export default function ClientsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [statData, setStatData] = useState<CrmStats | null>(null);

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: "", industry: "", size: "", phone: "", email: "", website: "", address: "", notes: "" });
  const [saving, setSaving] = useState(false);

  // Detail sheet
  const [selected, setSelected] = useState<Company | null>(null);
  const [companyActivities, setCompanyActivities] = useState<Activity[]>([]);

  // Users for assignment
  const [orgUsers, setOrgUsers] = useState<PbxUser[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Company | null>(null);
  const [assignTo, setAssignTo] = useState("");

  useEffect(() => { load(); loadStats(); loadUsers(); }, [orgId, page, limit, search]);

  async function load() {
    setLoading(true);
    try {
      const res = await companies.list({ page, limit, search: search || undefined });
      setData(res.data);
      setTotal(res.total);
      setPages(res.pages || 1);
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setLoading(false);
  }

  async function loadStats() {
    try { setStatData(await crmStats.get()); } catch {}
  }

  async function loadUsers() {
    try { setOrgUsers(await pbxUsers.list()); } catch {}
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: "", industry: "", size: "", phone: "", email: "", website: "", address: "", notes: "" });
    setFormOpen(true);
  }

  function openEdit(c: Company) {
    setEditing(c);
    setForm({ name: c.name, industry: c.industry || "", size: c.size || "", phone: c.phone || "", email: c.email || "", website: c.website || "", address: c.address || "", notes: c.notes || "" });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { showToast("Name is required", "error"); return; }
    setSaving(true);
    try {
      if (editing) {
        await companies.update(editing.id, form);
        showToast("Company updated", "success");
      } else {
        await companies.create(form);
        showToast("Company created", "success");
      }
      setFormOpen(false);
      load();
      loadStats();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try {
      await companies.delete(id);
      showToast("Company deleted", "success");
      load();
      loadStats();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function openDetail(c: Company) {
    try {
      const full = await companies.get(c.id);
      setSelected(full);
      const acts = await activities.list({ company_id: c.id, limit: 20 });
      setCompanyActivities(acts.data);
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function handleAssign() {
    if (!assignTarget) return;
    try {
      await companies.update(assignTarget.id, { assigned_to: assignTo || null } as Partial<Company>);
      showToast("Assigned", "success");
      setAssignOpen(false);
      load();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  function getUserName(id: string | null) {
    if (!id) return "Unassigned";
    const u = orgUsers.find(u => u.id === id);
    return u ? (u.full_name || u.username) : id.slice(0, 8);
  }

  // ── Data-table wiring ──
  const columns: ColumnDef<Company>[] = [
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
      header: "Company",
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => openDetail(row.original)}
          className="flex items-center gap-2 text-left font-medium hover:underline"
        >
          <div className="flex items-center justify-center h-8 w-8 rounded-md bg-accent text-accent-foreground text-xs font-semibold">
            {row.original.name.charAt(0).toUpperCase()}
          </div>
          {row.original.name}
        </button>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "industry",
      header: "Industry",
      cell: ({ row }) => <span>{row.original.industry || "—"}</span>,
    },
    {
      accessorKey: "size",
      header: "Size",
      cell: ({ row }) => row.original.size ? <Badge variant="secondary">{row.original.size}</Badge> : <span>—</span>,
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => <span>{row.original.phone || "—"}</span>,
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) => <span>{row.original.email || "—"}</span>,
    },
    {
      id: "assigned",
      header: "Assigned To",
      cell: ({ row }) => <Badge variant="outline">{getUserName(row.original.assigned_to)}</Badge>,
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => <span className="text-muted-foreground text-xs">{format(new Date(row.original.createdAt), "dd MMM yyyy")}</span>,
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
            <DropdownMenuItem onClick={() => openDetail(row.original)}>
              <Eye className="h-4 w-4 mr-2" />View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openEdit(row.original)}>
              <Pencil className="h-4 w-4 mr-2" />Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setAssignTarget(row.original); setAssignTo(row.original.assigned_to || ""); setAssignOpen(true); }}>
              <UserPlus className="h-4 w-4 mr-2" />Assign
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => handleDelete(row.original.id)}
            >
              <Trash2 className="h-4 w-4 mr-2" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const [rowSelection, setRowSelection] = useState({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const sortableId = useId();
  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  const dataIds = useMemo<UniqueIdentifier[]>(() => data.map((c) => c.id), [data]);

  const table = useReactTable({
    data,
    columns,
    pageCount: pages,
    state: { sorting, columnVisibility, rowSelection, pagination: { pageIndex: page - 1, pageSize: limit } },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    manualPagination: true,
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
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-muted-foreground">Manage companies and accounts</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add Company</Button>
      </div>

      {/* Stats */}
      {statData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Companies</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{statData.companies}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Contacts</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{statData.contacts}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Open Deals</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{statData.open_deals}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pipeline Value</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{"\u20B9"}{(statData.pipeline_value || 0).toLocaleString()}</p></CardContent></Card>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search companies..." className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      {/* Table */}
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
                    No companies found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DndContext>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-2">
        <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
          {table.getFilteredSelectedRowModel().rows.length} of {data.length} row(s) selected. {total} total.
        </div>
        <div className="flex w-full items-center gap-8 lg:w-fit">
          <div className="hidden items-center gap-2 lg:flex">
            <Label htmlFor="clients-rows-per-page" className="text-sm font-medium">Rows per page</Label>
            <Select value={`${limit}`} onValueChange={(value) => { setLimit(Number(value)); setPage(1); }}>
              <SelectTrigger className="w-20" id="clients-rows-per-page">
                <SelectValue placeholder={limit} />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 25, 50, 100].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-fit items-center justify-center text-sm font-medium">
            Page {page} of {pages || 1}
          </div>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => setPage(1)} disabled={page <= 1}>
              <span className="sr-only">Go to first page</span>
              <IconChevronsLeft className="size-4" />
            </Button>
            <Button variant="outline" className="size-8" size="icon" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              <span className="sr-only">Go to previous page</span>
              <IconChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" className="size-8" size="icon" onClick={() => setPage(p => Math.min(pages || 1, p + 1))} disabled={page >= (pages || 1)}>
              <span className="sr-only">Go to next page</span>
              <IconChevronRight className="size-4" />
            </Button>
            <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => setPage(pages || 1)} disabled={page >= (pages || 1)}>
              <span className="sr-only">Go to last page</span>
              <IconChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Company" : "Add Company"}</DialogTitle>
            <DialogDescription>Fill in the company details below.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Company Name *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Industry</Label>
                <Input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} placeholder="e.g. Healthcare" />
              </div>
              <div className="grid gap-2">
                <Label>Size</Label>
                <Select value={form.size} onValueChange={v => setForm({ ...form, size: v })}>
                  <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                  <SelectContent>{SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Website</Label>
              <Input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="https://" />
            </div>
            <div className="grid gap-2">
              <Label>Address</Label>
              <Textarea rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign Company</DialogTitle><DialogDescription>Select a team member to assign.</DialogDescription></DialogHeader>
          <div className="grid gap-2 py-2">
            <Label>Assign to</Label>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {orgUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.username} ({u.extension})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" /> {selected.name}
                </SheetTitle>
                <SheetDescription>Company details and activity</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Industry</p><p>{selected.industry || "—"}</p></div>
                  <div><p className="text-muted-foreground">Size</p><p>{selected.size || "—"}</p></div>
                  <div><p className="text-muted-foreground">Phone</p><p>{selected.phone || "—"}</p></div>
                  <div><p className="text-muted-foreground">Email</p><p>{selected.email || "—"}</p></div>
                  <div className="col-span-2"><p className="text-muted-foreground">Website</p><p>{selected.website || "—"}</p></div>
                  <div className="col-span-2"><p className="text-muted-foreground">Address</p><p>{selected.address || "—"}</p></div>
                </div>
                {selected.notes && (<><Separator /><div><p className="text-sm text-muted-foreground mb-1">Notes</p><p className="text-sm">{selected.notes}</p></div></>)}
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Contacts ({(selected.contacts || []).length})</p>
                  {(selected.contacts || []).length === 0 ? <p className="text-sm text-muted-foreground">No contacts linked</p> : (
                    <div className="space-y-1">{(selected.contacts as { id: string; first_name: string; last_name?: string; email?: string }[]).map(ct => (
                      <div key={ct.id} className="flex items-center justify-between text-sm py-1">
                        <span>{ct.first_name} {ct.last_name || ""}</span>
                        <span className="text-muted-foreground">{ct.email || ""}</span>
                      </div>
                    ))}</div>
                  )}
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Recent Activity</p>
                  {companyActivities.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet</p> : (
                    <div className="space-y-2">{companyActivities.map(a => (
                      <div key={a.id} className="flex items-start gap-2 text-sm">
                        <Badge variant="outline" className="text-[10px] shrink-0">{a.type}</Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{a.subject || a.type}</p>
                          {a.body && <p className="text-muted-foreground truncate">{a.body}</p>}
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">{format(new Date(a.createdAt), "dd MMM")}</span>
                      </div>
                    ))}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
