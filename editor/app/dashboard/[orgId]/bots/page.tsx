"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ChevronDown, ChevronUp, Plus, Trash2, Settings, Check, Sparkles, Key as KeyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { campaignBots, type CampaignBot, type CampaignBotInput } from "@/lib/campaigns/client";
import { bots, keys, orgConfig, type Bot, type ApiKey } from "@/lib/gateway/client";
import { queues as pbxQueues, users as pbxUsers, type PbxQueue, type PbxUser } from "@/lib/pbx/client";
import { toast } from "sonner";

interface AstraliteBotForm {
  name: string;
  language: string;
  keywords: string;
  max_words: string;
  call_timeout: string;
  webhook_url: string;
}

const defaultAstraliteForm: AstraliteBotForm = {
  name: "",
  language: "en",
  keywords: "",
  max_words: "3",
  call_timeout: "20",
  webhook_url: "",
};

export default function BotsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [botList, setBotList] = useState<Bot[]>([]);
  const [keyList, setKeyList] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createdKey, setCreatedKey] = useState("");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [error, setError] = useState("");
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);
  const [expandedBot, setExpandedBot] = useState<string | null>(null);
  const [deptMappings, setDeptMappings] = useState<{ label: string; key: string; target: string; type: "queue" | "phone" }[]>([]);
  const [savingDepts, setSavingDepts] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [botMode, setBotMode] = useState<"superhuman" | "astralite">("superhuman");
  const [astraliteBots, setAstraliteBots] = useState<CampaignBot[]>([]);
  const [astraliteLoading, setAstraliteLoading] = useState(false);
  const [astraliteError, setAstraliteError] = useState("");
  const [astraliteSearch, setAstraliteSearch] = useState("");
  const [astraliteSort, setAstraliteSort] = useState<"updated_at" | "name">("updated_at");
  const [astraliteDialogOpen, setAstraliteDialogOpen] = useState(false);
  const [astraliteEditingBot, setAstraliteEditingBot] = useState<CampaignBot | null>(null);
  const [astraliteForm, setAstraliteForm] = useState<AstraliteBotForm>(defaultAstraliteForm);
  const [astraliteSaving, setAstraliteSaving] = useState(false);
  const [astraliteDeletingBotId, setAstraliteDeletingBotId] = useState<string | null>(null);
  const [astraliteUploadingBotId, setAstraliteUploadingBotId] = useState<string | null>(null);

  // Create Agent dialog
  const [createBotOpen, setCreateBotOpen] = useState(false);
  const [createBotForm, setCreateBotForm] = useState({
    name: "",
    extension: "",
    gemini_model: "gemini-3.1-flash-live-preview",
    gemini_voice_id: "Kore",
  });
  const [creatingBot, setCreatingBot] = useState(false);

  // Create Key dialog
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [createKeyLabel, setCreateKeyLabel] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);

  // Extension pool — used by Suggest button
  const [takenExtensions, setTakenExtensions] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadAll();
    pbxQueues.list().then(setQueueList).catch(() => {});
  }, [orgId]);

  useEffect(() => {
    if (botMode !== "astralite") return;
    loadAstraliteBots();
  }, [botMode, orgId]);

  async function loadAll() {
    try {
      setLoading(true);
      const [b, k, cfg, u] = await Promise.all([
        bots.list(orgId),
        keys.list(orgId),
        orgConfig.get(orgId),
        pbxUsers.list().catch(() => [] as PbxUser[]),
      ]);
      setBotList(b);
      setKeyList(k);
      if (cfg) setGoogleApiKey(cfg.google_api_key);
      // Collect extensions already in use (users + bots' linked users)
      const used = new Set<string>();
      u.forEach((usr) => { if (usr.extension) used.add(usr.extension); });
      b.forEach((bot) => { if (bot.extension) used.add(bot.extension); });
      setTakenExtensions(used);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  // Suggest the lowest unused 4-digit extension starting from 1099.
  // Bot extensions live in the 1099-1199 range by convention to avoid
  // clashing with typical human extensions (1001-1098, 0986 etc.).
  function suggestBotExtension(): string {
    for (let n = 1099; n <= 1199; n++) {
      const s = String(n);
      if (!takenExtensions.has(s)) return s;
    }
    return "1099";
  }

  const GATEWAY_BASE_PUBLIC = process.env.NEXT_PUBLIC_GATEWAY_URL || "https://gateway.example.com";
  function botWssUrl(botId: string): string {
    const url = new URL(GATEWAY_BASE_PUBLIC.replace(/\/$/, ""));
    const scheme = url.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${url.host}/ws/${orgId}/${botId}`;
  }

  async function handleCreateBot() {
    if (!createBotForm.name.trim()) { toast.error("Agent name required"); return; }
    if (!createBotForm.extension.trim()) { toast.error("Extension required"); return; }
    if (takenExtensions.has(createBotForm.extension.trim())) {
      toast.error(`Extension ${createBotForm.extension} is already in use`);
      return;
    }
    setCreatingBot(true);
    let newBot: Bot | null = null;
    try {
      // 1. Create the bot record
      newBot = await bots.create(orgId, {
        name: createBotForm.name.trim(),
        flow_json: { nodes: [] },
        gemini_model: createBotForm.gemini_model,
        gemini_voice_id: createBotForm.gemini_voice_id,
      });
      // 2. Create a linked user so the bot is callable at the picked extension.
      // Uses routing_type=ai_agent + routing_destination=<bot wss URL>; the
      // pipecat-flow API exposes this pairing via GET /admin/orgs/{id}/bots
      // which enriches each bot with its user's extension.
      await pbxUsers.create({
        username: `bot_${createBotForm.extension}`,
        extension: createBotForm.extension.trim(),
        full_name: `${createBotForm.name.trim()} (Agent)`,
        email: `bot+${createBotForm.extension}@astradial.local`,
        password: `bot_${newBot.id.slice(0,8)}`,
        role: "agent",
        routing_type: "ai_agent",
        routing_destination: botWssUrl(newBot.id),
        ring_target: "ext",
      });
      toast.success(`Agent ${newBot.name} created at ext ${createBotForm.extension}`);
      setCreateBotOpen(false);
      setCreateBotForm({ name: "", extension: "", gemini_model: "gemini-3.1-flash-live-preview", gemini_voice_id: "Kore" });
      await loadAll();
    } catch (e) {
      // Rollback the bot if user creation failed (keep things consistent)
      if (newBot) {
        try { await bots.delete(orgId, newBot.id); } catch {}
      }
      toast.error(e instanceof Error ? e.message : "Failed to create agent");
    } finally {
      setCreatingBot(false);
    }
  }

  async function handleDeleteBot(bot: Bot) {
    if (!confirm(`Delete agent "${bot.name}"? This also removes its extension ${bot.extension || "(none)"}.`)) return;
    try {
      // Delete the linked user first (if any). Match by routing_destination
      // containing the bot ID; pipecat-flow uses the same matching strategy.
      if (bot.extension) {
        const userList = await pbxUsers.list();
        const linked = userList.find((u) => u.routing_type === "ai_agent" && u.routing_destination?.includes(bot.id));
        if (linked) {
          try { await pbxUsers.delete(linked.id); } catch (e) { console.warn("linked user delete failed", e); }
        }
      }
      await bots.delete(orgId, bot.id);
      toast.success(`Agent ${bot.name} deleted`);
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete agent");
    }
  }

  async function handleCreateKey() {
    setCreatingKey(true);
    try {
      const k = await keys.create(orgId, createKeyLabel);
      setCreatedKey(k.key || "");
      setCreateKeyLabel("");
      setCreateKeyOpen(false);
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create key");
    } finally {
      setCreatingKey(false);
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
  const filteredAstraliteBots = useMemo(() => {
    const q = astraliteSearch.trim().toLowerCase();
    const filtered = q
      ? astraliteBots.filter((bot) => {
          const keywords = Array.isArray(bot.keywords) ? bot.keywords.join(" ") : "";
          return `${bot.name} ${keywords}`.toLowerCase().includes(q);
        })
      : astraliteBots;

    return [...filtered].sort((a, b) => {
      if (astraliteSort === "name") return a.name.localeCompare(b.name);
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [astraliteBots, astraliteSearch, astraliteSort]);

  async function loadAstraliteBots() {
    try {
      setAstraliteLoading(true);
      setAstraliteError("");
      const res = await campaignBots.list(orgId);
      setAstraliteBots(res.data);
    } catch (e) {
      setAstraliteError(e instanceof Error ? e.message : "Failed to load Astralite bots");
    } finally {
      setAstraliteLoading(false);
    }
  }

  function openCreateAstraliteBot() {
    setAstraliteEditingBot(null);
    setAstraliteForm(defaultAstraliteForm);
    setAstraliteDialogOpen(true);
  }

  function openEditAstraliteBot(bot: CampaignBot) {
    setAstraliteEditingBot(bot);
    setAstraliteForm({
      name: bot.name,
      language: bot.language || "en",
      keywords: Array.isArray(bot.keywords) ? bot.keywords.join(", ") : "",
      max_words: String(bot.max_words ?? 3),
      call_timeout: String(bot.call_timeout ?? 20),
      webhook_url: bot.webhook_url || "",
    });
    setAstraliteDialogOpen(true);
  }

  function buildAstralitePayload(): CampaignBotInput {
    return {
      name: astraliteForm.name.trim(),
      language: astraliteForm.language.trim() || "en",
      keywords: astraliteForm.keywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      max_words: Math.max(1, Number(astraliteForm.max_words) || 3),
      call_timeout: Math.max(1, Number(astraliteForm.call_timeout) || 20),
      webhook_url: astraliteForm.webhook_url.trim() || null,
    };
  }

  async function handleSaveAstraliteBot() {
    if (!astraliteForm.name.trim()) {
      toast.error("Bot name required");
      return;
    }
    setAstraliteSaving(true);
    try {
      const data = buildAstralitePayload();
      if (astraliteEditingBot) {
        await campaignBots.update(orgId, astraliteEditingBot.id, data);
        toast.success("Astralite bot updated");
      } else {
        await campaignBots.create(orgId, data);
        toast.success("Astralite bot created");
      }
      setAstraliteDialogOpen(false);
      await loadAstraliteBots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save Astralite bot");
    } finally {
      setAstraliteSaving(false);
    }
  }

  async function handleDeleteAstraliteBot(bot: CampaignBot) {
    if (!confirm(`Delete Astralite bot "${bot.name}"?`)) return;
    setAstraliteDeletingBotId(bot.id);
    try {
      await campaignBots.delete(orgId, bot.id);
      toast.success("Astralite bot deleted");
      await loadAstraliteBots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete Astralite bot");
    } finally {
      setAstraliteDeletingBotId(null);
    }
  }

  async function handleAstraliteAudioUpload(bot: CampaignBot, file: File | null) {
    if (!file) return;
    setAstraliteUploadingBotId(bot.id);
    try {
      await campaignBots.uploadAudio(orgId, bot.id, file);
      toast.success("Intro audio uploaded");
      await loadAstraliteBots();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload intro audio");
    } finally {
      setAstraliteUploadingBotId(null);
    }
  }

  return (
    <div className="p-3 md:p-6 space-y-8">
      <div className="inline-flex rounded-lg border bg-muted/30 p-1">
        <Button
          variant={botMode === "superhuman" ? "default" : "ghost"}
          size="sm"
          className="h-8"
          onClick={() => setBotMode("superhuman")}
        >
          Superhuman
        </Button>
        <Button
          variant={botMode === "astralite" ? "default" : "ghost"}
          size="sm"
          className="h-8"
          onClick={() => setBotMode("astralite")}
        >
          Astralite
        </Button>
      </div>

      {botMode === "superhuman" ? (
        <>
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

      {/* WebSocket URL */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">WebSocket Connection</h2>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground mb-2">Connect AstraPBX using:</p>
          <code className="text-xs break-all">
            wss://gateway.example.com/ws/{orgId}/&#123;bot_id&#125;?key=&#123;api_key&#125;
          </code>
        </div>
      </section>

      {/* Tabs: Agents | API Keys */}
      <Tabs defaultValue="agents">
        <TabsList>
          <TabsTrigger value="agents" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Superhuman Agent
            {botList.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-1">{botList.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="keys" className="gap-1.5">
            <KeyIcon className="h-3.5 w-3.5" />
            API Keys
            {keyList.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-1">{keyList.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Agents Tab ── */}
        <TabsContent value="agents" className="mt-4">
          <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">SuperHuman Agents</h2>
            <p className="text-xs text-muted-foreground">AI voice agents callable at a dedicated extension</p>
          </div>
          <Button size="sm" onClick={() => {
            setCreateBotForm({ name: "", extension: suggestBotExtension(), gemini_model: "gemini-3.1-flash-live-preview", gemini_voice_id: "Kore" });
            setCreateBotOpen(true);
          }}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Create Agent
          </Button>
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
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteBot(bot)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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
        </TabsContent>

        {/* ── API Keys Tab ── */}
        <TabsContent value="keys" className="mt-4">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium">API Keys</h2>
                <p className="text-xs text-muted-foreground">For external integrations connecting to the gateway</p>
              </div>
          <Button size="sm" onClick={() => { setCreateKeyLabel(""); setCreateKeyOpen(true); }}>
            <KeyIcon className="h-3.5 w-3.5 mr-1.5" />
            Create Key
          </Button>
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
        </TabsContent>
      </Tabs>

      {/* Create Agent dialog */}
      <Dialog open={createBotOpen} onOpenChange={setCreateBotOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create SuperHuman Agent</DialogTitle>
            <DialogDescription>Give your AI agent a name and the extension customers will dial to reach it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Agent Name</Label>
              <Input
                placeholder="e.g. Reception AI"
                value={createBotForm.name}
                onChange={(e) => setCreateBotForm({ ...createBotForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Callable Extension</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="1099"
                  value={createBotForm.extension}
                  onChange={(e) => setCreateBotForm({ ...createBotForm, extension: e.target.value.replace(/[^0-9]/g, "") })}
                  className="font-mono"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setCreateBotForm({ ...createBotForm, extension: suggestBotExtension() })}>
                  Suggest
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {createBotForm.extension && takenExtensions.has(createBotForm.extension)
                  ? `⚠ Extension ${createBotForm.extension} is already in use`
                  : "Must be unique across users and agents in this org"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Select value={createBotForm.gemini_model} onValueChange={(v) => setCreateBotForm({ ...createBotForm, gemini_model: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini-3.1-flash-live-preview">Gemini 3.1 Flash (Live)</SelectItem>
                    <SelectItem value="gemini-3.0-pro-live">Gemini 3.0 Pro (Live)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Voice</Label>
                <Select value={createBotForm.gemini_voice_id} onValueChange={(v) => setCreateBotForm({ ...createBotForm, gemini_voice_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Kore">Kore</SelectItem>
                    <SelectItem value="Puck">Puck</SelectItem>
                    <SelectItem value="Charon">Charon</SelectItem>
                    <SelectItem value="Fenrir">Fenrir</SelectItem>
                    <SelectItem value="Aoede">Aoede</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateBotOpen(false)} disabled={creatingBot}>Cancel</Button>
            <Button onClick={handleCreateBot} disabled={creatingBot || !createBotForm.name || !createBotForm.extension}>
              {creatingBot ? "Creating..." : "Create Agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create API Key dialog */}
      <Dialog open={createKeyOpen} onOpenChange={setCreateKeyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>Generate a new key for external integrations to connect to the gateway.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Label (optional)</Label>
              <Input
                placeholder="e.g. Twilio webhook, Zapier"
                value={createKeyLabel}
                onChange={(e) => setCreateKeyLabel(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">Helps you identify where the key is used.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateKeyOpen(false)} disabled={creatingKey}>Cancel</Button>
            <Button onClick={handleCreateKey} disabled={creatingKey}>
              {creatingKey ? "Creating..." : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


        </>
      ) : (
        <section className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Astralite Voice Bots</h1>
              <p className="text-sm text-muted-foreground mt-1">Create and manage campaign phone bots.</p>
            </div>
            <Button size="sm" onClick={openCreateAstraliteBot}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Create Bot
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Input
              value={astraliteSearch}
              onChange={(e) => setAstraliteSearch(e.target.value)}
              placeholder="Search by name or keyword"
              className="sm:max-w-xs"
            />
            <Select value={astraliteSort} onValueChange={(v) => setAstraliteSort(v as "updated_at" | "name")}>
              <SelectTrigger className="sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_at">Recently updated</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {astraliteError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
              <p className="text-sm text-red-600 dark:text-red-300">{astraliteError}</p>
            </div>
          )}

          {astraliteLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border p-4 space-y-2">
                  <div className="h-4 bg-muted/60 rounded animate-pulse w-1/3" />
                  <div className="h-3 bg-muted/60 rounded animate-pulse w-1/2" />
                </div>
              ))}
            </div>
          ) : astraliteBots.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-6">
              <p className="text-sm font-medium">No Astralite bots yet.</p>
              <p className="text-sm text-muted-foreground mt-1">Bot management will appear here.</p>
            </div>
          ) : filteredAstraliteBots.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-6">
              <p className="text-sm font-medium">No matching bots.</p>
              <p className="text-sm text-muted-foreground mt-1">Try a different name or keyword.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAstraliteBots.map((bot) => (
                <div key={bot.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{bot.name}</p>
                        <Badge variant="secondary">{bot.language}</Badge>
                        <Badge variant={bot.intro_audio_path ? "default" : "outline"}>
                          {bot.intro_audio_path ? "Audio ready" : "No audio"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{bot.id}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {bot.keywords.length > 0 ? (
                          bot.keywords.map((keyword) => (
                            <Badge key={keyword} variant="outline" className="text-xs">
                              {keyword}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">No keywords</span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm sm:flex sm:items-center">
                      <div className="rounded-md border bg-muted/20 px-3 py-2">
                        <p className="text-[10px] uppercase text-muted-foreground">Timeout</p>
                        <p className="font-medium">{bot.call_timeout}s</p>
                      </div>
                      <div className="rounded-md border bg-muted/20 px-3 py-2">
                        <p className="text-[10px] uppercase text-muted-foreground">Max words</p>
                        <p className="font-medium">{bot.max_words}</p>
                      </div>
                      <Input
                        id={`astralite-audio-${bot.id}`}
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0] || null;
                          await handleAstraliteAudioUpload(bot, file);
                          e.target.value = "";
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={astraliteUploadingBotId === bot.id}
                        onClick={() => document.getElementById(`astralite-audio-${bot.id}`)?.click()}
                      >
                        {astraliteUploadingBotId === bot.id
                          ? "Uploading..."
                          : bot.intro_audio_path
                            ? "Change Audio"
                            : "Upload Audio"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEditAstraliteBot(bot)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={astraliteDeletingBotId === bot.id}
                        onClick={() => handleDeleteAstraliteBot(bot)}
                      >
                        {astraliteDeletingBotId === bot.id ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Dialog open={astraliteDialogOpen} onOpenChange={setAstraliteDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{astraliteEditingBot ? "Edit Astralite Bot" : "Create Astralite Bot"}</DialogTitle>
                <DialogDescription>Configure the campaign phone bot behavior.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={astraliteForm.name}
                    onChange={(e) => setAstraliteForm({ ...astraliteForm, name: e.target.value })}
                    placeholder="e.g. Campaign Qualifier"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Language</Label>
                    <Input
                      value={astraliteForm.language}
                      onChange={(e) => setAstraliteForm({ ...astraliteForm, language: e.target.value })}
                      placeholder="en"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max Words</Label>
                    <Input
                      type="number"
                      min={1}
                      value={astraliteForm.max_words}
                      onChange={(e) => setAstraliteForm({ ...astraliteForm, max_words: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Call Timeout</Label>
                  <Input
                    type="number"
                    min={1}
                    value={astraliteForm.call_timeout}
                    onChange={(e) => setAstraliteForm({ ...astraliteForm, call_timeout: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Keywords</Label>
                  <Input
                    value={astraliteForm.keywords}
                    onChange={(e) => setAstraliteForm({ ...astraliteForm, keywords: e.target.value })}
                    placeholder="yes, interested, pricing"
                  />
                  <p className="text-[10px] text-muted-foreground">Separate keywords with commas.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Webhook URL (optional)</Label>
                  <Input
                    value={astraliteForm.webhook_url}
                    onChange={(e) => setAstraliteForm({ ...astraliteForm, webhook_url: e.target.value })}
                    placeholder="https://example.com/webhook"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAstraliteDialogOpen(false)} disabled={astraliteSaving}>
                  Cancel
                </Button>
                <Button onClick={handleSaveAstraliteBot} disabled={astraliteSaving || !astraliteForm.name.trim()}>
                  {astraliteSaving ? "Saving..." : astraliteEditingBot ? "Save Changes" : "Create Bot"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      )}
      </div>
  );
}
