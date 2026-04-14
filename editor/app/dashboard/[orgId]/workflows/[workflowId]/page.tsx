"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { format } from "date-fns";
import { Plus, Save, Play, History, ArrowLeft, Trash2, X, ChevronRight, ChevronLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { showToast } from "@/components/ui/Toast";
import { workflows, type Workflow, type WorkflowExecution } from "@/lib/workflow/client";
import { NodeConfigFields } from "@/components/workflows/NodeConfigFields";
import { bots as gwBots, type Bot as GwBot } from "@/lib/gateway/client";
import { dids as pbxDids, type PbxDid } from "@/lib/pbx/client";
import { msg91 } from "@/lib/msg91/client";
import { TriggerNode } from "@/components/workflows/nodes/TriggerNode";
import { ActionNode } from "@/components/workflows/nodes/ActionNode";
import { ConditionNode } from "@/components/workflows/nodes/ConditionNode";

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  // Executor types map to action node
  http_request: ActionNode,
  send_whatsapp: ActionNode,
  place_call: ActionNode,
  create_ticket: ActionNode,
  send_email: ActionNode,
  log: ActionNode,
  delay: ActionNode,
  repeat_daily: ActionNode,
};

const NODE_TEMPLATES = [
  { type: "http_request", label: "HTTP Request", group: "Actions" },
  { type: "send_whatsapp", label: "Send WhatsApp", group: "Actions" },
  { type: "place_call", label: "Place Call", group: "Actions" },
  { type: "create_ticket", label: "Create Ticket", group: "Actions" },
  { type: "log", label: "Log", group: "Actions" },
  { type: "delay", label: "Delay / Schedule", group: "Flow" },
  { type: "condition", label: "Condition", group: "Flow" },
  { type: "repeat_daily", label: "Repeat Daily", group: "Flow" },
];

export default function WorkflowEditorPage() {
  const { orgId, workflowId } = useParams<{ orgId: string; workflowId: string }>();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [saving, setSaving] = useState(false);
  const [executionLog, setExecutionLog] = useState(false);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Bots + DIDs + MSG91 for node config
  const [botList, setBotList] = useState<{ id: string; name: string; wss_url?: string }[]>([]);
  const [didList, setDidList] = useState<{ number: string; description?: string }[]>([]);
  const [msg91Numbers, setMsg91Numbers] = useState<{ integrated_number?: string; number?: string }[]>([]);
  const [msg91Templates, setMsg91Templates] = useState<{ name?: string; languages?: { language?: string; status?: string; variables?: string[] }[] }[]>([]);

  useEffect(() => {
    gwBots.list(orgId).then((b) => setBotList(b.map((bot) => ({
      id: bot.id, name: bot.name,
      wss_url: `wss://gateway.astradial.com/ws/${orgId}/${bot.id}`,
    })))).catch(() => {});
    pbxDids.list().then((d) => setDidList(d.filter((x) => x.status === "active").map((x) => ({
      number: x.number, description: x.description,
    })))).catch(() => {});
    // MSG91 data
    msg91.getNumbers(orgId).then((nums) => {
      setMsg91Numbers(nums as { integrated_number?: string; number?: string }[]);
      // Auto-fetch templates for first number
      const firstNum = String((nums[0] as Record<string, unknown>)?.integrated_number || (nums[0] as Record<string, unknown>)?.number || "");
      if (firstNum) msg91.getTemplates(orgId, firstNum).then((t) => setMsg91Templates(t as typeof msg91Templates)).catch(() => {});
    }).catch(() => {});
  }, [orgId]);

  // Resizable panel state
  const [panelWidth, setPanelWidth] = useState(30);
  const [isDraggingResize, setIsDraggingResize] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const isResizing = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    setIsDraggingResize(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = ((window.innerWidth - moveEvent.clientX) / window.innerWidth) * 100;
      setPanelWidth(Math.min(50, Math.max(20, newWidth)));
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      setIsDraggingResize(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // Load workflow
  useEffect(() => {
    async function load() {
      try {
        const wf = await workflows.get(workflowId);
        setWorkflow(wf);

        // Convert workflow nodes to React Flow nodes
        const rfNodes: Node[] = (wf.nodes || []).map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position || { x: 250, y: 0 },
          data: n.data || { label: n.type, config: {} },
        }));

        // If no nodes, add a trigger node
        if (rfNodes.length === 0) {
          rfNodes.push({
            id: "trigger",
            type: "trigger",
            position: { x: 250, y: 50 },
            data: { label: `Trigger: ${wf.trigger_type}`, config: { ...wf.trigger_config, triggerType: wf.trigger_type }, triggerType: wf.trigger_type },
          });
        }

        setNodes(rfNodes);
        setEdges((wf.edges || []).map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: true,
          style: { strokeWidth: 2 },
        })));
      } catch (e) {
        showToast("Failed to load workflow", "error");
      }
    }
    load();
  }, [workflowId]);

  // Node selection
  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNode(node);
  }, []);

  // Update node config
  function updateNodeConfig(nodeId: string, key: string, value: string) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, config: { ...(n.data.config as Record<string, unknown> || {}), [key]: value } } }
          : n
      )
    );
    // Update selected node reference
    setSelectedNode((prev) => prev && prev.id === nodeId
      ? { ...prev, data: { ...prev.data, config: { ...(prev.data.config as Record<string, unknown> || {}), [key]: value } } }
      : prev
    );
  }

  function updateNodeLabel(nodeId: string, label: string) {
    setNodes((nds) =>
      nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, label } } : n)
    );
    setSelectedNode((prev) => prev && prev.id === nodeId ? { ...prev, data: { ...prev.data, label } } : prev);
  }

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, animated: true, style: { strokeWidth: 2 } }, eds));
  }, [setEdges]);

  // Add node
  function addNode(type: string, label: string) {
    const id = `${type}_${Date.now()}`;
    const lastNode = nodes[nodes.length - 1];
    const y = lastNode ? lastNode.position.y + 150 : 200;

    setNodes((nds) => [
      ...nds,
      {
        id,
        type,
        position: { x: 250, y },
        data: { label, config: {} },
      },
    ]);

    // Auto-connect to last node
    if (lastNode) {
      setEdges((eds) => [
        ...eds,
        { id: `e_${lastNode.id}_${id}`, source: lastNode.id, target: id, animated: true, style: { strokeWidth: 2 } },
      ]);
    }
  }

  // Save workflow
  async function handleSave() {
    if (!workflow) return;
    setSaving(true);
    try {
      const wfNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type || "action",
        position: n.position,
        data: n.data as { label: string; config: Record<string, unknown> },
      }));
      const wfEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: typeof e.label === "string" ? e.label : undefined,
      }));
      await workflows.update(workflowId, { nodes: wfNodes, edges: wfEdges } as Partial<Workflow>);
      showToast("Workflow saved", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  // Test run
  async function handleTestRun() {
    try {
      const result = await workflows.execute(workflowId, { test: true });
      showToast(`Execution queued: ${result.execution_id}`, "success");
      // Load executions
      setTimeout(async () => {
        setExecutions(await workflows.executions(workflowId));
        setExecutionLog(true);
      }, 2000);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  // Load executions
  async function loadExecutions() {
    try {
      setExecutions(await workflows.executions(workflowId));
      setExecutionLog(true);
    } catch {}
  }

  // Get trigger expected fields for template dropdowns
  function getTriggerFields(): string[] {
    const triggerNode = nodes.find((n) => n.type === "trigger");
    if (!triggerNode) return [];
    const config = triggerNode.data?.config as Record<string, string> || {};
    const fieldsStr = config.expected_fields || "";
    return fieldsStr.split(",").map((f: string) => f.trim()).filter(Boolean);
  }

  // Toggle active/pause
  async function toggleActive() {
    if (!workflow) return;
    try {
      await workflows.update(workflowId, { is_active: !workflow.is_active });
      setWorkflow({ ...workflow, is_active: !workflow.is_active });
      showToast(workflow.is_active ? "Workflow paused" : "Workflow activated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  // Delete node
  function deleteNode(nodeId: string) {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-3 py-1.5 bg-background z-50 shrink-0">
        <div className="flex items-center gap-3">
          <Link href={`/dashboard/${orgId}/workflows`} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="font-medium text-sm">{workflow?.name || "Loading..."}</span>
          <Badge variant="outline" className="text-xs">{workflow?.trigger_type}</Badge>
          <div className="flex items-center gap-1.5">
            <Switch checked={workflow?.is_active ?? true} onCheckedChange={toggleActive} className="scale-75" />
            <span className="text-xs text-muted-foreground">{workflow?.is_active ? "Active" : "Paused"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Plus className="h-3.5 w-3.5 mr-1" />Add Node</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {NODE_TEMPLATES.map((t) => (
                <DropdownMenuItem key={t.type} onClick={() => addNode(t.type, t.label)}>
                  {t.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={loadExecutions}>
            <History className="h-3.5 w-3.5 mr-1" />Runs
          </Button>
          <Button variant="outline" size="sm" onClick={handleTestRun}>
            <Play className="h-3.5 w-3.5 mr-1" />Test
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-3.5 w-3.5 mr-1" />{saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Canvas + Inspector — flex layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* React Flow Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={(_: unknown, edge: Edge) => {
              if (confirm(`Delete connection from "${nodes.find(n => n.id === edge.source)?.data?.label || edge.source}" to "${nodes.find(n => n.id === edge.target)?.data?.label || edge.target}"?`)) {
                setEdges((eds) => eds.filter((e) => e.id !== edge.id));
              }
            }}
            onPaneClick={() => setSelectedNode(null)}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={["Delete", "Backspace"]}
            edgesFocusable
            defaultEdgeOptions={{ style: { strokeWidth: 2, cursor: "pointer" }, interactionWidth: 20 }}
            className="bg-background"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="!bg-background" />
            <Controls className="!bg-card !border-border !shadow-sm" />
            <MiniMap className="!bg-card !border-border" />
          </ReactFlow>

          {/* Drag overlay — prevents React Flow from stealing mouse during resize */}
          {isDraggingResize && (
            <div className="absolute inset-0 z-50 cursor-col-resize" />
          )}
        </div>

        {/* Resize handle — sits between canvas and panel as a flex sibling */}
        {selectedNode && !panelCollapsed && (
          <div
            className="group relative w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-blue-500 active:bg-blue-600 transition-colors"
            onMouseDown={handleResizeStart}
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
          >
            {/* Collapse button */}
            {!isDraggingResize && (
              <button
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-full border bg-background opacity-0 shadow-sm transition-opacity hover:bg-muted group-hover:opacity-100 z-10"
                onClick={(e) => { e.stopPropagation(); setPanelCollapsed(true); }}
                onMouseDown={(e) => e.stopPropagation()}
                type="button"
              >
                <ChevronRight className="size-4" />
              </button>
            )}
          </div>
        )}

        {/* Expand button when collapsed */}
        {selectedNode && panelCollapsed && (
          <button
            className="flex items-center justify-center w-6 shrink-0 border-l bg-background hover:bg-muted transition-colors"
            onClick={() => setPanelCollapsed(false)}
            type="button"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}

        {/* Node Inspector Panel */}
        {selectedNode && !panelCollapsed && (
          <div
            className="flex flex-col bg-background shrink-0 overflow-hidden"
            style={{ width: `${panelWidth}%` }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between border-b px-4 py-2.5 shrink-0">
              <h3 className="text-sm font-semibold">Node Properties</h3>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => { deleteNode(selectedNode.id); setSelectedNode(null); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedNode(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  value={String(selectedNode.data.label || "")}
                  onChange={(e) => updateNodeLabel(selectedNode.id, e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="text-xs text-muted-foreground">
                Type: <Badge variant="outline" className="text-[10px] ml-1">{selectedNode.type}</Badge>
              </div>

              <Separator />

              <NodeConfigFields
                nodeType={String(selectedNode.type)}
                config={(selectedNode.data.config as Record<string, string>) || {}}
                onChange={(key, value) => updateNodeConfig(selectedNode.id, key, value)}
                triggerFields={getTriggerFields()}
                bots={botList}
                dids={didList}
                msg91Numbers={msg91Numbers}
                msg91Templates={msg91Templates}
              />
            </div>
          </div>
        )}
      </div>

      {/* Execution Log Sheet */}
      <Sheet open={executionLog} onOpenChange={setExecutionLog}>
        <SheetContent className="w-[400px] sm:w-[500px]">
          <SheetHeader>
            <SheetTitle>Execution History</SheetTitle>
            <SheetDescription>Recent workflow runs</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3 max-h-[80vh] overflow-y-auto">
            {executions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No executions yet</p>
            ) : executions.map((ex) => (
              <div key={ex.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant={ex.status === "completed" ? "default" : ex.status === "failed" ? "destructive" : "secondary"} className="text-xs">
                    {ex.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(ex.started_at), "MMM d, h:mm a")}
                  </span>
                </div>
                {ex.error && <p className="text-xs text-destructive">{ex.error}</p>}
                {Array.isArray(ex.steps) && ex.steps.length > 0 && (
                  <div className="space-y-1">
                    {(ex.steps as Array<Record<string, unknown>>).map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant={step.status === "completed" ? "default" : "secondary"} className="text-[10px] h-4">
                          {String(step.status)}
                        </Badge>
                        <span>{String(step.node_label || step.node_type)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
