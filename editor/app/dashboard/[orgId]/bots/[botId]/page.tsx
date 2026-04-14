"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import LogsPanel from "@/components/LogsPanel";
import { reactFlowToFlowJson } from "@/lib/convert/flowAdapters";
import { flowJsonToReactFlow } from "@/lib/convert/flowAdapters";
import { bots, type Bot } from "@/lib/gateway/client";
import type { FlowJson } from "@/lib/schema/flow.schema";
import { saveCurrent, loadCurrent } from "@/lib/storage/localStore";
import type { FlowNode, FlowEdge } from "@/lib/types/flowTypes";

const EditorShell = dynamic(() => import("@/components/EditorShell"), { ssr: false });

export default function BotEditorPage() {
  const { orgId, botId } = useParams<{ orgId: string; botId: string }>();
  const [bot, setBot] = useState<Bot | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // Load bot from gateway
  useEffect(() => {
    async function load() {
      try {
        const b = await bots.get(orgId, botId);
        setBot(b);

        // If bot has flow_json with nodes, load it into the editor's localStorage
        // so EditorShell picks it up on mount
        if (b.flow_json && (b.flow_json as FlowJson).nodes?.length) {
          const { nodes, edges } = flowJsonToReactFlow(b.flow_json as FlowJson);
          saveCurrent({ nodes, edges });
        } else {
          // Clear localStorage so editor starts fresh
          saveCurrent({ nodes: [], edges: [] });
        }
        setLoaded(true);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Failed to load bot");
      }
    }
    load();
  }, [orgId, botId]);

  // Save to gateway
  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatus("");
    try {
      // Read current state from localStorage (EditorShell autosaves there)
      const saved = loadCurrent<{ nodes: FlowNode[]; edges: FlowEdge[] }>();
      if (!saved?.nodes) {
        setStatus("No flow data to save");
        setSaving(false);
        return;
      }
      const flowJson = reactFlowToFlowJson(saved.nodes, saved.edges);
      // Fetch latest bot from gateway to preserve value_maps, idle_config, meta
      // (these may have been updated by Transfer Config on the bots page)
      const latestBot = await bots.get(orgId, botId);
      const original = (latestBot?.flow_json || bot?.flow_json) as Record<string, unknown> | null;
      if (original) {
        if (original.meta) flowJson.meta = original.meta as typeof flowJson.meta;
        if (original.value_maps) (flowJson as Record<string, unknown>).value_maps = original.value_maps;
        if (original.idle_config) (flowJson as Record<string, unknown>).idle_config = original.idle_config;
      }
      await bots.update(orgId, botId, { flow_json: flowJson as unknown as Record<string, unknown> });
      setStatus("Saved!");
      setTimeout(() => setStatus(""), 2000);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [orgId, botId]);

  // Keyboard shortcut: Cmd+S to save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  if (!loaded) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-foreground">Loading bot...</div>;
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-3 py-1.5 bg-background z-50">
        <div className="flex items-center gap-3">
          <Link href={`/dashboard/${orgId}`} className="text-muted-foreground hover:text-foreground text-sm">&larr; Back</Link>
          <span className="font-medium text-sm">{bot?.name}</span>
          {bot?.extension && (
            <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded-full font-mono">
              Ext {bot.extension}
            </span>
          )}
          <span className="text-xs text-muted-foreground font-mono hidden md:inline">{botId}</span>
        </div>
        <div className="flex items-center gap-2">
          {status && <span className="text-xs text-muted-foreground">{status}</span>}
          <Button
            size="sm"
            variant={showLogs ? "secondary" : "outline"}
            onClick={() => setShowLogs((v) => !v)}
          >
            {showLogs ? "Hide Logs" : "Logs"}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save to Gateway"}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 relative">
        <EditorShell />
      </div>

      {/* Logs modal */}
      {showLogs && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[90vw] max-w-4xl h-[70vh] rounded-xl overflow-hidden shadow-2xl border border-neutral-700 flex flex-col">
            <LogsPanel orgId={orgId} botId={botId} onClose={() => setShowLogs(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
