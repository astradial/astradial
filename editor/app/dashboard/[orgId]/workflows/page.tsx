"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus, Minus, Workflow, Zap, Clock, CalendarClock, Webhook, MoreHorizontal, Play, History, Copy, ChevronDown } from "lucide-react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton cols={6} />
                ) : workflowList.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No workflows yet. Click "New Workflow" to create one.</TableCell></TableRow>
                ) : workflowList.map((wf) => {
                  const TriggerIcon = triggerIcons[wf.trigger_type] || Workflow;
                  return (
                    <TableRow key={wf.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/${orgId}/workflows/${wf.id}`)}>
                      <TableCell>
                        <div className="font-medium">{wf.name}</div>
                        {wf.description && <div className="text-xs text-muted-foreground">{wf.description}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <code className="text-xs text-muted-foreground font-mono">{wf.id.slice(0, 5)}...{wf.id.slice(-5)}</code>
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(wf.id); showToast("ID copied", "success"); }}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs gap-1">
                          <TriggerIcon className="h-3 w-3" />
                          {wf.trigger_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={wf.is_active ? "default" : "secondary"} className="text-xs">
                          {wf.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(wf.created_at), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => handleExecute(wf.id)} title="Test run">
                            <Play className="h-3 w-3" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/dashboard/${orgId}/workflows/${wf.id}`)}>Edit</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/api/workflow/trigger/${wf.id}`); showToast("Trigger URL copied", "success"); }}>Copy Trigger URL</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(wf.id); showToast("ID copied", "success"); }}>Copy ID</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(wf.id)}>Delete</DropdownMenuItem>
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
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Scheduled At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger Data</TableHead>
                  <TableHead>Repeat Until</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduledLoading ? (
                  <TableSkeleton cols={6} />
                ) : scheduled.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No scheduled jobs</TableCell></TableRow>
                ) : [...scheduled].sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime()).map((job) => {
                  const triggerData = typeof job.trigger_data === "string" ? JSON.parse(job.trigger_data) : (job.trigger_data || {});
                  const scheduledAt = new Date(job.scheduled_at);
                  const isOverdue = scheduledAt < new Date() && (job.status === "pending" || job.status === "queued");
                  const repeatUntil = job.repeat_until;
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div className="font-medium">{job.workflow_name || "Unknown"}</div>
                        {triggerData._node_label && (
                          <div className="text-xs text-muted-foreground">{triggerData._node_label}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {format(scheduledAt, "MMM d, yyyy h:mm a")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          isOverdue ? "destructive" :
                          job.status === "queued" || job.status === "pending" ? "default" :
                          "secondary"
                        } className="text-xs">
                          {isOverdue ? "Overdue" : job.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {triggerData.name && <span>{triggerData.name}</span>}
                        {triggerData.name && triggerData.phone && <span> &middot; </span>}
                        {triggerData.phone && <span>{triggerData.phone}</span>}
                        {!triggerData.name && !triggerData.phone && <span className="text-xs">--</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {repeatUntil ? format(new Date(repeatUntil), "MMM d, yyyy") : "--"}
                      </TableCell>
                      <TableCell className="text-right">
                        {(job.status === "queued" || job.status === "pending") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelScheduledJob(job.id)}
                            className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            Cancel
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {/* Pagination controls */}
          {scheduledTotalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground">
                Page {scheduledPage} of {scheduledTotalPages}
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
