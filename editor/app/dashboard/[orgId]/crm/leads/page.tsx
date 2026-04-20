"use client";

import { useParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { format } from "date-fns";
import { Plus, Search, Pencil, Trash2, UserPlus, LayoutGrid, List } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MoreHorizontal } from "lucide-react";
import { showToast } from "@/components/ui/Toast";
import { contacts, companies, pipelines, type Contact, type Company, type PipelineStage, DEFAULT_LEAD_STAGES } from "@/lib/crm/client";
import { users as pbxUsers, type PbxUser } from "@/lib/pbx/client";
import { KanbanBoard, type KanbanItem } from "@/components/crm/KanbanBoard";

const SOURCES = ["website", "phone", "referral", "social", "advertisement", "cold_call", "event", "other"];

export default function LeadsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "list">("kanban");

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", job_title: "", lead_source: "", lead_status: "new", company_id: "", notes: "" });
  const [saving, setSaving] = useState(false);

  // Company list for select
  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [orgUsers, setOrgUsers] = useState<PbxUser[]>([]);

  // Pipeline stages
  const [stages, setStages] = useState<PipelineStage[]>(DEFAULT_LEAD_STAGES);
  const stageKeys = stages.map(s => s.stage_key);
  const stageLabels = Object.fromEntries(stages.map(s => [s.stage_key, s.stage_label]));

  // Assign
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Contact | null>(null);
  const [assignTo, setAssignTo] = useState("");

  useEffect(() => { load(); loadCompanies(); loadUsers(); loadStages(); }, [orgId, page, limit, search]);

  async function loadStages() {
    try { setStages(await pipelines.get("lead")); } catch {}
  }

  async function load() {
    setLoading(true);
    try {
      const res = await contacts.list({ page, limit, search: search || undefined });
      setData(res.data);
      setTotal(res.total);
      setPages(res.pages || 1);
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setLoading(false);
  }

  async function loadCompanies() {
    try { const res = await companies.list({ limit: 100 }); setCompanyList(res.data); } catch {}
  }

  async function loadUsers() {
    try { setOrgUsers(await pbxUsers.list()); } catch {}
  }

  function openCreate() {
    setEditing(null);
    setForm({ first_name: "", last_name: "", email: "", phone: "", job_title: "", lead_source: "", lead_status: "new", company_id: "", notes: "" });
    setFormOpen(true);
  }

  function openEdit(c: Contact) {
    setEditing(c);
    setForm({
      first_name: c.first_name, last_name: c.last_name || "", email: c.email || "",
      phone: c.phone || "", job_title: c.job_title || "", lead_source: c.lead_source || "",
      lead_status: c.lead_status, company_id: c.company_id || "", notes: c.notes || "",
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.first_name.trim()) { showToast("First name is required", "error"); return; }
    setSaving(true);
    try {
      const payload = { ...form, lead_status: form.lead_status as Contact["lead_status"], company_id: form.company_id || null };
      if (editing) {
        await contacts.update(editing.id, payload);
        showToast("Contact updated", "success");
      } else {
        await contacts.create(payload);
        showToast("Lead created", "success");
      }
      setFormOpen(false);
      load();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try { await contacts.delete(id); showToast("Lead deleted", "success"); load(); }
    catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function handleStageChange(itemId: string, newStage: string) {
    // Optimistic update — move card instantly, sync API in background
    const prev = data;
    setData(d => d.map(c => c.id === itemId ? { ...c, lead_status: newStage as Contact["lead_status"] } : c));
    try {
      await contacts.updateStatus(itemId, newStage);
    } catch (e: unknown) {
      setData(prev); // revert on failure
      showToast((e as Error).message, "error");
    }
  }

  async function handleAssign() {
    if (!assignTarget) return;
    try {
      await contacts.assign(assignTarget.id, assignTo === "none" ? null : assignTo);
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

  // Map contacts to KanbanItem
  const kanbanItems: (Contact & KanbanItem)[] = data.map(c => ({ ...c, stage: c.lead_status }));

  function renderLeadCard(item: Contact & KanbanItem) {
    return (
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium truncate">{item.first_name} {item.last_name || ""}</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3 w-3" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(item)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setAssignTarget(item); setAssignTo(item.assigned_to || ""); setAssignOpen(true); }}><UserPlus className="h-4 w-4 mr-2" /> Assign</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {item.company && <p className="text-xs text-muted-foreground">{item.company.name}</p>}
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.lead_source && <Badge variant="secondary" className="text-[10px]">{item.lead_source}</Badge>}
            {item.assigned_to && <Badge variant="outline" className="text-[10px]">{getUserName(item.assigned_to)}</Badge>}
          </div>
          {item.phone && <p className="text-xs text-muted-foreground">{item.phone}</p>}
        </CardContent>
      </Card>
    );
  }

  // ── Data-table wiring ──
  const columns: ColumnDef<Contact>[] = [
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
      accessorKey: "first_name",
      header: "Name",
      cell: ({ row }) => <span className="font-medium">{row.original.first_name} {row.original.last_name || ""}</span>,
      enableHiding: false,
    },
    {
      id: "company",
      header: "Company",
      cell: ({ row }) => <span>{row.original.company?.name || "—"}</span>,
    },
    {
      accessorKey: "lead_status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="outline" className="px-1.5 text-muted-foreground">
          {stageLabels[row.original.lead_status] || row.original.lead_status}
        </Badge>
      ),
    },
    {
      accessorKey: "lead_source",
      header: "Source",
      cell: ({ row }) => <span>{row.original.lead_source || "—"}</span>,
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => <span>{row.original.phone || "—"}</span>,
    },
    {
      id: "assigned",
      header: "Assigned",
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
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">{total} contacts in pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={v => setView(v as "kanban" | "list")}>
            <TabsList>
              <TabsTrigger value="kanban"><LayoutGrid className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="list"><List className="h-4 w-4" /></TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add Lead</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search leads..." className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      {view === "kanban" ? (
        loading ? (
          <p className="text-muted-foreground text-center py-12">Loading...</p>
        ) : (
          <KanbanBoard
            stages={stageKeys}
            stageLabels={stageLabels}
            items={kanbanItems}
            onStageChange={handleStageChange}
            renderCard={renderLeadCard}
          />
        )
      ) : (
        <>
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
                        No leads found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DndContext>
          </div>

          <div className="flex items-center justify-between px-2">
            <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
              {table.getFilteredSelectedRowModel().rows.length} of {data.length} row(s) selected.
            </div>
            <div className="flex w-full items-center gap-8 lg:w-fit">
              <div className="hidden items-center gap-2 lg:flex">
                <Label htmlFor="leads-rows-per-page" className="text-sm font-medium">Rows per page</Label>
                <Select value={`${limit}`} onValueChange={(value) => { setLimit(Number(value)); setPage(1); }}>
                  <SelectTrigger className="w-20" id="leads-rows-per-page">
                    <SelectValue placeholder={limit} />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {[25, 50, 100, 200].map((pageSize) => (
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
        </>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Lead" : "Add Lead"}</DialogTitle><DialogDescription>Enter contact and lead details.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>First Name *</Label><Input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Last Name</Label><Input value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Job Title</Label><Input value={form.job_title} onChange={e => setForm({ ...form, job_title: e.target.value })} /></div>
              <div className="grid gap-2">
                <Label>Lead Source</Label>
                <Select value={form.lead_source} onValueChange={v => setForm({ ...form, lead_source: v })}>
                  <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                  <SelectContent>{SOURCES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.lead_status} onValueChange={v => setForm({ ...form, lead_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{stageKeys.map(s => <SelectItem key={s} value={s}>{stageLabels[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.company_id} onValueChange={v => setForm({ ...form, company_id: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {companyList.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
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
          <DialogHeader><DialogTitle>Assign Lead</DialogTitle><DialogDescription>Select a team member to assign.</DialogDescription></DialogHeader>
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
    </div>
  );
}
