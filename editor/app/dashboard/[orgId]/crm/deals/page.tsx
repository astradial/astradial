"use client";

import { useParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { format } from "date-fns";
import { Plus, Search, MoreHorizontal, Pencil, Trash2, UserPlus, LayoutGrid, List } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { deals, companies, contacts, pipelines, type Deal, type Company, type Contact, type PipelineStage, DEFAULT_DEAL_STAGES, stats as crmStats } from "@/lib/crm/client";
import { users as pbxUsers, type PbxUser } from "@/lib/pbx/client";
import { KanbanBoard, type KanbanItem } from "@/components/crm/KanbanBoard";

export default function DealsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [pipelineValue, setPipelineValue] = useState(0);
  const [wonValue, setWonValue] = useState(0);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [form, setForm] = useState({ title: "", stage: "lead", amount: "", currency: "INR", expected_close: "", company_id: "", contact_id: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [contactList, setContactList] = useState<Contact[]>([]);
  const [orgUsers, setOrgUsers] = useState<PbxUser[]>([]);

  // Pipeline stages
  const [stages, setStages] = useState<PipelineStage[]>(DEFAULT_DEAL_STAGES);
  const stageKeys = stages.map(s => s.stage_key);
  const stageLabels = Object.fromEntries(stages.map(s => [s.stage_key, s.stage_label]));

  // Assign
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Deal | null>(null);
  const [assignTo, setAssignTo] = useState("");

  useEffect(() => { load(); loadCompanies(); loadContacts(); loadUsers(); loadStats(); loadStages(); }, [orgId, page, limit, search]);

  async function loadStages() {
    try { setStages(await pipelines.get("deal")); } catch {}
  }

  async function load() {
    setLoading(true);
    try {
      const res = await deals.list({ page, limit, search: search || undefined });
      setData(res.data);
      setTotal(res.total);
      setPages(res.pages || 1);
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setLoading(false);
  }

  async function loadStats() {
    try {
      const s = await crmStats.get();
      setPipelineValue(s.pipeline_value);
      setWonValue(s.won_value);
    } catch {}
  }

  async function loadCompanies() { try { const r = await companies.list({ limit: 100 }); setCompanyList(r.data); } catch {} }
  async function loadContacts() { try { const r = await contacts.list({ limit: 100 }); setContactList(r.data); } catch {} }
  async function loadUsers() { try { setOrgUsers(await pbxUsers.list()); } catch {} }

  function openCreate() {
    setEditing(null);
    setForm({ title: "", stage: "lead", amount: "", currency: "INR", expected_close: "", company_id: "", contact_id: "", notes: "" });
    setFormOpen(true);
  }

  function openEdit(d: Deal) {
    setEditing(d);
    setForm({
      title: d.title, stage: d.stage, amount: d.amount != null ? String(d.amount) : "",
      currency: d.currency, expected_close: d.expected_close || "",
      company_id: d.company_id || "", contact_id: d.contact_id || "", notes: d.notes || "",
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) { showToast("Title is required", "error"); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        stage: form.stage as Deal["stage"],
        amount: form.amount ? parseFloat(form.amount) : null,
        company_id: form.company_id || null,
        contact_id: form.contact_id || null,
        expected_close: form.expected_close || null,
      };
      if (editing) {
        await deals.update(editing.id, payload);
        showToast("Deal updated", "success");
      } else {
        await deals.create(payload);
        showToast("Deal created", "success");
      }
      setFormOpen(false);
      load();
      loadStats();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try { await deals.delete(id); showToast("Deal deleted", "success"); load(); loadStats(); }
    catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function handleStageChange(itemId: string, newStage: string) {
    // Optimistic update — move card instantly, sync API in background
    const prev = data;
    setData(d => d.map(deal => deal.id === itemId ? { ...deal, stage: newStage as Deal["stage"] } : deal));
    try {
      await deals.updateStage(itemId, newStage);
      loadStats();
    } catch (e: unknown) {
      setData(prev); // revert on failure
      showToast((e as Error).message, "error");
    }
  }

  async function handleAssign() {
    if (!assignTarget) return;
    try {
      await deals.assign(assignTarget.id, assignTo === "none" ? null : assignTo);
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

  const kanbanItems: (Deal & KanbanItem)[] = data.map(d => ({ ...d, stage: d.stage }));

  function renderDealCard(item: Deal & KanbanItem) {
    return (
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium truncate">{item.title}</p>
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
          <div className="flex items-center justify-between">
            {item.amount != null ? (
              <span className="text-sm font-semibold">{"\u20B9"}{Number(item.amount).toLocaleString()}</span>
            ) : (
              <span className="text-xs text-muted-foreground">No amount</span>
            )}
            {item.expected_close && <span className="text-[10px] text-muted-foreground">{format(new Date(item.expected_close), "dd MMM")}</span>}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.contact && <Badge variant="secondary" className="text-[10px]">{item.contact.first_name}</Badge>}
            {item.assigned_to && <Badge variant="outline" className="text-[10px]">{getUserName(item.assigned_to)}</Badge>}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Data-table wiring ──
  const columns: ColumnDef<Deal>[] = [
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
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      enableHiding: false,
    },
    {
      id: "company",
      header: "Company",
      cell: ({ row }) => <span>{row.original.company?.name || "—"}</span>,
    },
    {
      accessorKey: "stage",
      header: "Stage",
      cell: ({ row }) => (
        <Badge variant="outline" className="px-1.5 text-muted-foreground">
          {stageLabels[row.original.stage] || row.original.stage}
        </Badge>
      ),
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => <span>{row.original.amount != null ? `${"\u20B9"}${Number(row.original.amount).toLocaleString()}` : "—"}</span>,
    },
    {
      accessorKey: "expected_close",
      header: "Close Date",
      cell: ({ row }) => <span>{row.original.expected_close ? format(new Date(row.original.expected_close), "dd MMM yyyy") : "—"}</span>,
    },
    {
      id: "assigned",
      header: "Assigned",
      cell: ({ row }) => <Badge variant="outline">{getUserName(row.original.assigned_to)}</Badge>,
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

  const dataIds = useMemo<UniqueIdentifier[]>(() => data.map((d) => d.id), [data]);

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
          <h1 className="text-2xl font-semibold">Deals</h1>
          <p className="text-sm text-muted-foreground">{total} deals in pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={v => setView(v as "kanban" | "list")}>
            <TabsList>
              <TabsTrigger value="kanban"><LayoutGrid className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="list"><List className="h-4 w-4" /></TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add Deal</Button>
        </div>
      </div>

      {/* Pipeline stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pipeline Value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{"\u20B9"}{(pipelineValue || 0).toLocaleString()}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Won Value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{"\u20B9"}{(wonValue || 0).toLocaleString()}</p></CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search deals..." className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
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
            renderCard={renderDealCard}
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
                        No deals found
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
                <Label htmlFor="deals-rows-per-page" className="text-sm font-medium">Rows per page</Label>
                <Select value={`${limit}`} onValueChange={(value) => { setLimit(Number(value)); setPage(1); }}>
                  <SelectTrigger className="w-20" id="deals-rows-per-page">
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
          <DialogHeader><DialogTitle>{editing ? "Edit Deal" : "Add Deal"}</DialogTitle><DialogDescription>Enter deal details.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Title *</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Stage</Label>
                <Select value={form.stage} onValueChange={v => setForm({ ...form, stage: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{stageKeys.map(s => <SelectItem key={s} value={s}>{stageLabels[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Amount ({form.currency})</Label>
                <Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
              <div className="grid gap-2">
                <Label>Contact</Label>
                <Select value={form.contact_id} onValueChange={v => setForm({ ...form, contact_id: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {contactList.map(c => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name || ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Expected Close Date</Label>
              <Input type="date" value={form.expected_close} onChange={e => setForm({ ...form, expected_close: e.target.value })} />
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
          <DialogHeader><DialogTitle>Assign Deal</DialogTitle><DialogDescription>Select a team member to assign.</DialogDescription></DialogHeader>
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
