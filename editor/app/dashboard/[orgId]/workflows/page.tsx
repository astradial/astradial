"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus, Minus, Workflow, Zap, Clock, CalendarClock, Webhook, Play, History, Copy, ChevronDown, Pencil, Trash } from "lucide-react";
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
import { workflows, automationConfig, scheduledJobs, type Workflow as WorkflowType, type ScheduledJob } from "@/lib/workflow/client";
import { getAdminKey } from "@/lib/gateway/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const triggerIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  webhook: Webhook,
  scheduled: Clock,
  recurring: Clock,
  event: Zap,
};

export default function WorkflowsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [workflowList, setWorkflowList] = useState<WorkflowType[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", trigger_type: "webhook" });
  const [channelLimit, setChannelLimit] = useState<number | null>(null);
  const [currentCalls, setCurrentCalls] = useState(0);
  const [limitLoading, setLimitLoading] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledJob[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  // Pagination + filter state for the Scheduled tab
  const [scheduledPage,        setScheduledPage]        = useState(1);
  const [scheduledTotal,       setScheduledTotal]       = useState(0);
  const [scheduledTotalPages,  setScheduledTotalPages]  = useState(1);
  const [scheduledActiveCount, setScheduledActiveCount] = useState(0);
  const [filterStatus,         setFilterStatus]         = useState<string>("all");
  const [filterDate,           setFilterDate]           = useState<string>("");
  const SCHEDULED_PAGE_SIZE = 50;
  const isAdmin = typeof window !== "undefined" && (!!getAdminKey() || localStorage.getItem("user_role") === "owner" || localStorage.getItem("user_role") === "admin");

  useEffect(() => { loadWorkflows(); loadAutomationConfig(); }, [orgId]);
  // Reload scheduled list whenever the user changes filter or page
  useEffect(() => { loadScheduledJobs(); }, [orgId, scheduledPage, filterStatus, filterDate]);
  // Whenever a filter changes, reset back to page 1 (handled by setScheduledPage in the change handlers)

  async function loadWorkflows() {
    try {
      setLoading(true);
      setWorkflowList(await workflows.list(orgId));
    } catch {
      // Workflow engine might not be proxied yet
    } finally {
      setLoading(false);
    }
  }

  async function loadAutomationConfig() {
    try {
      const config = await automationConfig.get(orgId);
      setChannelLimit(config.automation_channel_limit);
      setCurrentCalls(config.current_automation_calls || 0);
      // Also fetch live call count for more accurate display
      try {
        const liveData = await (await fetch('/api/pbx/calls/live', { headers: { 'Authorization': 'Bearer ' + (typeof window !== 'undefined' ? localStorage.getItem('pbx_org_token') || '' : '') } })).json();
        const liveCalls = Array.isArray(liveData) ? liveData.length : 0;
        setCurrentCalls(liveCalls);
      } catch {}
    } catch {}
  }

  async function cancelScheduledJob(id: string) {
    if (!confirm("Cancel this scheduled job? This cannot be undone.")) return;
    try {
      await scheduledJobs.cancel(id);
      await loadScheduledJobs();
    } catch (err) {
      alert("Failed to cancel: " + (err as Error).message);
    }
  }

  async function loadScheduledJobs() {
    try {
      setScheduledLoading(true);
      const result = await scheduledJobs.list(orgId, {
        status: filterStatus === "all" ? undefined : filterStatus,
        date:   filterDate || undefined,
        page:   scheduledPage,
        limit:  SCHEDULED_PAGE_SIZE,
      });
      setScheduled(result.jobs);
      setScheduledTotal(result.total);
      setScheduledTotalPages(result.totalPages);
      setScheduledActiveCount(result.activeCount);
    } catch {} finally {
      setScheduledLoading(false);
    }
  }

  async function handleLimitChange(delta: number) {
    if (!isAdmin || channelLimit === null) return;
    const newLimit = Math.max(1, channelLimit + delta);
    setLimitLoading(true);
    try {
      await automationConfig.update(orgId, newLimit);
      setChannelLimit(newLimit);
      showToast("Concurrency limit updated", "success");
    } catch {
      showToast("Failed to update limit", "error");
    } finally {
      setLimitLoading(false);
    }
  }

  async function handleCreate() {
    try {
      const wf = await workflows.create({
        org_id: orgId,
        name: form.name,
        description: form.description,
        trigger_type: form.trigger_type,
        nodes: [],
        edges: [],
      });
      showToast("Workflow created", "success");
      setCreateOpen(false);
      setForm({ name: "", description: "", trigger_type: "webhook" });
      router.push(`/dashboard/${orgId}/workflows/${wf.id}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function handleCreateFromTemplate(templateId: string) {
    try {
      const res = await fetch(`/api/workflow/templates/${templateId}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const wf = await res.json();
      showToast("Workflow created from template", "success");
      router.push(`/dashboard/${orgId}/workflows/${wf.id}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this workflow?")) return;
    try {
      await workflows.delete(id);
      showToast("Workflow deleted", "success");
      await loadWorkflows();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function handleExecute(id: string) {
    try {
      const result = await workflows.execute(id, { test: true, triggered_by: "manual" });
      showToast(`Queued: ${result.execution_id}`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  // ── Workflows data-table wiring ─────────────────────────────────────
  const wfColumns: ColumnDef<WorkflowType>[] = [
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
      cell: ({ row }) => {
        const wf = row.original;
        return (
          <button
            className="text-left"
            onClick={() => router.push(`/dashboard/${orgId}/workflows/${wf.id}`)}
          >
            <div className="font-medium hover:underline">{wf.name}</div>
            {wf.description && <div className="text-xs text-muted-foreground">{wf.description}</div>}
          </button>
        );
      },
      enableHiding: false,
    },
    {
      id: "wf_id",
      header: "ID",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <code className="text-xs text-muted-foreground font-mono">{row.original.id.slice(0, 5)}...{row.original.id.slice(-5)}</code>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(row.original.id); showToast("ID copied", "success"); }}
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      ),
    },
    {
      accessorKey: "trigger_type",
      header: "Trigger",
      cell: ({ row }) => {
        const TriggerIcon = triggerIcons[row.original.trigger_type] || Workflow;
        return (
          <Badge variant="outline" className="text-xs gap-1">
            <TriggerIcon className="h-3 w-3" />
            {row.original.trigger_type}
          </Badge>
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
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{format(new Date(row.original.created_at), "MMM d, yyyy")}</span>,
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
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => router.push(`/dashboard/${orgId}/workflows/${row.original.id}`)}>
              <Pencil className="h-4 w-4 mr-2" />Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExecute(row.original.id)}>
              <Play className="h-4 w-4 mr-2" />Test Run
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/api/workflow/trigger/${row.original.id}`); showToast("Trigger URL copied", "success"); }}>
              <Copy className="h-4 w-4 mr-2" />Copy Trigger URL
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(row.original.id); showToast("ID copied", "success"); }}>
              <Copy className="h-4 w-4 mr-2" />Copy ID
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => handleDelete(row.original.id)}
            >
              <Trash className="h-4 w-4 mr-2" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const [wfData, setWfData] = useState<WorkflowType[]>([]);
  const [wfRowSelection, setWfRowSelection] = useState({});
  const [wfColumnVisibility, setWfColumnVisibility] = useState<VisibilityState>({});
  const [wfSorting, setWfSorting] = useState<SortingState>([]);
  const [wfPagination, setWfPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const wfSortableId = useId();
  const wfSensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  useEffect(() => { setWfData(workflowList); }, [workflowList]);
  const wfDataIds = useMemo<UniqueIdentifier[]>(() => wfData.map((w) => w.id), [wfData]);

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

  // ── Scheduled jobs data-table wiring ────────────────────────────────
  const scheduledSorted = useMemo(
    () => [...scheduled].sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()),
    [scheduled]
  );

  const jobColumns: ColumnDef<ScheduledJob>[] = [
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
      accessorKey: "workflow_name",
      header: "Workflow",
      cell: ({ row }) => {
        const job = row.original;
        const triggerData = typeof job.trigger_data === "string" ? JSON.parse(job.trigger_data) : (job.trigger_data || {});
        return (
          <div>
            <div className="font-medium">{job.workflow_name || "Unknown"}</div>
            {triggerData._node_label && (
              <div className="text-xs text-muted-foreground">{String(triggerData._node_label)}</div>
            )}
          </div>
        );
      },
      enableHiding: false,
    },
    {
      accessorKey: "scheduled_at",
      header: "Scheduled At",
      cell: ({ row }) => <span className="text-sm">{format(new Date(row.original.scheduled_at), "MMM d, yyyy h:mm a")}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const job = row.original;
        const scheduledAt = new Date(job.scheduled_at);
        const isOverdue = scheduledAt < new Date() && (job.status === "pending" || job.status === "queued");
        const isActive = job.status === "queued" || job.status === "pending";
        return (
          <Badge
            variant={isOverdue ? "destructive" : "outline"}
            className="px-1.5 text-muted-foreground capitalize"
          >
            {isActive && !isOverdue ? (
              <IconLoader />
            ) : job.status === "executed" ? (
              <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
            ) : (
              <IconLoader />
            )}
            {isOverdue ? "Overdue" : job.status}
          </Badge>
        );
      },
    },
    {
      id: "trigger_data",
      header: "Trigger Data",
      cell: ({ row }) => {
        const job = row.original;
        const triggerData = typeof job.trigger_data === "string" ? JSON.parse(job.trigger_data) : (job.trigger_data || {});
        return (
          <div className="text-sm text-muted-foreground">
            {triggerData.name && <span>{String(triggerData.name)}</span>}
            {triggerData.name && triggerData.phone && <span> &middot; </span>}
            {triggerData.phone && <span>{String(triggerData.phone)}</span>}
            {!triggerData.name && !triggerData.phone && <span className="text-xs">--</span>}
          </div>
        );
      },
    },
    {
      accessorKey: "repeat_until",
      header: "Repeat Until",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.repeat_until ? format(new Date(row.original.repeat_until), "MMM d, yyyy") : "--"}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const job = row.original;
        const isActive = job.status === "queued" || job.status === "pending";
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex size-8 text-muted-foreground data-[state=open]:bg-muted" size="icon">
                <IconDotsVertical />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {isActive ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => cancelScheduledJob(job.id)}
                >
                  Cancel
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled>No actions</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const [jobRowSelection, setJobRowSelection] = useState({});
  const [jobColumnVisibility, setJobColumnVisibility] = useState<VisibilityState>({});
  const [jobSorting, setJobSorting] = useState<SortingState>([]);
  const [jobPagination, setJobPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const jobSortableId = useId();
  const jobSensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor), useSensor(KeyboardSensor));

  const [jobData, setJobData] = useState<ScheduledJob[]>([]);
  useEffect(() => { setJobData(scheduledSorted); }, [scheduledSorted]);
  const jobDataIds = useMemo<UniqueIdentifier[]>(() => jobData.map((j) => j.id), [jobData]);

  const jobTable = useReactTable({
    data: jobData,
    columns: jobColumns,
    state: { sorting: jobSorting, columnVisibility: jobColumnVisibility, rowSelection: jobRowSelection, pagination: jobPagination },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: setJobRowSelection,
    onSortingChange: setJobSorting,
    onColumnVisibilityChange: setJobColumnVisibility,
    onPaginationChange: setJobPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handleJobDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setJobData((prev) => {
        const oldIndex = jobDataIds.indexOf(active.id);
        const newIndex = jobDataIds.indexOf(over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground">Automate call handling, notifications, and integrations</p>
        </div>
        <div className="flex items-center gap-2">
          {channelLimit !== null && (
            <div className="flex items-center gap-1.5 border rounded-md px-2.5 py-1.5 text-sm">
              <span className="text-muted-foreground text-xs">Concurrency:</span>
              {isAdmin && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                  onClick={() => handleLimitChange(-1)} disabled={limitLoading || channelLimit <= 1}>
                  <Minus className="h-3 w-3" />
                </Button>
              )}
              <span className="font-mono w-6 text-center font-medium">{channelLimit}</span>
              {isAdmin && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                  onClick={() => handleLimitChange(1)} disabled={limitLoading}>
                  <Plus className="h-3 w-3" />
                </Button>
              )}
              <span className="text-muted-foreground text-xs">({currentCalls} active)</span>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Zap className="h-4 w-4 mr-1.5" />Templates
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleCreateFromTemplate("hotel_checkin")}>Hotel Check-in Automation</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1.5" />New Workflow</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Workflow</DialogTitle>
              <DialogDescription>Choose a trigger type to start automating</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Guest Check-in Automation" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Send welcome message and schedule reminders" />
              </div>
              <div className="space-y-1.5">
                <Label>Trigger Type</Label>
                <Select value={form.trigger_type} onValueChange={(v) => setForm({ ...form, trigger_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="webhook">Webhook — HTTP POST trigger</SelectItem>
                    <SelectItem value="event">Event — Call/ticket events</SelectItem>
                    <SelectItem value="scheduled">Scheduled — One-time at date/time</SelectItem>
                    <SelectItem value="recurring">Recurring — Daily between dates</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!form.name}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Tabs defaultValue="workflows">
        <TabsList>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="scheduled" className="gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" />
            Scheduled
            {scheduledActiveCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-1">
                {scheduledActiveCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workflows" className="space-y-6 mt-4">
          {/* Workflow list */}
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
                  {loading ? (
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
                        No workflows yet. Click &quot;New Workflow&quot; to create one.
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

          {/* Webhook URL info */}
          {workflowList.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground mb-2">Trigger workflows via HTTP:</p>
              <code className="text-xs break-all">POST {typeof window !== "undefined" ? window.location.origin : ""}/api/workflow/trigger/&#123;workflow_id&#125;</code>
            </div>
          )}
        </TabsContent>

        <TabsContent value="scheduled" className="mt-4">
          {/* Filters + refresh + pagination summary */}
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setScheduledPage(1); }}>
                <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="executed">Executed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date (IST)</Label>
              <Input
                type="date"
                value={filterDate}
                onChange={(e) => { setFilterDate(e.target.value); setScheduledPage(1); }}
                className="h-8 w-[160px] text-xs"
              />
            </div>
            {(filterStatus !== "all" || filterDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setFilterStatus("all"); setFilterDate(""); setScheduledPage(1); }}
                className="h-8"
              >
                Clear
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {scheduledTotal > 0
                  ? `${(scheduledPage - 1) * SCHEDULED_PAGE_SIZE + 1}–${Math.min(scheduledPage * SCHEDULED_PAGE_SIZE, scheduledTotal)} of ${scheduledTotal}`
                  : "0 results"}
              </span>
              <Button variant="outline" size="sm" onClick={loadScheduledJobs} disabled={scheduledLoading}>
                <History className={`h-3.5 w-3.5 mr-1.5 ${scheduledLoading ? "animate-spin" : ""}`} />Refresh
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <DndContext
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleJobDragEnd}
              sensors={jobSensors}
              id={jobSortableId}
            >
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
                  {jobTable.getHeaderGroups().map((headerGroup) => (
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
                  {scheduledLoading ? (
                    <TableSkeleton cols={jobColumns.length} />
                  ) : jobTable.getRowModel().rows?.length ? (
                    <SortableContext items={jobDataIds} strategy={verticalListSortingStrategy}>
                      {jobTable.getRowModel().rows.map((row) => (
                        <DraggableRow key={row.id} row={row} />
                      ))}
                    </SortableContext>
                  ) : (
                    <TableRow>
                      <TableCell colSpan={jobColumns.length} className="h-24 text-center text-muted-foreground">
                        No scheduled jobs
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DndContext>
          </div>

          <div className="flex items-center justify-between px-2 mt-3">
            <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
              {jobTable.getFilteredSelectedRowModel().rows.length} of {jobTable.getFilteredRowModel().rows.length} row(s) selected.
            </div>
            <div className="flex w-full items-center gap-8 lg:w-fit">
              <div className="hidden items-center gap-2 lg:flex">
                <Label htmlFor="job-rows-per-page" className="text-sm font-medium">Rows per page</Label>
                <Select value={`${jobTable.getState().pagination.pageSize}`} onValueChange={(value) => jobTable.setPageSize(Number(value))}>
                  <SelectTrigger className="w-20" id="job-rows-per-page">
                    <SelectValue placeholder={jobTable.getState().pagination.pageSize} />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-fit items-center justify-center text-sm font-medium">
                Page {jobTable.getState().pagination.pageIndex + 1} of {jobTable.getPageCount() || 1}
              </div>
              <div className="ml-auto flex items-center gap-2 lg:ml-0">
                <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => jobTable.setPageIndex(0)} disabled={!jobTable.getCanPreviousPage()}>
                  <span className="sr-only">Go to first page</span>
                  <IconChevronsLeft className="size-4" />
                </Button>
                <Button variant="outline" className="size-8" size="icon" onClick={() => jobTable.previousPage()} disabled={!jobTable.getCanPreviousPage()}>
                  <span className="sr-only">Go to previous page</span>
                  <IconChevronLeft className="size-4" />
                </Button>
                <Button variant="outline" className="size-8" size="icon" onClick={() => jobTable.nextPage()} disabled={!jobTable.getCanNextPage()}>
                  <span className="sr-only">Go to next page</span>
                  <IconChevronRight className="size-4" />
                </Button>
                <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => jobTable.setPageIndex(jobTable.getPageCount() - 1)} disabled={!jobTable.getCanNextPage()}>
                  <span className="sr-only">Go to last page</span>
                  <IconChevronsRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Server-side pagination controls (retained — pages through scheduled API) */}
          {scheduledTotalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground">
                Server page {scheduledPage} of {scheduledTotalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={scheduledPage <= 1 || scheduledLoading}
                  onClick={() => setScheduledPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={scheduledPage >= scheduledTotalPages || scheduledLoading}
                  onClick={() => setScheduledPage((p) => Math.min(scheduledTotalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
