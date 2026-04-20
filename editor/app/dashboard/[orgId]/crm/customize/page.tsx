"use client";

import { useParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DragHandle, DraggableRow } from "@/components/ui/data-table-parts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { customFields, pipelines, type CustomField, type PipelineStage, DEFAULT_LEAD_STAGES, DEFAULT_DEAL_STAGES } from "@/lib/crm/client";

const ENTITY_TYPES = ["contact", "company", "deal"] as const;
const ENTITY_LABELS: Record<string, string> = { contact: "Contacts", company: "Companies", deal: "Deals" };
const FIELD_TYPES = ["text", "number", "date", "select", "checkbox", "email", "phone", "url", "textarea"] as const;
const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text", number: "Number", date: "Date", select: "Select (Dropdown)",
  checkbox: "Checkbox", email: "Email", phone: "Phone", url: "URL", textarea: "Long Text",
};

type StageRow = PipelineStage & { id: string };

export default function CustomizePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [mainTab, setMainTab] = useState<"fields" | "pipelines">("pipelines");

  // ── Custom Fields state ──
  const [fields, setFields] = useState<CustomField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [activeEntityTab, setActiveEntityTab] = useState<string>("contact");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [form, setForm] = useState({ field_label: "", field_type: "text", required: false, options: "" });
  const [saving, setSaving] = useState(false);

  // ── Pipeline state ──
  const [leadStages, setLeadStages] = useState<PipelineStage[]>(DEFAULT_LEAD_STAGES);
  const [dealStages, setDealStages] = useState<PipelineStage[]>(DEFAULT_DEAL_STAGES);
  const [pipelineTab, setPipelineTab] = useState<"lead" | "deal">("lead");
  const [editingStage, setEditingStage] = useState<{ index: number; label: string } | null>(null);
  const [newStageLabel, setNewStageLabel] = useState("");
  const [pipelineSaving, setPipelineSaving] = useState(false);

  useEffect(() => { loadFields(); loadPipelines(); }, [orgId]);

  // ── Custom Fields logic ──
  async function loadFields() {
    setFieldsLoading(true);
    try { setFields(await customFields.list()); }
    catch (e: unknown) { showToast((e as Error).message, "error"); }
    setFieldsLoading(false);
  }

  function openCreateField() {
    setEditing(null);
    setForm({ field_label: "", field_type: "text", required: false, options: "" });
    setFormOpen(true);
  }

  function openEditField(f: CustomField) {
    setEditing(f);
    setForm({ field_label: f.field_label, field_type: f.field_type, required: f.required, options: (f.options || []).join(", ") });
    setFormOpen(true);
  }

  async function handleSaveField() {
    if (!form.field_label.trim()) { showToast("Label is required", "error"); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { field_label: form.field_label, field_type: form.field_type, required: form.required, entity_type: activeEntityTab };
      if (form.field_type === "select" && form.options.trim()) payload.options = form.options.split(",").map(o => o.trim()).filter(Boolean);
      if (editing) { await customFields.update(editing.id, payload as Partial<CustomField>); showToast("Field updated", "success"); }
      else { await customFields.create(payload as Partial<CustomField>); showToast("Field created", "success"); }
      setFormOpen(false);
      loadFields();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setSaving(false);
  }

  async function handleDeleteField(id: string) {
    try { await customFields.delete(id); showToast("Field deleted", "success"); loadFields(); }
    catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  const filteredFields = fields.filter(f => f.entity_type === activeEntityTab);

  // ── Pipeline logic ──
  async function loadPipelines() {
    try {
      const [lead, deal] = await Promise.all([pipelines.get("lead"), pipelines.get("deal")]);
      setLeadStages(lead);
      setDealStages(deal);
    } catch {}
  }

  const currentStages = pipelineTab === "lead" ? leadStages : dealStages;
  const setCurrentStages = pipelineTab === "lead" ? setLeadStages : setDealStages;

  function addStage() {
    if (!newStageLabel.trim()) return;
    const key = newStageLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (currentStages.some(s => s.stage_key === key)) { showToast("Stage already exists", "error"); return; }
    setCurrentStages([...currentStages, { stage_key: key, stage_label: newStageLabel.trim(), sort_order: currentStages.length }]);
    setNewStageLabel("");
  }

  function removeStage(index: number) {
    setCurrentStages(currentStages.filter((_, i) => i !== index).map((s, i) => ({ ...s, sort_order: i })));
  }

  function renameStage(index: number, newLabel: string) {
    setCurrentStages(currentStages.map((s, i) => i === index ? { ...s, stage_label: newLabel } : s));
    setEditingStage(null);
  }

  async function savePipeline() {
    setPipelineSaving(true);
    try {
      await pipelines.save(pipelineTab, currentStages);
      showToast(`${pipelineTab === "lead" ? "Lead" : "Deal"} pipeline saved`, "success");
      loadPipelines();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setPipelineSaving(false);
  }

  // ── Stage table wiring ──────────────────────────────────────────────────
  // PipelineStage has no guaranteed `id`, so we map `stage_key` in for dnd.
  const stageRows: StageRow[] = useMemo(
    () => currentStages.map((s) => ({ ...s, id: s.id ?? s.stage_key })),
    [currentStages]
  );

  const stageColumns: ColumnDef<StageRow>[] = [
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
      id: "order",
      header: "Order",
      cell: ({ row }) => <span className="text-muted-foreground">{row.index + 1}</span>,
    },
    {
      accessorKey: "stage_label",
      header: "Stage Name",
      cell: ({ row }) => <span className="font-medium">{row.original.stage_label}</span>,
      enableHiding: false,
    },
    {
      accessorKey: "stage_key",
      header: "Key",
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.stage_key}</span>,
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
            <DropdownMenuItem onClick={() => setEditingStage({ index: row.index, label: row.original.stage_label })}>
              <Pencil className="h-4 w-4 mr-2" />Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={currentStages.length <= 2}
              onClick={() => removeStage(row.index)}
            >
              <Trash2 className="h-4 w-4 mr-2" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const [stageRowSelection, setStageRowSelection] = useState({});
  const [stageColumnVisibility, setStageColumnVisibility] = useState<VisibilityState>({});
  const [stageSorting, setStageSorting] = useState<SortingState>([]);
  const [stagePagination, setStagePagination] = useState({ pageIndex: 0, pageSize: 10 });
  const stageSortableId = useId();
  const stageSensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));
  const stageIds = useMemo<UniqueIdentifier[]>(() => stageRows.map((s) => s.id), [stageRows]);

  const stageTable = useReactTable({
    data: stageRows,
    columns: stageColumns,
    state: { sorting: stageSorting, columnVisibility: stageColumnVisibility, rowSelection: stageRowSelection, pagination: stagePagination },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setStageRowSelection,
    onSortingChange: setStageSorting,
    onColumnVisibilityChange: setStageColumnVisibility,
    onPaginationChange: setStagePagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handleStageDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setCurrentStages((prev) => {
        const ids = prev.map((s) => s.id ?? s.stage_key);
        const oldIndex = ids.indexOf(active.id as string);
        const newIndex = ids.indexOf(over.id as string);
        if (oldIndex < 0 || newIndex < 0) return prev;
        return arrayMove(prev, oldIndex, newIndex).map((s, i) => ({ ...s, sort_order: i }));
      });
    }
  }

  // ── Custom fields table wiring ─────────────────────────────────────────
  const fieldColumns: ColumnDef<CustomField>[] = [
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
      accessorKey: "field_label",
      header: "Label",
      cell: ({ row }) => <span className="font-medium">{row.original.field_label}</span>,
      enableHiding: false,
    },
    {
      accessorKey: "field_name",
      header: "Field Name",
      cell: ({ row }) => <span className="text-muted-foreground font-mono text-xs">{row.original.field_name}</span>,
    },
    {
      accessorKey: "field_type",
      header: "Type",
      cell: ({ row }) => <Badge variant="outline">{FIELD_TYPE_LABELS[row.original.field_type] || row.original.field_type}</Badge>,
    },
    {
      accessorKey: "required",
      header: "Required",
      cell: ({ row }) => (
        <Badge variant="outline" className="px-1.5 text-muted-foreground">
          {row.original.required ? (
            <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
          ) : (
            <IconLoader />
          )}
          {row.original.required ? "Required" : "Optional"}
        </Badge>
      ),
    },
    {
      accessorKey: "options",
      header: "Options",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground line-clamp-1">
          {(row.original.options || []).join(", ") || "—"}
        </span>
      ),
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
            <DropdownMenuItem onClick={() => openEditField(row.original)}>
              <Pencil className="h-4 w-4 mr-2" />Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => handleDeleteField(row.original.id)}
            >
              <Trash2 className="h-4 w-4 mr-2" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const [fieldData, setFieldData] = useState<CustomField[]>([]);
  const [fieldRowSelection, setFieldRowSelection] = useState({});
  const [fieldColumnVisibility, setFieldColumnVisibility] = useState<VisibilityState>({});
  const [fieldSorting, setFieldSorting] = useState<SortingState>([]);
  const [fieldPagination, setFieldPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const fieldSortableId = useId();
  const fieldSensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  useEffect(() => { setFieldData(filteredFields); }, [fields, activeEntityTab]);
  const fieldIds = useMemo<UniqueIdentifier[]>(() => fieldData.map((f) => f.id), [fieldData]);

  const fieldTable = useReactTable({
    data: fieldData,
    columns: fieldColumns,
    state: { sorting: fieldSorting, columnVisibility: fieldColumnVisibility, rowSelection: fieldRowSelection, pagination: fieldPagination },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setFieldRowSelection,
    onSortingChange: setFieldSorting,
    onColumnVisibilityChange: setFieldColumnVisibility,
    onPaginationChange: setFieldPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handleFieldDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setFieldData((prev) => {
        const oldIndex = fieldIds.indexOf(active.id);
        const newIndex = fieldIds.indexOf(over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Customize CRM</h1>
        <p className="text-sm text-muted-foreground">Configure pipelines and custom fields</p>
      </div>

      <Tabs value={mainTab} onValueChange={v => setMainTab(v as "fields" | "pipelines")}>
        <TabsList>
          <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
          <TabsTrigger value="fields">Custom Fields</TabsTrigger>
        </TabsList>

        {/* ── PIPELINES TAB ── */}
        <TabsContent value="pipelines">
          <Tabs value={pipelineTab} onValueChange={v => setPipelineTab(v as "lead" | "deal")}>
            <TabsList>
              <TabsTrigger value="lead">Lead Pipeline</TabsTrigger>
              <TabsTrigger value="deal">Deal Pipeline</TabsTrigger>
            </TabsList>

            {(["lead", "deal"] as const).map(pt => (
              <TabsContent key={pt} value={pt}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{pt === "lead" ? "Lead" : "Deal"} Pipeline Stages</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="overflow-hidden rounded-lg border">
                      <DndContext
                        collisionDetection={closestCenter}
                        modifiers={[restrictToVerticalAxis]}
                        onDragEnd={handleStageDragEnd}
                        sensors={stageSensors}
                        id={stageSortableId}
                      >
                        <Table>
                          <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
                            {stageTable.getHeaderGroups().map((headerGroup) => (
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
                            {stageTable.getRowModel().rows?.length ? (
                              <SortableContext items={stageIds} strategy={verticalListSortingStrategy}>
                                {stageTable.getRowModel().rows.map((row) => (
                                  <DraggableRow key={row.id} row={row} />
                                ))}
                              </SortableContext>
                            ) : (
                              <TableRow>
                                <TableCell colSpan={stageColumns.length} className="h-24 text-center text-muted-foreground">
                                  No stages
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </DndContext>
                    </div>

                    <div className="flex items-center justify-between px-2">
                      <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                        {stageTable.getFilteredSelectedRowModel().rows.length} of {stageTable.getFilteredRowModel().rows.length} row(s) selected.
                      </div>
                      <div className="flex w-full items-center gap-8 lg:w-fit">
                        <div className="hidden items-center gap-2 lg:flex">
                          <Label htmlFor="stage-rows-per-page" className="text-sm font-medium">Rows per page</Label>
                          <Select value={`${stageTable.getState().pagination.pageSize}`} onValueChange={(value) => stageTable.setPageSize(Number(value))}>
                            <SelectTrigger className="w-20" id="stage-rows-per-page">
                              <SelectValue placeholder={stageTable.getState().pagination.pageSize} />
                            </SelectTrigger>
                            <SelectContent side="top">
                              {[10, 20, 30, 40, 50].map((pageSize) => (
                                <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex w-fit items-center justify-center text-sm font-medium">
                          Page {stageTable.getState().pagination.pageIndex + 1} of {stageTable.getPageCount() || 1}
                        </div>
                        <div className="ml-auto flex items-center gap-2 lg:ml-0">
                          <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => stageTable.setPageIndex(0)} disabled={!stageTable.getCanPreviousPage()}>
                            <span className="sr-only">Go to first page</span>
                            <IconChevronsLeft className="size-4" />
                          </Button>
                          <Button variant="outline" className="size-8" size="icon" onClick={() => stageTable.previousPage()} disabled={!stageTable.getCanPreviousPage()}>
                            <span className="sr-only">Go to previous page</span>
                            <IconChevronLeft className="size-4" />
                          </Button>
                          <Button variant="outline" className="size-8" size="icon" onClick={() => stageTable.nextPage()} disabled={!stageTable.getCanNextPage()}>
                            <span className="sr-only">Go to next page</span>
                            <IconChevronRight className="size-4" />
                          </Button>
                          <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => stageTable.setPageIndex(stageTable.getPageCount() - 1)} disabled={!stageTable.getCanNextPage()}>
                            <span className="sr-only">Go to last page</span>
                            <IconChevronsRight className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Input placeholder="New stage name..." value={newStageLabel} onChange={e => setNewStageLabel(e.target.value)} className="max-w-xs" onKeyDown={e => e.key === "Enter" && addStage()} />
                      <Button variant="outline" size="sm" onClick={addStage} disabled={!newStageLabel.trim()}><Plus className="h-4 w-4 mr-1" /> Add Stage</Button>
                    </div>

                    <Separator />

                    <div className="flex justify-end">
                      <Button onClick={savePipeline} disabled={pipelineSaving}>{pipelineSaving ? "Saving..." : "Save Pipeline"}</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>

        {/* ── CUSTOM FIELDS TAB ── */}
        <TabsContent value="fields">
          <div className="flex items-center justify-end mb-4">
            <Button onClick={openCreateField}><Plus className="h-4 w-4 mr-1" /> Add Field</Button>
          </div>

          <Tabs value={activeEntityTab} onValueChange={setActiveEntityTab}>
            <TabsList>
              {ENTITY_TYPES.map(t => (
                <TabsTrigger key={t} value={t}>
                  {ENTITY_LABELS[t]}
                  <Badge variant="secondary" className="ml-1.5 text-[10px]">{fields.filter(f => f.entity_type === t).length}</Badge>
                </TabsTrigger>
              ))}
            </TabsList>

            {ENTITY_TYPES.map(t => (
              <TabsContent key={t} value={t}>
                <Card>
                  <CardHeader><CardTitle className="text-base">Custom Fields for {ENTITY_LABELS[t]}</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="overflow-hidden rounded-lg border">
                      <DndContext
                        collisionDetection={closestCenter}
                        modifiers={[restrictToVerticalAxis]}
                        onDragEnd={handleFieldDragEnd}
                        sensors={fieldSensors}
                        id={fieldSortableId}
                      >
                        <Table>
                          <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
                            {fieldTable.getHeaderGroups().map((headerGroup) => (
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
                            {fieldsLoading ? (
                              <TableRow>
                                <TableCell colSpan={fieldColumns.length} className="h-24 text-center text-muted-foreground">
                                  Loading...
                                </TableCell>
                              </TableRow>
                            ) : fieldTable.getRowModel().rows?.length ? (
                              <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
                                {fieldTable.getRowModel().rows.map((row) => (
                                  <DraggableRow key={row.id} row={row} />
                                ))}
                              </SortableContext>
                            ) : (
                              <TableRow>
                                <TableCell colSpan={fieldColumns.length} className="h-24 text-center text-muted-foreground">
                                  <div className="flex flex-col items-center gap-2 py-6">
                                    <p>No custom fields for {ENTITY_LABELS[t].toLowerCase()}</p>
                                    <Button variant="outline" size="sm" onClick={openCreateField}>
                                      <Plus className="h-4 w-4 mr-1" /> Add First Field
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </DndContext>
                    </div>

                    <div className="flex items-center justify-between px-2">
                      <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                        {fieldTable.getFilteredSelectedRowModel().rows.length} of {fieldTable.getFilteredRowModel().rows.length} row(s) selected.
                      </div>
                      <div className="flex w-full items-center gap-8 lg:w-fit">
                        <div className="hidden items-center gap-2 lg:flex">
                          <Label htmlFor="field-rows-per-page" className="text-sm font-medium">Rows per page</Label>
                          <Select value={`${fieldTable.getState().pagination.pageSize}`} onValueChange={(value) => fieldTable.setPageSize(Number(value))}>
                            <SelectTrigger className="w-20" id="field-rows-per-page">
                              <SelectValue placeholder={fieldTable.getState().pagination.pageSize} />
                            </SelectTrigger>
                            <SelectContent side="top">
                              {[10, 20, 30, 40, 50].map((pageSize) => (
                                <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex w-fit items-center justify-center text-sm font-medium">
                          Page {fieldTable.getState().pagination.pageIndex + 1} of {fieldTable.getPageCount() || 1}
                        </div>
                        <div className="ml-auto flex items-center gap-2 lg:ml-0">
                          <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => fieldTable.setPageIndex(0)} disabled={!fieldTable.getCanPreviousPage()}>
                            <span className="sr-only">Go to first page</span>
                            <IconChevronsLeft className="size-4" />
                          </Button>
                          <Button variant="outline" className="size-8" size="icon" onClick={() => fieldTable.previousPage()} disabled={!fieldTable.getCanPreviousPage()}>
                            <span className="sr-only">Go to previous page</span>
                            <IconChevronLeft className="size-4" />
                          </Button>
                          <Button variant="outline" className="size-8" size="icon" onClick={() => fieldTable.nextPage()} disabled={!fieldTable.getCanNextPage()}>
                            <span className="sr-only">Go to next page</span>
                            <IconChevronRight className="size-4" />
                          </Button>
                          <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => fieldTable.setPageIndex(fieldTable.getPageCount() - 1)} disabled={!fieldTable.getCanNextPage()}>
                            <span className="sr-only">Go to last page</span>
                            <IconChevronsRight className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>
      </Tabs>

      {/* Rename Stage Dialog */}
      <Dialog open={!!editingStage} onOpenChange={() => setEditingStage(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename Stage</DialogTitle><DialogDescription>Enter a new name for this stage.</DialogDescription></DialogHeader>
          <div className="grid gap-2 py-2">
            <Label>Stage Name</Label>
            <Input value={editingStage?.label || ""} onChange={e => editingStage && setEditingStage({ ...editingStage, label: e.target.value })} onKeyDown={e => e.key === "Enter" && editingStage && renameStage(editingStage.index, editingStage.label)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStage(null)}>Cancel</Button>
            <Button onClick={() => editingStage && renameStage(editingStage.index, editingStage.label)}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Field Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Custom Field" : "Add Custom Field"}</DialogTitle><DialogDescription>Configure the custom field properties.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Entity Type</Label>
              <Select value={activeEntityTab} disabled>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ENTITY_TYPES.map(t => <SelectItem key={t} value={t}>{ENTITY_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Field Label *</Label>
              <Input value={form.field_label} onChange={e => setForm({ ...form, field_label: e.target.value })} placeholder="e.g. Contract Number" />
            </div>
            <div className="grid gap-2">
              <Label>Field Type</Label>
              <Select value={form.field_type} onValueChange={v => setForm({ ...form, field_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FIELD_TYPES.map(t => <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {form.field_type === "select" && (
              <div className="grid gap-2">
                <Label>Options (comma-separated)</Label>
                <Input value={form.options} onChange={e => setForm({ ...form, options: e.target.value })} placeholder="Option 1, Option 2, Option 3" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox checked={form.required} onCheckedChange={c => setForm({ ...form, required: !!c })} id="required" />
              <Label htmlFor="required">Required field</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveField} disabled={saving}>{saving ? "Saving..." : editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
