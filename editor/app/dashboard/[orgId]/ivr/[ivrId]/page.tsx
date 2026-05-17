"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Play,
  Volume2,
  Sparkles,
  Save,
  UploadCloud,
  X,
} from "lucide-react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type OnConnect,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/Toast";
import {
  ivrs,
  queues,
  tts,
  users as pbxUsers,
  type Ivr,
  type IvrActionType,
  type IvrMenuOption,
  type PbxQueue,
  type PbxUser,
  type TtsModel,
  type TtsVoiceGroup,
} from "@/lib/pbx/client";
import { SearchableSelect } from "@/components/ui/searchable-select";

import EntryNode, { type EntryNodeData } from "./nodes/EntryNode";
import GreetingNode, { type GreetingNodeData } from "./nodes/GreetingNode";
import MenuNode, { type MenuNodeData } from "./nodes/MenuNode";

const ACTION_TYPES: IvrActionType[] = [
  "extension",
  "queue",
  "ivr",
  "ai_agent",
  "voicemail",
  "callback",
  "hangup",
];
const ACTION_LABEL: Record<IvrActionType, string> = {
  extension: "Ring extension",
  queue: "Send to queue",
  ivr: "Nested IVR",
  ai_agent: "AI agent",
  voicemail: "Voicemail",
  callback: "Callback",
  hangup: "Hang up",
};

const nodeTypes: NodeTypes = {
  entry: EntryNode,
  greeting: GreetingNode,
  menu: MenuNode,
};

const PREVIEW_SAMPLES: Record<string, string> = {
  "en-IN": "Hello, this is a preview of the selected voice.",
  "en-US": "Hello, this is a preview of the selected voice.",
  "en-GB": "Hello, this is a preview of the selected voice.",
  "hi-IN": "नमस्ते, यह चयनित आवाज़ का पूर्वावलोकन है।",
  "ta-IN": "வணக்கம், இது தேர்ந்தெடுக்கப்பட்ட குரலின் மாதிரி.",
  "te-IN": "హలో, ఇది ఎంపిక చేసిన స్వరం యొక్క ప్రివ్యూ.",
  "kn-IN": "ನಮಸ್ಕಾರ, ಇದು ಆಯ್ಕೆ ಮಾಡಿದ ಧ್ವನಿಯ ಮುನ್ನೋಟ.",
  "ml-IN": "ഹലോ, ഇത് തിരഞ്ഞെടുത്ത ശബ്ദത്തിന്റെ പ്രിവ്യൂ ആണ്.",
  "mr-IN": "नमस्कार, हे निवडलेल्या आवाजाचे पूर्वावलोकन आहे.",
  "gu-IN": "નમસ્તે, આ પસંદ કરેલા અવાજનું પૂર્વાવલોકન છે.",
  "bn-IN": "নমস্কার, এটি নির্বাচিত কণ্ঠের প্রিভিউ।",
};

export default function IvrBuilderPage() {
  return (
    <ReactFlowProvider>
      <IvrBuilderInner />
    </ReactFlowProvider>
  );
}

// Shape we keep for each menu-option beyond the node view's summary.
// This is the authoritative source of truth that we translate to
// IvrMenuOption[] when saving.
interface MenuDraft {
  id: string;                 // local uuid used as React Flow node id
  digit: string;
  action_type: IvrActionType;
  action_destination: string; // extension number or uuid depending on type
  description: string;
}

function IvrBuilderInner() {
  const { orgId, ivrId } = useParams<{ orgId: string; ivrId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [playingSaved, setPlayingSaved] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirtyMenu, setDirtyMenu] = useState(false);

  // IVR metadata
  const [ivr, setIvr] = useState<Ivr | null>(null);
  const [name, setName] = useState("");
  const [extension, setExtension] = useState("");
  const [description, setDescription] = useState("");
  const [timeoutS, setTimeoutS] = useState(10);
  const [maxRetries, setMaxRetries] = useState(3);
  // On no-keypress, what should the IVR do? 'retry' (default) replays
  // the greeting up to max_retries times before hanging up — that's
  // the historical behavior. 'queue'/'extension' route to
  // timeoutDestination immediately so a customer whose default flow
  // is "drop straight into queue 5002 if they don't press anything"
  // doesn't burn N × greeting cycles on every silent call.
  const [timeoutAction, setTimeoutAction] = useState<"retry" | "queue" | "extension" | "hangup">("retry");
  const [timeoutDestination, setTimeoutDestination] = useState("");
  const [directDial, setDirectDial] = useState(false);
  const [language, setLanguage] = useState("en-IN");
  const [voice, setVoice] = useState("en-IN-Chirp3-HD-Achernar");
  // TTS model selection — gates style-instructions visibility. Default
  // 'chirp3-hd' matches the backend default for new greetings; legacy
  // rows without a tts_model are also treated as chirp3-hd.
  const [ttsModel, setTtsModel] = useState<string>("chirp3-hd");
  // Style prompt — only relevant for Gemini models; we still hold it
  // in state when the model is chirp3-hd so the operator doesn't lose
  // typed text when toggling models back and forth in the same session.
  const [styleInstructions, setStyleInstructions] = useState<string>("");
  const [greetingText, setGreetingText] = useState("");
  const [greetingFile, setGreetingFile] = useState<string | null>(null);

  // Catalogs
  const [voices, setVoices] = useState<TtsVoiceGroup[]>([]);
  const [ttsModels, setTtsModels] = useState<TtsModel[]>([]);
  const [allIvrs, setAllIvrs] = useState<Ivr[]>([]);
  const [allUsers, setAllUsers] = useState<PbxUser[]>([]);
  const [allQueues, setAllQueues] = useState<PbxQueue[]>([]);

  // Authoritative menu options (node data is derived from this)
  const [menus, setMenus] = useState<MenuDraft[]>([]);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Prevent nodes-to-menus feedback loops during canvas updates
  const hydrating = useRef(false);

  // ─── Load ───
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ivrId]);

  async function loadAll() {
    setLoading(true);
    try {
      const [full, v, modelsResp, list, u, q] = await Promise.all([
        ivrs.get(ivrId),
        tts.voices().catch(() => [] as TtsVoiceGroup[]),
        tts.models().catch(() => ({ models: [], defaultModel: "chirp3-hd" })),
        ivrs.list().catch(() => [] as Ivr[]),
        pbxUsers.list().catch(() => [] as PbxUser[]),
        queues.list().catch(() => [] as PbxQueue[]),
      ]);
      setIvr(full);
      setName(full.name);
      setExtension(full.extension);
      setDescription(full.description ?? "");
      setTimeoutS(full.timeout);
      setMaxRetries(full.max_retries);
      setTimeoutAction((full.timeout_action as "retry" | "queue" | "extension" | "hangup") || "retry");
      setTimeoutDestination(full.timeout_destination || "");
      setDirectDial(full.enable_direct_dial);
      setLanguage(full.greeting_language);
      setVoice(full.greeting_voice);
      // Legacy rows have no tts_model; treat as chirp3-hd.
      setTtsModel(full.tts_model || "chirp3-hd");
      setStyleInstructions(full.style_instructions || "");
      setGreetingText(full.greeting_text ?? "");
      setGreetingFile(full.greeting_prompt);
      setTtsModels(modelsResp.models);

      const m: MenuDraft[] = (full.menuOptions ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((o: IvrMenuOption) => ({
          id: o.id ?? `local-${Math.random().toString(36).slice(2)}`,
          digit: String(o.digit),
          action_type: o.action_type,
          action_destination: o.action_destination ?? "",
          description: o.description ?? "",
        }));
      setMenus(m);

      setVoices(v);
      setAllIvrs(list.filter((i: Ivr) => i.id !== ivrId));
      setAllUsers(u);
      setAllQueues(q);
      setDirtyMenu(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Load failed", "error");
    } finally {
      setLoading(false);
    }
  }

  // ─── Derived: menu destination → human label + validity ───
  const destinationLabel = useCallback(
    (action: IvrActionType, dest: string): string => {
      if (action === "hangup") return "Hang up";
      if (!dest) return "";
      if (action === "extension" || action === "voicemail") {
        const u = allUsers.find((x) => x.extension === dest);
        return u ? `${dest} — ${u.full_name || u.username}` : `ext ${dest}`;
      }
      if (action === "queue") {
        const q = allQueues.find((x) => x.id === dest);
        return q ? `${q.number} — ${q.name}` : dest;
      }
      if (action === "ivr") {
        const i = allIvrs.find((x) => x.id === dest);
        return i ? `${i.name} (ext ${i.extension})` : dest;
      }
      if (action === "ai_agent") {
        const a = allUsers.find((x) => x.id === dest);
        return a ? `${a.full_name || a.username} (ext ${a.extension})` : dest;
      }
      return dest;
    },
    [allUsers, allQueues, allIvrs]
  );

  const isMenuValid = (action: IvrActionType, dest: string) =>
    action === "hangup" || !!dest;

  // ─── Rebuild nodes + edges whenever menus / metadata / catalogs change ───
  useEffect(() => {
    if (loading) return;
    hydrating.current = true;

    const entryNode: Node = {
      id: "entry",
      type: "entry",
      position: { x: 40, y: 220 },
      data: {
        name,
        extension,
        timeout: timeoutS,
        maxRetries,
        directDial,
      } as EntryNodeData,
      draggable: false,
    };
    const greetingNode: Node = {
      id: "greeting",
      type: "greeting",
      position: { x: 320, y: 200 },
      data: {
        language,
        voice,
        text: greetingText,
        greetingFile,
      } as GreetingNodeData,
    };

    const menuNodes: Node[] = menus.map((m, i) => ({
      id: m.id,
      type: "menu",
      position: { x: 700, y: 60 + i * 140 },
      data: {
        digit: m.digit,
        action_type: m.action_type,
        destinationLabel: destinationLabel(m.action_type, m.action_destination),
        description: m.description,
        isValid: isMenuValid(m.action_type, m.action_destination),
      } as MenuNodeData,
    }));

    const newEdges: Edge[] = [
      {
        id: "entry-greeting",
        source: "entry",
        target: "greeting",
        animated: true,
      },
      ...menus.map((m) => ({
        id: `greeting-${m.id}`,
        source: "greeting",
        target: m.id,
        label: m.digit,
        labelStyle: { fontSize: 11, fontWeight: 600 },
        labelBgPadding: [4, 2] as [number, number],
      })),
    ];

    setNodes([entryNode, greetingNode, ...menuNodes]);
    setEdges(newEdges);
    hydrating.current = false;
  }, [
    loading,
    name,
    extension,
    timeoutS,
    maxRetries,
    directDial,
    language,
    voice,
    greetingText,
    greetingFile,
    menus,
    destinationLabel,
    setNodes,
    setEdges,
  ]);

  const onConnect: OnConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge(conn, eds)),
    [setEdges]
  );

  // ─── Menu actions ───
  function addMenu() {
    const used = new Set(menus.map((m) => m.digit));
    const candidates = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "*", "#"];
    const digit = candidates.find((d) => !used.has(d)) ?? "#";
    const local: MenuDraft = {
      id: `local-${Math.random().toString(36).slice(2)}`,
      digit,
      action_type: "extension",
      action_destination: "",
      description: "",
    };
    setMenus((prev) => [...prev, local]);
    setDirtyMenu(true);
    setSelectedId(local.id);
  }

  function updateMenu(id: string, patch: Partial<MenuDraft>) {
    setMenus((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
    setDirtyMenu(true);
  }

  function deleteMenu(id: string) {
    setMenus((prev) => prev.filter((m) => m.id !== id));
    setDirtyMenu(true);
    if (selectedId === id) setSelectedId(null);
  }

  // ─── Save / publish ───
  async function handleSaveMetadata() {
    setSaving(true);
    try {
      await ivrs.update(ivrId, {
        name,
        extension,
        description,
        timeout: timeoutS,
        max_retries: maxRetries,
        enable_direct_dial: directDial,
        greeting_language: language,
        greeting_voice: voice,
        // Persist the model + style selection without requiring an
        // audio regeneration. Operators can pick a model and "Save
        // settings" — then "Generate greeting" later re-renders
        // with the saved choice. Without these here the form silently
        // dropped them on Save, surfacing as data loss on page reload.
        tts_model: ttsModel,
        style_instructions: supportsStyle && styleInstructions.trim()
          ? styleInstructions.trim()
          : null,
        // Send the destination only when the chosen action actually
        // uses it — otherwise null it out so stale values from a
        // previously-saved 'queue' setting don't leak into 'hangup'.
        timeout_action: timeoutAction,
        timeout_destination: (timeoutAction === "queue" || timeoutAction === "extension")
          ? (timeoutDestination.trim() || null)
          : null,
      });
      showToast("Settings saved", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveMenu() {
    // Validate
    const digits = new Set<string>();
    for (const m of menus) {
      if (digits.has(m.digit)) {
        showToast(`Digit ${m.digit} is used more than once`, "error");
        return;
      }
      digits.add(m.digit);
      if (!isMenuValid(m.action_type, m.action_destination)) {
        showToast(`Digit ${m.digit}: pick a destination`, "error");
        return;
      }
    }

    setSaving(true);
    try {
      await ivrs.saveMenu(
        ivrId,
        menus.map((m, i) => ({
          digit: m.digit,
          action_type: m.action_type,
          action_destination: m.action_destination || null,
          description: m.description || null,
          order: i,
        }))
      );
      showToast("Menu saved", "success");
      setDirtyMenu(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (dirtyMenu) {
      showToast("Save menu changes before publishing", "error");
      return;
    }
    setPublishing(true);
    try {
      await ivrs.publish(ivrId);
      showToast("Published — dialplan regenerated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Publish failed", "error");
    } finally {
      setPublishing(false);
    }
  }

  // ─── TTS ───
  async function handleGenerateGreeting() {
    if (!greetingText.trim()) {
      showToast("Enter greeting text first", "error");
      return;
    }
    setGenerating(true);
    try {
      const res = await ivrs.generateGreeting(ivrId, {
        text: greetingText,
        language,
        voice,
        tts_model: ttsModel,
        // Only send the style prompt when the model actually supports
        // it — server rejects with 400 otherwise, but no point round-
        // tripping a known-invalid combo.
        style_instructions: supportsStyle && styleInstructions.trim() ? styleInstructions.trim() : null,
      });
      setGreetingFile(res.greeting_prompt);
      showToast(`Greeting generated in ${res.language}`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Generation failed", "error");
    } finally {
      setGenerating(false);
    }
  }

  async function handlePlayGenerated() {
    if (!greetingFile) return;
    setPlayingSaved(true);
    try {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("pbx_org_token") || ""
          : "";
      const src = `/api/pbx/ivrs/${ivrId}/greeting-audio?token=${encodeURIComponent(token)}&_t=${Date.now()}`;
      const audio = new Audio(src);
      audio.onended = () => setPlayingSaved(false);
      audio.onerror = () => {
        setPlayingSaved(false);
        showToast("Could not play greeting", "error");
      };
      await audio.play();
    } catch (e) {
      setPlayingSaved(false);
      showToast(e instanceof Error ? e.message : "Playback failed", "error");
    }
  }

  async function handlePreviewVoice() {
    setPreviewing(true);
    try {
      const text =
        greetingText.trim() ||
        PREVIEW_SAMPLES[language] ||
        PREVIEW_SAMPLES["en-IN"];
      const blob = await tts.preview({
        text,
        language,
        voice,
        model: ttsModel,
        style_instructions: supportsStyle && styleInstructions.trim() ? styleInstructions.trim() : undefined,
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewing(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setPreviewing(false);
        showToast("Playback failed", "error");
      };
      await audio.play();
    } catch (e) {
      setPreviewing(false);
      showToast(e instanceof Error ? e.message : "Preview failed", "error");
    }
  }

  // ─── Inspector panel ───
  const selectedMenu = menus.find((m) => m.id === selectedId) || null;
  const selectedNodeType: "entry" | "greeting" | "menu" | null = selectedId
    ? selectedId === "entry"
      ? "entry"
      : selectedId === "greeting"
        ? "greeting"
        : selectedMenu
          ? "menu"
          : null
    : null;

  // Voice list for the current (model, language) combination. Pulled
  // from the /tts/models response which has per-model voice maps:
  // Chirp 3 HD has full <lang>-Chirp3-HD-<celestial> names, Gemini
  // models share a celestial name set across all languages. Falls
  // back to the legacy /tts/voices result for the old chirp3-hd-only
  // shape when /tts/models didn't load.
  const selectedModelDef = useMemo(
    () => ttsModels.find((m) => m.id === ttsModel),
    [ttsModels, ttsModel]
  );
  const voicesForLang = useMemo(() => {
    if (selectedModelDef) return selectedModelDef.voicesByLanguage[language] ?? [];
    return voices.find((v) => v.language === language)?.voices ?? [];
  }, [selectedModelDef, voices, language]);
  const languagesForModel = useMemo(() => {
    if (selectedModelDef) return Object.keys(selectedModelDef.voicesByLanguage);
    return voices.map((v) => v.language);
  }, [selectedModelDef, voices]);
  const supportsStyle = selectedModelDef?.supportsStyleInstructions === true;
  const aiAgents = useMemo(
    () =>
      allUsers.filter(
        (u: PbxUser & { routing_type?: string }) =>
          (u as { routing_type?: string }).routing_type === "ai_agent"
      ),
    [allUsers]
  );
  const regularExtensions = useMemo(
    () =>
      allUsers.filter(
        (u: PbxUser & { routing_type?: string }) =>
          (u as { routing_type?: string }).routing_type !== "ai_agent"
      ),
    [allUsers]
  );

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading IVR…</div>;
  if (!ivr) {
    return (
      <div className="p-6">
        <p>IVR not found.</p>
        <Link
          href={`/dashboard/${orgId}/ivr`}
          className="text-primary hover:underline"
        >
          ← Back
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/dashboard/${orgId}/ivr`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{name || "Untitled IVR"}</div>
            <div className="text-xs text-muted-foreground">
              ext {extension} · {language} · {menus.length} option
              {menus.length === 1 ? "" : "s"}
              {dirtyMenu && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  unsaved menu
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={addMenu}>
            <Plus className="h-4 w-4 mr-2" />
            Add option
          </Button>
          <Button variant="outline" onClick={handleSaveMenu} disabled={saving || !dirtyMenu}>
            <Save className="h-4 w-4 mr-2" />
            Save menu
          </Button>
          <Button onClick={handlePublish} disabled={publishing || dirtyMenu}>
            <UploadCloud className="h-4 w-4 mr-2" />
            {publishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>

      {/* Canvas + inspector */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} />
            <Controls />
            <MiniMap pannable zoomable className="!bg-background" />
          </ReactFlow>
        </div>

        {selectedNodeType && (
          <div className="w-[360px] border-l bg-background overflow-y-auto">
            <div className="sticky top-0 z-10 bg-background border-b px-4 py-2 flex items-center justify-between">
              <div className="text-sm font-semibold capitalize">
                {selectedNodeType === "entry"
                  ? "IVR entry"
                  : selectedNodeType === "greeting"
                    ? "Greeting"
                    : `Option ${selectedMenu?.digit ?? ""}`}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSelectedId(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-4 space-y-4">
              {selectedNodeType === "entry" && (
                <>
                  <div className="grid gap-2">
                    <Label>Name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Extension</Label>
                    <Input
                      value={extension}
                      onChange={(e) => setExtension(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-2">
                      <Label>Timeout (s)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={timeoutS}
                        onChange={(e) => {
                          // Preserve a typed 0 (= WaitExten(0), wait forever).
                          // `|| 10` would coerce it back to 10 — bug W1.
                          const v = e.target.value === "" ? 10 : Number(e.target.value);
                          setTimeoutS(Number.isFinite(v) && v >= 0 ? v : 10);
                        }}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Max retries</Label>
                      <Select
                        value={String(maxRetries || 3)}
                        onValueChange={(v) => setMaxRetries(Number(v))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 attempt</SelectItem>
                          <SelectItem value="2">2 attempts</SelectItem>
                          <SelectItem value="3">3 attempts</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        Greeting repeats on no-response, hangup after N attempts
                      </p>
                    </div>
                  </div>

                  {/*
                    No-keypress action. Default 'retry' = legacy: replay
                    greeting until max_retries then hangup. 'queue' /
                    'extension' skip retries and route immediately on
                    first WaitExten timeout — best for IVRs whose
                    purpose is "press a key to redirect, OR default
                    drop to reception queue".
                  */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-2">
                      <Label>On no-keypress</Label>
                      <Select
                        value={timeoutAction}
                        onValueChange={(v) => setTimeoutAction(v as "retry" | "queue" | "extension" | "hangup")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="retry">Retry greeting (default)</SelectItem>
                          <SelectItem value="queue">Go to queue</SelectItem>
                          <SelectItem value="extension">Go to extension</SelectItem>
                          <SelectItem value="hangup">Hang up</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        Skips retries when set to queue/extension/hangup
                      </p>
                    </div>
                    {(timeoutAction === "queue" || timeoutAction === "extension") && (
                      <div className="grid gap-2">
                        <Label>
                          {timeoutAction === "queue" ? "Queue number" : "Extension"}
                        </Label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={timeoutDestination}
                          onChange={(e) => setTimeoutDestination(e.target.value.replace(/[^0-9]/g, ""))}
                          placeholder={timeoutAction === "queue" ? "5002" : "1004"}
                        />
                        <p className="text-[10px] text-muted-foreground">
                          {timeoutAction === "queue"
                            ? "Caller drops into this queue on no-keypress"
                            : "Caller routes to this extension on no-keypress"}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Direct extension dial</Label>
                      <p className="text-[10px] text-muted-foreground">
                        Allow 4-digit dial to skip menu
                      </p>
                    </div>
                    <Switch
                      checked={directDial}
                      onCheckedChange={setDirectDial}
                    />
                  </div>
                  <Button className="w-full" variant="outline" onClick={handleSaveMetadata} disabled={saving}>
                    Save settings
                  </Button>
                </>
              )}

              {selectedNodeType === "greeting" && (
                <>
                  <div className="grid gap-2">
                    <Label>TTS Model</Label>
                    <Select
                      value={ttsModel}
                      onValueChange={(v) => {
                        setTtsModel(v);
                        // Snap voice to the first one available under
                        // the new model + current language. Different
                        // models have different voice name schemes
                        // (Chirp3-HD is `<lang>-Chirp3-HD-<name>`,
                        // Gemini is bare `<name>`).
                        const def = ttsModels.find((m) => m.id === v);
                        const first = def?.voicesByLanguage[language]?.[0];
                        if (first) setVoice(first);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ttsModels.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedModelDef?.description && (
                      <p className="text-xs text-muted-foreground">{selectedModelDef.description}</p>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label>Language</Label>
                    <Select
                      value={language}
                      onValueChange={(v) => {
                        setLanguage(v);
                        // Snap voice to the first one in the new
                        // language under the current model.
                        const first = selectedModelDef?.voicesByLanguage[v]?.[0]
                          ?? voices.find((x) => x.language === v)?.voices[0];
                        if (first) setVoice(first);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {languagesForModel.map((lc) => {
                          const fromList = voices.find((v) => v.language === lc);
                          return (
                            <SelectItem key={lc} value={lc}>
                              {fromList?.label || lc}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Voice</Label>
                    <div className="flex items-center gap-2">
                      {/* SearchableSelect: shows ~5 rows at once with
                          internal scroll, search input filters live —
                          required by the user for the (eventually
                          long) voice lists across models / languages. */}
                      <SearchableSelect
                        options={voicesForLang.map((v) => ({
                          value: v,
                          // Strip lang prefix + family for a readable label;
                          // falls through for bare Gemini names like "Kore".
                          label: v.replace(/^[a-z]{2}-[A-Z]{2}-(?:Chirp3-HD-|Chirp3-|Wavenet-|Neural2-|Studio-|Standard-)/, ""),
                        }))}
                        value={voice}
                        onChange={setVoice}
                        placeholder="Select voice"
                        searchPlaceholder="Search voice…"
                        limit={5}
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        title="Preview voice"
                        onClick={handlePreviewVoice}
                        disabled={previewing}
                      >
                        <Volume2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {/* Style instructions — Gemini-only. Hidden for
                      Chirp 3 HD because the backend rejects the field
                      for models that don't support a prompt. */}
                  {supportsStyle && (
                    <div className="grid gap-2">
                      <Label>Style instructions <span className="text-xs text-muted-foreground">(optional)</span></Label>
                      <Textarea
                        rows={2}
                        value={styleInstructions}
                        onChange={(e) => setStyleInstructions(e.target.value)}
                        placeholder='e.g. "Speak in a warm hotel-reception tone." or "Sound urgent and clear."'
                        maxLength={500}
                      />
                      <p className="text-xs text-muted-foreground">A short natural-language nudge for how the bot should sound. Max 500 chars.</p>
                    </div>
                  )}
                  <div className="grid gap-2">
                    <Label>Greeting text</Label>
                    <Textarea
                      rows={5}
                      value={greetingText}
                      onChange={(e) => setGreetingText(e.target.value)}
                      placeholder="Welcome…"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {greetingFile ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePlayGenerated}
                        disabled={playingSaved}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        {playingSaved ? "Playing…" : "Play"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No greeting generated yet
                      </span>
                    )}
                    <Button onClick={handleGenerateGreeting} disabled={generating}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      {generating
                        ? "Generating…"
                        : greetingFile
                          ? "Regenerate"
                          : "Generate"}
                    </Button>
                  </div>
                </>
              )}

              {selectedNodeType === "menu" && selectedMenu && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-2">
                      <Label>Digit</Label>
                      <Input
                        value={selectedMenu.digit}
                        onChange={(e) =>
                          updateMenu(selectedMenu.id, {
                            digit: e.target.value.slice(0, 1),
                          })
                        }
                        maxLength={1}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Action</Label>
                      <Select
                        value={selectedMenu.action_type}
                        onValueChange={(v) =>
                          updateMenu(selectedMenu.id, {
                            action_type: v as IvrActionType,
                            action_destination: "",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACTION_TYPES.map((a) => (
                            <SelectItem key={a} value={a}>
                              {ACTION_LABEL[a]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {selectedMenu.action_type !== "hangup" && (
                    <div className="grid gap-2">
                      <Label>Destination</Label>
                      <DestinationPicker
                        action={selectedMenu.action_type}
                        value={selectedMenu.action_destination}
                        onChange={(v) =>
                          updateMenu(selectedMenu.id, {
                            action_destination: v,
                          })
                        }
                        users={regularExtensions}
                        aiAgents={aiAgents}
                        queues={allQueues}
                        ivrs={allIvrs}
                      />
                    </div>
                  )}

                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Input
                      value={selectedMenu.description}
                      onChange={(e) =>
                        updateMenu(selectedMenu.id, {
                          description: e.target.value,
                        })
                      }
                      placeholder="Optional"
                    />
                  </div>

                  <Button
                    variant="ghost"
                    className="w-full text-destructive hover:text-destructive"
                    onClick={() => deleteMenu(selectedMenu.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete option
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DestinationPicker({
  action,
  value,
  onChange,
  users,
  aiAgents,
  queues,
  ivrs: ivrList,
}: {
  action: IvrActionType;
  value: string;
  onChange: (v: string) => void;
  users: PbxUser[];
  aiAgents: PbxUser[];
  queues: PbxQueue[];
  ivrs: Ivr[];
}) {
  if (action === "callback") {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional callback number"
      />
    );
  }
  if (action === "extension" || action === "voicemail") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick an extension…" />
        </SelectTrigger>
        <SelectContent>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.extension}>
              {u.extension} — {u.full_name || u.username}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (action === "queue") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick a queue…" />
        </SelectTrigger>
        <SelectContent>
          {queues.map((q) => (
            <SelectItem key={q.id} value={q.id}>
              {q.number} — {q.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (action === "ivr") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick another IVR…" />
        </SelectTrigger>
        <SelectContent>
          {ivrList.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name} (ext {i.extension})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (action === "ai_agent") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick an AI agent…" />
        </SelectTrigger>
        <SelectContent>
          {aiAgents.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No AI agents — create one in Super Human first
            </div>
          ) : (
            aiAgents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.full_name || a.username} (ext {a.extension})
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    );
  }
  return null;
}
