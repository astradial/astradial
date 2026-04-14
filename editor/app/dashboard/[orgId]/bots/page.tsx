"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ChevronDown, ChevronUp, Plus, Trash2, Settings, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bots, keys, orgConfig, type Bot, type ApiKey } from "@/lib/gateway/client";
import { queues as pbxQueues, type PbxQueue } from "@/lib/pbx/client";
import { toast } from "sonner";

export default function BotsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [botList, setBotList] = useState<Bot[]>([]);
  const [keyList, setKeyList] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBotName, setNewBotName] = useState("");
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [error, setError] = useState("");
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);
  const [expandedBot, setExpandedBot] = useState<string | null>(null);
  const [deptMappings, setDeptMappings] = useState<{ label: string; key: string; target: string; type: "queue" | "phone" }[]>([]);
  const [savingDepts, setSavingDepts] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    loadAll();
    pbxQueues.list().then(setQueueList).catch(() => {});
  }, [orgId]);

  async function loadAll() {
    try {
      setLoading(true);
      const [b, k, cfg] = await Promise.all([
        bots.list(orgId),
        keys.list(orgId),
        orgConfig.get(orgId),
      ]);
      setBotList(b);
      setKeyList(k);
      if (cfg) setGoogleApiKey(cfg.google_api_key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateBot() {
    if (!newBotName) return;
    try {
      await bots.create(orgId, { name: newBotName, flow_json: { nodes: [] } });
      setNewBotName("");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create bot");
    }
  }

  async function handleCreateKey() {
    try {
      const k = await keys.create(orgId, newKeyLabel);
      setCreatedKey(k.key || "");
      setNewKeyLabel("");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create key");
    }
  }

  function loadDeptMappings(bot: Bot) {
    const flow = bot.flow_json as Record<string, unknown> | null;
    const vm = (flow?.value_maps as Record<string, Record<string, string>>) || {};
    const nums = vm.department_numbers || {};
    const labels = vm.department_labels || {};
    const mappings = Object.entries(nums).map(([key, target]) => {
      const isQueue = /^\d{4,5}$/.test(target);
      return { key, label: labels[key] || key.replace(/_/g, " "), target, type: (isQueue ? "queue" : "phone") as "queue" | "phone" };
    });
    setDeptMappings(mappings.length > 0 ? mappings : [{ label: "Reception", key: "reception", target: "5001", type: "queue" }]);
  }

  function toggleBotExpand(bot: Bot) {
    if (expandedBot === bot.id) {
      setExpandedBot(null);
    } else {
      setExpandedBot(bot.id);
      loadDeptMappings(bot);
    }
  }

  async function saveDeptMappings(botId: string) {
    setSavingDepts(true);
    try {
      const bot = botList.find(b => b.id === botId);
      const flow = (bot?.flow_json as Record<string, unknown>) || {};
      const deptNumbers: Record<string, string> = {};
      const deptLabels: Record<string, string> = {};
      const enumValues: string[] = [];
      for (const m of deptMappings) {
        if (!m.key || !m.target) continue;
        deptNumbers[m.key] = m.target;
        deptLabels[m.key] = m.label;
        enumValues.push(m.key);
      }
      // Update value_maps
      const existingVm = (flow.value_maps as Record<string, unknown>) || {};
      flow.value_maps = { ...existingVm, department_numbers: deptNumbers, department_labels: deptLabels };
      // Update transfer function enum in nodes
      const nodes = (flow.nodes as Record<string, unknown>[]) || [];
      for (const node of nodes) {
        const data = node.data as Record<string, unknown>;
        const fns = (data?.functions as Record<string, unknown>[]) || [];
        for (const fn of fns) {
          if ((fn as Record<string, unknown>).name === "transfer_to_department") {
            const props = (fn as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
            if (props?.department) {
              props.department.enum = enumValues;
            }
          }
        }
      }
      const updatedFlow = flow;
      await bots.update(orgId, botId, { flow_json: updatedFlow });
      toast.success("Department mappings saved");
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingDepts(false);
    }
  }

  async function handleSaveConfig() {
    try {
      await orgConfig.set(orgId, { google_api_key: googleApiKey });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save config");
    }
  }

  const isConnected = !!googleApiKey;

  return (
    <div className="p-3 md:p-6 space-y-8">
      {/* Header with title on left, connection pill on right */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">SuperHuman</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage AI voice bots and API keys</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfigOpen(true)}
          className="gap-1.5 h-8 text-xs shrink-0"
        >
          <span
            className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
            aria-hidden
          />
          {isConnected ? "Connected" : "Not connected"}
          <Settings className="h-3 w-3 ml-1 text-muted-foreground" />
        </Button>
      </div>

      {/* Configuration dialog (opens when the pill is clicked) */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bot Configuration</DialogTitle>
            <DialogDescription>Gemini API key required for Gemini Live voice bots.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs">Google API Key (Gemini)</Label>
            <Input
              type="text"
              autoComplete="off"
              placeholder="AIza..."
              value={googleApiKey}
              onChange={(e) => { setGoogleApiKey(e.target.value); setConfigSaved(false); }}
              className="font-mono text-xs tracking-wider"
              style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
            />
            {isConnected && !configSaved && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Check className="h-3 w-3 text-green-500" />Currently connected. Replace and save to update.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>Close</Button>
            <Button
              onClick={async () => {
                await handleSaveConfig();
              }}
              disabled={!googleApiKey}
            >
              {configSaved ? "Saved ✓" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Bots */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">SuperHuman Agents</h2>
        <div className="flex gap-2">
          <Input
            placeholder="SuperHuman"
            value={newBotName}
            onChange={(e) => setNewBotName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateBot()}
          />
          <Button onClick={handleCreateBot}>Create Agent</Button>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4 space-y-2">
                <div className="h-4 bg-muted/60 rounded animate-pulse w-1/3" />
                <div className="h-3 bg-muted/60 rounded animate-pulse w-1/2" />
              </div>
            ))}
          </div>
        ) : botList.length === 0 ? (
          <p className="text-muted-foreground text-sm">No agents yet.</p>
        ) : (
          <div className="space-y-2">
            {botList.map((bot) => (
              <div key={bot.id} className="rounded-lg border">
                <div className="flex items-center justify-between p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{bot.name}</p>
                      {bot.extension && (
                        <Badge variant="secondary" className="font-mono">Ext {bot.extension}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      {bot.gemini_model} | {bot.gemini_voice_id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { navigator.clipboard.writeText(bot.id); toast.success("Bot ID copied"); }}>Copy ID</Button>
                    <Badge variant={bot.is_active ? "default" : "destructive"}>
                      {bot.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => toggleBotExpand(bot)}>
                      Transfer Config {expandedBot === bot.id ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                    </Button>
                    <Link href={`/dashboard/${orgId}/bots/${bot.id}`}>
                      <Button variant="outline" size="sm">Edit Flow</Button>
                    </Link>
                  </div>
                </div>

                {expandedBot === bot.id && (
                  <div className="border-t px-4 py-3 space-y-3 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Transfer Departments</p>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDeptMappings([...deptMappings, { label: "", key: "", target: "", type: "queue" }])}>
                        <Plus className="h-3 w-3 mr-1" /> Add
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {deptMappings.map((m, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            className="h-8 text-xs w-36"
                            placeholder="Label (e.g. Room Service)"
                            value={m.label}
                            onChange={(e) => {
                              const updated = [...deptMappings];
                              updated[i] = { ...m, label: e.target.value, key: e.target.value.toLowerCase().replace(/\s+/g, "_") };
                              setDeptMappings(updated);
                            }}
                          />
                          <Select
                            value={m.type}
                            onValueChange={(v) => {
                              const updated = [...deptMappings];
                              updated[i] = { ...m, type: v as "queue" | "phone", target: "" };
                              setDeptMappings(updated);
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="queue">Queue</SelectItem>
                              <SelectItem value="phone">Phone</SelectItem>
                            </SelectContent>
                          </Select>
                          {m.type === "queue" ? (
                            <Select
                              value={m.target}
                              onValueChange={(v) => {
                                const updated = [...deptMappings];
                                updated[i] = { ...m, target: v };
                                setDeptMappings(updated);
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="Select queue" /></SelectTrigger>
                              <SelectContent>
                                {queueList.map((q) => (
                                  <SelectItem key={q.id} value={q.number}>{q.number} — {q.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              className="h-8 text-xs w-44"
                              placeholder="Phone number"
                              value={m.target}
                              onChange={(e) => {
                                const updated = [...deptMappings];
                                updated[i] = { ...m, target: e.target.value };
                                setDeptMappings(updated);
                              }}
                            />
                          )}
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={() => setDeptMappings(deptMappings.filter((_, j) => j !== i))}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button size="sm" className="h-8" disabled={savingDepts} onClick={() => saveDeptMappings(bot.id)}>
                      {savingDepts ? "Saving..." : "Save Mappings"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* API Keys */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">API Keys</h2>
        <div className="flex gap-2">
          <Input
            placeholder="Key label (optional)"
            value={newKeyLabel}
            onChange={(e) => setNewKeyLabel(e.target.value)}
          />
          <Button onClick={handleCreateKey}>Create Key</Button>
        </div>
        {createdKey && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800 p-3 space-y-2">
            <p className="text-sm font-medium">New API Key (copy now, shown only once):</p>
            <div className="flex items-center gap-2">
              <code className="text-xs break-all select-all flex-1 bg-background/50 rounded px-2 py-1">{createdKey}</code>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => { navigator.clipboard.writeText(createdKey); toast.success("API key copied"); }}>Copy</Button>
            </div>
          </div>
        )}
        {keyList.length === 0 ? (
          <p className="text-muted-foreground text-sm">No API keys yet.</p>
        ) : (
          <div className="space-y-2">
            {keyList.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{k.key_prefix}...</span>
                    {k.label && <span className="text-xs text-muted-foreground">({k.label})</span>}
                  </div>
                  {k.last_used_at && <p className="text-[10px] text-muted-foreground">Last used: {new Date(k.last_used_at).toLocaleDateString()}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { navigator.clipboard.writeText(k.id); toast.success("Key ID copied"); }}>Copy ID</Button>
                  <Badge variant={k.is_active ? "default" : "destructive"}>
                    {k.is_active ? "Active" : "Revoked"}
                  </Badge>
                  {k.is_active && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={async () => {
                      if (!confirm("Delete this API key? Any integrations using it will stop working.")) return;
                      try {
                        await keys.revoke(orgId, k.id);
                        toast.success("API key deleted");
                        loadAll();
                      } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
                    }}>Delete</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* WebSocket URL */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">WebSocket Connection</h2>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground mb-2">Connect AstraPBX using:</p>
          <code className="text-xs break-all">
            wss://{typeof window !== "undefined" ? window.location.host : "localhost:7860"}/ws/{orgId}/&#123;bot_id&#125;?key=&#123;api_key&#125;
          </code>
        </div>
      </section>
    </div>
  );
}
