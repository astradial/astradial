"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { BadgeCheck, Key, Phone, FileText, MessageSquare, RefreshCw } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { msg91, type Msg91Config, type Msg91Number, type Msg91Template } from "@/lib/msg91/client";

type TemplateRow = Msg91Template & { id: string };
type LogRow = Record<string, unknown> & { id: string };

export default function WhatsAppPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [config, setConfig] = useState<Msg91Config>({ configured: false, authkey_masked: "" });
  const [authkeyInput, setAuthkeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  const [numbers, setNumbers] = useState<Msg91Number[]>([]);
  const [templates, setTemplates] = useState<Msg91Template[]>([]);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [selectedNumber, setSelectedNumber] = useState("");

  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [logDate, setLogDate] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => { msg91.getConfig().then(setConfig).catch(() => {}); }, []);

  useEffect(() => {
    if (config.configured && numbers.length === 0) loadNumbers();
  }, [config.configured]);

  async function handleSaveKey() {
    if (!authkeyInput) return;
    setSaving(true);
    try {
      const result = await msg91.setConfig(authkeyInput);
      setConfig(result);
      setAuthkeyInput("");
      showToast("MSG91 API key saved", "success");
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
    finally { setSaving(false); }
  }

  async function loadNumbers() {
    setLoadingNumbers(true);
    try {
      const data = await msg91.getNumbers(orgId);
      setNumbers(data);
      if (data.length > 0 && !selectedNumber) {
        setSelectedNumber(String((data[0] as Record<string, unknown>).integrated_number || data[0].number || ""));
      }
    } catch { showToast("Failed to fetch numbers", "error"); }
    finally { setLoadingNumbers(false); }
  }

  async function loadTemplates() {
    if (!selectedNumber) { showToast("Select a phone number first", "error"); return; }
    setLoadingTemplates(true);
    try { setTemplates(await msg91.getTemplates(orgId, selectedNumber)); }
    catch { showToast("Failed to fetch templates", "error"); }
    finally { setLoadingTemplates(false); }
  }

  async function loadLogs() {
    setLoadingLogs(true);
    try {
      const data = await msg91.getLogs(orgId, logDate, logDate) as Record<string, unknown>;
      setLogs(Array.isArray(data.data) ? data.data : []);
    } catch { showToast("Failed to fetch logs", "error"); }
    finally { setLoadingLogs(false); }
  }

  // ── Templates table wiring ──────────────────────────────────────────
  const templateRows: TemplateRow[] = useMemo(
    () => templates.map((t, i) => ({ ...t, id: String(t.name || `tpl-${i}`) + `-${i}` })),
    [templates]
  );

  const templateColumns: ColumnDef<TemplateRow>[] = [
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
      cell: ({ row }) => <span className="font-medium text-sm">{String(row.original.name || "—")}</span>,
      enableHiding: false,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const langs = (row.original as Record<string, unknown>).languages as Record<string, unknown>[] || [];
        const fl = langs[0] || {};
        const status = String(fl.status || "");
        const isApproved = status === "APPROVED";
        return (
          <Badge variant="outline" className="px-1.5 text-muted-foreground">
            {isApproved ? (
              <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
            ) : (
              <IconLoader />
            )}
            {status || "—"}
          </Badge>
        );
      },
    },
    {
      id: "language",
      header: "Language",
      cell: ({ row }) => {
        const langs = (row.original as Record<string, unknown>).languages as Record<string, unknown>[] || [];
        const fl = langs[0] || {};
        return <span className="text-xs">{String(fl.language || "—")}</span>;
      },
    },
    {
      id: "components",
      header: "Components",
      cell: ({ row }) => {
        const langs = (row.original as Record<string, unknown>).languages as Record<string, unknown>[] || [];
        const fl = langs[0] || {};
        const vars = (fl.variables as string[]) || [];
        return <span className="text-xs text-muted-foreground">{vars.length > 0 ? vars.join(", ") : "No variables"}</span>;
      },
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
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard.writeText(String(row.original.name || ""));
                showToast("Name copied", "success");
              }}
            >
              Copy Name
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const [templateData, setTemplateData] = useState<TemplateRow[]>([]);
  const [templateRowSelection, setTemplateRowSelection] = useState({});
  const [templateColumnVisibility, setTemplateColumnVisibility] = useState<VisibilityState>({});
  const [templateSorting, setTemplateSorting] = useState<SortingState>([]);
  const [templatePagination, setTemplatePagination] = useState({ pageIndex: 0, pageSize: 10 });
  const templateSortableId = useId();
  const templateSensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  useEffect(() => { setTemplateData(templateRows); }, [templateRows]);
  const templateDataIds = useMemo<UniqueIdentifier[]>(() => templateData.map((t) => t.id), [templateData]);

  const templateTable = useReactTable({
    data: templateData,
    columns: templateColumns,
    state: { sorting: templateSorting, columnVisibility: templateColumnVisibility, rowSelection: templateRowSelection, pagination: templatePagination },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setTemplateRowSelection,
    onSortingChange: setTemplateSorting,
    onColumnVisibilityChange: setTemplateColumnVisibility,
    onPaginationChange: setTemplatePagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handleTemplateDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setTemplateData((prev) => {
        const oldIndex = templateDataIds.indexOf(active.id);
        const newIndex = templateDataIds.indexOf(over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  // ── Logs table wiring ────────────────────────────────────────────────
  const logRows: LogRow[] = useMemo(
    () => logs.map((l, i) => ({ ...l, id: `log-${i}-${String(l.requestId || l.requestedAt || i)}` })),
    [logs]
  );

  const logColumns: ColumnDef<LogRow>[] = [
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
      accessorKey: "customerNumber",
      header: "Customer Number",
      cell: ({ row }) => <span className="font-mono text-sm">{String(row.original.customerNumber || "—")}</span>,
      enableHiding: false,
    },
    {
      accessorKey: "templateName",
      header: "Template Name",
      cell: ({ row }) => <span className="text-sm">{String(row.original.templateName || "—")}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const st = String(row.original.status || "—");
        const isDelivered = st === "delivered" || st === "read";
        return (
          <Badge variant="outline" className="px-1.5 text-muted-foreground capitalize">
            {isDelivered ? (
              <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
            ) : (
              <IconLoader />
            )}
            {st}
          </Badge>
        );
      },
    },
    {
      accessorKey: "requestedAt",
      header: "Requested At",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.requestedAt ? format(new Date(String(row.original.requestedAt)), "h:mm a") : "—"}
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
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard.writeText(String(row.original.customerNumber || ""));
                showToast("Number copied", "success");
              }}
            >
              Copy Number
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const [logData, setLogData] = useState<LogRow[]>([]);
  const [logRowSelection, setLogRowSelection] = useState({});
  const [logColumnVisibility, setLogColumnVisibility] = useState<VisibilityState>({});
  const [logSorting, setLogSorting] = useState<SortingState>([]);
  const [logPagination, setLogPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const logSortableId = useId();
  const logSensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  useEffect(() => { setLogData(logRows); }, [logRows]);
  const logDataIds = useMemo<UniqueIdentifier[]>(() => logData.map((l) => l.id), [logData]);

  const logTable = useReactTable({
    data: logData,
    columns: logColumns,
    state: { sorting: logSorting, columnVisibility: logColumnVisibility, rowSelection: logRowSelection, pagination: logPagination },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setLogRowSelection,
    onSortingChange: setLogSorting,
    onColumnVisibilityChange: setLogColumnVisibility,
    onPaginationChange: setLogPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handleLogDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setLogData((prev) => {
        const oldIndex = logDataIds.indexOf(active.id);
        const newIndex = logDataIds.indexOf(over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header */}
      <div className="p-6 pb-3 shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">MSG91 WhatsApp integration</p>

        {/* API Key Config */}
        <div className="flex items-center justify-between mt-4 rounded-lg border px-4 py-3">
          <div className="flex items-center gap-3">
            {config.configured ? <BadgeCheck className="h-5 w-5 text-green-500" /> : <Key className="h-5 w-5 text-muted-foreground" />}
            <div>
              <p className="text-sm font-medium">{config.configured ? "MSG91 Connected" : "MSG91 Not Configured"}</p>
              {config.configured && <p className="text-xs text-muted-foreground font-mono">Key: {config.authkey_masked}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input type="text" autoComplete="off" value={authkeyInput} onChange={(e) => setAuthkeyInput(e.target.value)}
              style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
              placeholder={config.configured ? "Enter new key to change" : "Enter MSG91 authkey"} className="h-8 text-xs w-60" />
            <Button size="sm" onClick={handleSaveKey} disabled={!authkeyInput || saving}>
              {saving ? "Saving..." : config.configured ? "Update" : "Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs — fill remaining space */}
      {config.configured && (
        <Tabs defaultValue="numbers" className="flex flex-col flex-1 min-h-0 px-6 pb-4">
          <TabsList className="w-auto shrink-0 self-start">
            <TabsTrigger value="numbers" className="gap-1.5"><Phone className="h-3.5 w-3.5" />Phone Numbers</TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5"><FileText className="h-3.5 w-3.5" />Templates</TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" />Message Logs</TabsTrigger>
          </TabsList>

          {/* Phone Numbers */}
          <TabsContent value="numbers" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-lg">Phone Numbers</CardTitle>
                  <CardDescription>WhatsApp sender numbers from MSG91</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={loadNumbers} disabled={loadingNumbers}>
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingNumbers ? "animate-spin" : ""}`} />
                  {loadingNumbers ? "Loading..." : "Fetch Numbers"}
                </Button>
              </CardHeader>
              <CardContent>
                {loadingNumbers ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="h-4 w-32 bg-muted/60 rounded animate-pulse" />
                        <div className="h-4 w-12 bg-muted/60 rounded animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : numbers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">Click &quot;Fetch Numbers&quot; to load available WhatsApp numbers.</p>
                ) : (
                  <div className="space-y-2">
                    {numbers.map((n, i) => {
                      const num = String((n as Record<string, unknown>).integrated_number || n.number || "Unknown");
                      return (
                        <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2">
                          <div className="flex items-center gap-3">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-mono">{num}</span>
                          </div>
                          <Badge variant="default" className="text-[10px]">{String(n.quality_rating || n.status || "Active")}</Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Templates */}
          <TabsContent value="templates" className="flex flex-col flex-1 min-h-0 mt-4">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <p className="text-sm text-muted-foreground">Templates for {selectedNumber || "—"}</p>
              <Button size="sm" variant="outline" onClick={loadTemplates} disabled={loadingTemplates || !selectedNumber}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingTemplates ? "animate-spin" : ""}`} />
                {loadingTemplates ? "Loading..." : "Fetch Templates"}
              </Button>
            </div>
            <div className="overflow-hidden rounded-lg border flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto">
                <DndContext
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragEnd={handleTemplateDragEnd}
                  sensors={templateSensors}
                  id={templateSortableId}
                >
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
                      {templateTable.getHeaderGroups().map((headerGroup) => (
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
                      {loadingTemplates ? (
                        <TableSkeleton cols={templateColumns.length} />
                      ) : templateTable.getRowModel().rows?.length ? (
                        <SortableContext items={templateDataIds} strategy={verticalListSortingStrategy}>
                          {templateTable.getRowModel().rows.map((row) => (
                            <DraggableRow key={row.id} row={row} />
                          ))}
                        </SortableContext>
                      ) : (
                        <TableRow>
                          <TableCell colSpan={templateColumns.length} className="h-24 text-center text-muted-foreground">
                            {selectedNumber ? "Click 'Fetch Templates' to load" : "Select a number first (Phone Numbers tab)"}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </DndContext>
              </div>
            </div>

            <div className="flex items-center justify-between px-2 mt-3 shrink-0">
              <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                {templateTable.getFilteredSelectedRowModel().rows.length} of {templateTable.getFilteredRowModel().rows.length} row(s) selected.
              </div>
              <div className="flex w-full items-center gap-8 lg:w-fit">
                <div className="hidden items-center gap-2 lg:flex">
                  <Label htmlFor="tpl-rows-per-page" className="text-sm font-medium">Rows per page</Label>
                  <Select value={`${templateTable.getState().pagination.pageSize}`} onValueChange={(value) => templateTable.setPageSize(Number(value))}>
                    <SelectTrigger className="w-20" id="tpl-rows-per-page">
                      <SelectValue placeholder={templateTable.getState().pagination.pageSize} />
                    </SelectTrigger>
                    <SelectContent side="top">
                      {[10, 20, 30, 40, 50].map((pageSize) => (
                        <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex w-fit items-center justify-center text-sm font-medium">
                  Page {templateTable.getState().pagination.pageIndex + 1} of {templateTable.getPageCount() || 1}
                </div>
                <div className="ml-auto flex items-center gap-2 lg:ml-0">
                  <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => templateTable.setPageIndex(0)} disabled={!templateTable.getCanPreviousPage()}>
                    <span className="sr-only">Go to first page</span>
                    <IconChevronsLeft className="size-4" />
                  </Button>
                  <Button variant="outline" className="size-8" size="icon" onClick={() => templateTable.previousPage()} disabled={!templateTable.getCanPreviousPage()}>
                    <span className="sr-only">Go to previous page</span>
                    <IconChevronLeft className="size-4" />
                  </Button>
                  <Button variant="outline" className="size-8" size="icon" onClick={() => templateTable.nextPage()} disabled={!templateTable.getCanNextPage()}>
                    <span className="sr-only">Go to next page</span>
                    <IconChevronRight className="size-4" />
                  </Button>
                  <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => templateTable.setPageIndex(templateTable.getPageCount() - 1)} disabled={!templateTable.getCanNextPage()}>
                    <span className="sr-only">Go to last page</span>
                    <IconChevronsRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Message Logs */}
          <TabsContent value="logs" className="flex flex-col flex-1 min-h-0 mt-4">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <p className="text-sm text-muted-foreground">Delivery reports (max 3-day range)</p>
              <div className="flex items-center gap-2">
                <Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} className="h-8 text-xs w-40" />
                <Button size="sm" variant="outline" onClick={loadLogs} disabled={loadingLogs}>
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingLogs ? "animate-spin" : ""}`} />
                  {loadingLogs ? "Loading..." : "Fetch Logs"}
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto">
                <DndContext
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis]}
                  onDragEnd={handleLogDragEnd}
                  sensors={logSensors}
                  id={logSortableId}
                >
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
                      {logTable.getHeaderGroups().map((headerGroup) => (
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
                      {loadingLogs ? (
                        <TableSkeleton cols={logColumns.length} />
                      ) : logTable.getRowModel().rows?.length ? (
                        <SortableContext items={logDataIds} strategy={verticalListSortingStrategy}>
                          {logTable.getRowModel().rows.map((row) => (
                            <DraggableRow key={row.id} row={row} />
                          ))}
                        </SortableContext>
                      ) : (
                        <TableRow>
                          <TableCell colSpan={logColumns.length} className="h-24 text-center text-muted-foreground">
                            Select a date and click &quot;Fetch Logs&quot;
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </DndContext>
              </div>
            </div>

            <div className="flex items-center justify-between px-2 mt-3 shrink-0">
              <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                {logTable.getFilteredSelectedRowModel().rows.length} of {logTable.getFilteredRowModel().rows.length} row(s) selected.
              </div>
              <div className="flex w-full items-center gap-8 lg:w-fit">
                <div className="hidden items-center gap-2 lg:flex">
                  <Label htmlFor="log-rows-per-page" className="text-sm font-medium">Rows per page</Label>
                  <Select value={`${logTable.getState().pagination.pageSize}`} onValueChange={(value) => logTable.setPageSize(Number(value))}>
                    <SelectTrigger className="w-20" id="log-rows-per-page">
                      <SelectValue placeholder={logTable.getState().pagination.pageSize} />
                    </SelectTrigger>
                    <SelectContent side="top">
                      {[10, 20, 30, 40, 50].map((pageSize) => (
                        <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex w-fit items-center justify-center text-sm font-medium">
                  Page {logTable.getState().pagination.pageIndex + 1} of {logTable.getPageCount() || 1}
                </div>
                <div className="ml-auto flex items-center gap-2 lg:ml-0">
                  <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => logTable.setPageIndex(0)} disabled={!logTable.getCanPreviousPage()}>
                    <span className="sr-only">Go to first page</span>
                    <IconChevronsLeft className="size-4" />
                  </Button>
                  <Button variant="outline" className="size-8" size="icon" onClick={() => logTable.previousPage()} disabled={!logTable.getCanPreviousPage()}>
                    <span className="sr-only">Go to previous page</span>
                    <IconChevronLeft className="size-4" />
                  </Button>
                  <Button variant="outline" className="size-8" size="icon" onClick={() => logTable.nextPage()} disabled={!logTable.getCanNextPage()}>
                    <span className="sr-only">Go to next page</span>
                    <IconChevronRight className="size-4" />
                  </Button>
                  <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => logTable.setPageIndex(logTable.getPageCount() - 1)} disabled={!logTable.getCanNextPage()}>
                    <span className="sr-only">Go to last page</span>
                    <IconChevronsRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
