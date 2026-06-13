"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  MessageSquare,
  MoreHorizontal,
  Music,
  Pause,
  Play,
  Plus,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/Toast";
import {
  type Greeting,
  greetingsApi,
  moh,
  type MohListResponse,
  type MohOrgClass,
  type PbxQueue,
  type PbxUser,
  type QueueMember,
  queues,
  tts,
  type TtsModel,
  type TtsVoiceGroup,
  users as pbxUsers,
} from "@/lib/pbx/client";

export default function QueuesPage() {
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [mohData, setMohData] = useState<MohListResponse>({ org_classes: [], system_classes: [] });
  const [greetingList, setGreetingList] = useState<Greeting[]>([]);
  const [loading, setLoading] = useState(true);

  // Queue dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingQueue, setEditingQueue] = useState<PbxQueue | null>(null);
  const [form, setForm] = useState({ name: "", number: "", strategy: "ringall", timeout: "15" });
  const [editForm, setEditForm] = useState({
    name: "",
    number: "",
    strategy: "ringall",
    timeout: "15",
    max_wait_time: "45",
    timeout_destination: "",
    timeout_destination_type: "extension",
    music_on_hold: "default",
    greeting_id: "",
    status: "active",
  });
  const [userList, setUserList] = useState<PbxUser[]>([]);
  // Per-member edit form state. `newMember*` drives the "+ Add member"
  // row; ring time defaults to 20s (Asterisk's historical queue.timeout
  // default), matching the backend default for ring_timeout_seconds.
  const [newMemberUserId, setNewMemberUserId] = useState<string>("");
  const [newMemberRingTime, setNewMemberRingTime] = useState<string>("20");

  // MOH dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mohClassName, setMohClassName] = useState("custom");
  const [mohFile, setMohFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Greeting dialog
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [greetingForm, setGreetingForm] = useState({
    name: "",
    text: "",
    language: "en-IN",
    voice: "en-IN-Chirp3-HD-Achernar",
    // tts_model gates the style-instructions field. Default chirp3-hd
    // matches the backend default and means no style prompt input.
    tts_model: "chirp3-hd",
    style_instructions: "",
  });
  const [creatingGreeting, setCreatingGreeting] = useState(false);

  // Audio player
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingUrl, setPlayingUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [systemMohFiles, setSystemMohFiles] = useState<string[]>([]);

  useEffect(() => {
    loadAll();
  }, []);

  // Available TTS models + per-model voice/language maps. Fetched once
  // on mount; the API caches the underlying Google data for an hour.
  // Falls back to the legacy /tts/voices result if /tts/models fails
  // (older API versions only had the voices endpoint).
  const [voiceGroups, setVoiceGroups] = useState<TtsVoiceGroup[]>([]);
  const [ttsModels, setTtsModels] = useState<TtsModel[]>([]);
  useEffect(() => {
    tts
      .voices()
      .then(setVoiceGroups)
      .catch(() => setVoiceGroups([]));
    tts
      .models()
      .then((r) => setTtsModels(r.models))
      .catch(() => setTtsModels([]));
  }, []);
  const selectedModelDef = ttsModels.find((m) => m.id === greetingForm.tts_model);
  const supportsStyle = selectedModelDef?.supportsStyleInstructions === true;
  // Languages available under the currently-selected model. If
  // /tts/models hasn't loaded, fall back to the legacy /tts/voices list.
  const languagesForSelectedModel = selectedModelDef
    ? Object.keys(selectedModelDef.voicesByLanguage)
    : voiceGroups.map((g) => g.language);
  // Voices for (current model, current language). Auto-corrected when
  // either model or language changes so we never point at a voice
  // belonging to a different (model, language) pair.
  const voicesForSelectedLang = selectedModelDef
    ? selectedModelDef.voicesByLanguage[greetingForm.language] || []
    : voiceGroups.find((g) => g.language === greetingForm.language)?.voices || [];
  // Friendly display name for a voice: strip the language prefix +
  // model-family prefix so the operator sees just "Achernar"/"Aoede"/"Kore".
  function prettyVoice(v: string): string {
    return v.replace(
      /^[a-z]{2}-[A-Z]{2}-(?:Chirp3-HD-|Chirp3-|Wavenet-|Neural2-|Studio-|Standard-)/,
      ""
    );
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [q, m, g, sysFiles, u] = await Promise.all([
        queues.list(),
        moh.list().catch(() => ({ org_classes: [], system_classes: [] }) as MohListResponse),
        greetingsApi.list().catch(() => []),
        fetch("/api/audio/moh-list")
          .then((r) => r.json())
          .then((d) => d.files || [])
          .catch(() => []),
        pbxUsers.list().catch(() => []),
      ]);
      setQueueList(q);
      setUserList(u);
      // Handle both old format ({ org_classes, system_classes }) and simplified format ({ classes })
      const mohResult = m as any;
      if (mohResult?.classes && !mohResult?.system_classes) {
        const classNames = (mohResult.classes || []).map((c: any) => c.name || c);
        setMohData({ system_classes: classNames, org_classes: [] });
      } else {
        setMohData(mohResult?.system_classes ? mohResult : { org_classes: [], system_classes: [] });
      }
      setGreetingList(g);
      setSystemMohFiles(sysFiles);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }

  // ─── Queue CRUD ───

  async function handleCreate() {
    try {
      await queues.create({
        name: form.name,
        number: form.number,
        strategy: form.strategy,
        timeout: parseInt(form.timeout),
      });
      showToast("Queue created", "success");
      setCreateOpen(false);
      setForm({ name: "", number: "", strategy: "ringall", timeout: "15" });
      await loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  function openEdit(q: PbxQueue) {
    setEditingQueue(q);
    setEditForm({
      name: q.name,
      number: q.number,
      strategy: q.strategy,
      timeout: String(q.timeout),
      max_wait_time: String(q.max_wait_time || 45),
      timeout_destination: (q as any).timeout_destination || "",
      timeout_destination_type: (q as any).timeout_destination_type || "extension",
      music_on_hold: q.music_on_hold || "default",
      greeting_id: q.greeting_id || "",
      status: q.status,
    });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editingQueue) return;
    try {
      let music_on_hold = editForm.music_on_hold;
      if (music_on_hold.startsWith("sys:")) {
        const filename = music_on_hold.slice(4);
        const data = await moh.importSystemFile(filename);
        music_on_hold = data.moh_class_name;
      }
      await queues.update(editingQueue.id, {
        name: editForm.name,
        number: editForm.number,
        strategy: editForm.strategy,
        timeout: parseInt(editForm.timeout),
        max_wait_time: parseInt(editForm.max_wait_time) || 45,
        timeout_destination: editForm.timeout_destination || null,
        timeout_destination_type: editForm.timeout_destination_type || "extension",
        music_on_hold,
        greeting_id: editForm.greeting_id || null,
        status: editForm.status as PbxQueue["status"],
      } as any);
      showToast("Queue updated", "success");
      setEditOpen(false);
      await loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this queue?")) return;
    try {
      await queues.delete(id);
      showToast("Queue deleted", "success");
      await loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  // ─── MOH ───

  async function handleUploadMoh() {
    if (!mohFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("audio", mohFile);
      fd.append("class_name", mohClassName);
      await moh.upload(fd);
      showToast("Music uploaded", "success");
      setUploadOpen(false);
      setMohFile(null);
      setMohClassName("custom");
      await loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteMoh(className: string, filename: string) {
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await moh.delete(className, filename);
      showToast("Deleted", "success");
      await loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  // ─── Greetings ───

  async function handleCreateGreeting() {
    setCreatingGreeting(true);
    try {
      // Strip style_instructions when the model doesn't support it —
      // the API rejects with 400 otherwise. The form holds onto the
      // typed text so it's not lost if the operator toggles models.
      const payload = {
        ...greetingForm,
        style_instructions:
          supportsStyle && greetingForm.style_instructions.trim()
            ? greetingForm.style_instructions.trim()
            : null,
      };
      await greetingsApi.create(payload);
      showToast("Greeting created — audio generated", "success");
      setGreetingOpen(false);
      setGreetingForm({
        name: "",
        text: "",
        language: "en-IN",
        voice: "en-IN-Chirp3-HD-Achernar",
        tts_model: "chirp3-hd",
        style_instructions: "",
      });
      await loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setCreatingGreeting(false);
    }
  }

  async function handleDeleteGreeting(id: string) {
    if (!confirm("Delete this greeting?")) return;
    try {
      await greetingsApi.delete(id);
      showToast("Deleted", "success");
      await loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  // ─── Audio Preview ───

  function playPreview(url: string) {
    if (playingUrl === url && isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (playingUrl !== url) {
        setPlayingUrl(url);
        setIsPlaying(false);
        // Wait for src to update then play
        setTimeout(() => {
          audioRef.current?.load();
          audioRef.current
            ?.play()
            .then(() => setIsPlaying(true))
            .catch(() => {});
        }, 100);
      } else {
        audioRef.current
          ?.play()
          .then(() => setIsPlaying(true))
          .catch(() => {});
      }
    }
  }

  function stopPreview() {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setPlayingUrl("");
  }

  // All MOH classes combined for display and dropdowns.
  // Each system .wav file gets a sys:<filename> entry so it can be picked
  // and imported into the org as its own class on save (handleEdit).
  const allMohForDropdown = [
    ...mohData.system_classes.map((name) => ({
      value: name,
      label: name,
      is_system: true,
      file_count: 0,
    })),
    ...systemMohFiles.map((f) => ({
      value: `sys:${f}`,
      label: f.replace(/\.wav$/, "").replace(/-/g, " "),
      is_system: true,
      file_count: 1,
    })),
    ...mohData.org_classes.map((c) => ({
      value: c.moh_class_name,
      label: `${c.class} (custom)`,
      is_system: false,
      file_count: c.file_count,
    })),
  ];

  return (
    <div className="p-3 md:p-6 space-y-8">
      {/* Audio element */}
      <audio
        ref={audioRef}
        src={playingUrl}
        onEnded={() => {
          setIsPlaying(false);
          setPlayingUrl("");
        }}
        onPause={() => setIsPlaying(false)}
      />

      {/* Sticky audio player bar */}
      {playingUrl && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border bg-background/95 backdrop-blur px-4 py-2 shadow-lg">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 rounded-full"
            onClick={() => playPreview(playingUrl)}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <span className="text-xs text-muted-foreground max-w-[200px] truncate">
            {decodeURIComponent(playingUrl.split("/").pop() || "").replace(".wav", "")}
          </span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={stopPreview}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* ─── Queues Section ─── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Queues</h1>
            <p className="text-sm text-muted-foreground">
              Manage call queues, hold music, and greetings
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                Add Queue
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create Queue</DialogTitle>
                <DialogDescription>Set up a new call queue</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Support"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Extension</Label>
                    <Input
                      value={form.number}
                      onChange={(e) => setForm({ ...form, number: e.target.value })}
                      placeholder="5001"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Strategy</Label>
                  <Select
                    value={form.strategy}
                    onValueChange={(v) => setForm({ ...form, strategy: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ringall">Ring All</SelectItem>
                      <SelectItem value="leastrecent">Least Recent</SelectItem>
                      <SelectItem value="fewestcalls">Fewest Calls</SelectItem>
                      <SelectItem value="random">Random</SelectItem>
                      <SelectItem value="rrmemory">Round Robin</SelectItem>
                      <SelectItem value="linear">Linear</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-2">
          <div className="overflow-auto flex-1 relative">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
                <TableRow className="border-b-border/50 hover:bg-transparent">
                  <TableHead className="w-20">Ext</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>MOH</TableHead>
                  <TableHead>Timeout</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton cols={7} />
                ) : queueList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No queues
                    </TableCell>
                  </TableRow>
                ) : (
                  queueList.slice((page - 1) * pageSize, page * pageSize).map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-mono text-sm">{q.number}</TableCell>
                      <TableCell className="font-medium">{q.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {q.strategy}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {allMohForDropdown.find((m) => m.value === q.music_on_hold)?.label ||
                          q.music_on_hold ||
                          "default"}
                      </TableCell>
                      <TableCell className="text-sm">{q.timeout}s</TableCell>
                      <TableCell>
                        <Badge
                          variant={q.status === "active" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {q.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(q)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(q.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {queueList.length > 10 && (
            <div className="border-t border-border/50 bg-muted/30 px-4 py-3 sticky bottom-0 z-10 flex items-center justify-between">
              <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, queueList.length)} of{" "}
                {queueList.length} entries
              </div>
              <div className="flex w-full items-center gap-8 lg:w-fit">
                <div className="hidden items-center gap-2 lg:flex">
                  <Label className="text-sm font-medium">Rows per page</Label>
                  <Select
                    value={`${pageSize}`}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue placeholder={pageSize} />
                    </SelectTrigger>
                    <SelectContent side="top">
                      {[10, 20, 30, 40, 50].map((size) => (
                        <SelectItem key={size} value={`${size}`}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex w-fit items-center justify-center text-sm font-medium">
                  Page {page} of {Math.ceil(queueList.length / pageSize) || 1}
                </div>
                <div className="ml-auto flex items-center gap-2 lg:ml-0">
                  <Button
                    variant="outline"
                    className="hidden h-8 w-8 p-0 lg:flex"
                    onClick={() => setPage(1)}
                    disabled={page <= 1}
                  >
                    <span className="sr-only">Go to first page</span>
                    <ChevronsLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="size-8"
                    size="icon"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page <= 1}
                  >
                    <span className="sr-only">Go to previous page</span>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="size-8"
                    size="icon"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page * pageSize >= queueList.length}
                  >
                    <span className="sr-only">Go to next page</span>
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="hidden size-8 lg:flex"
                    size="icon"
                    onClick={() => setPage(Math.ceil(queueList.length / pageSize))}
                    disabled={page * pageSize >= queueList.length}
                  >
                    <span className="sr-only">Go to last page</span>
                    <ChevronsRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Music on Hold Section ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Music className="h-5 w-5" />
              Music on Hold
            </CardTitle>
            <CardDescription>Upload and manage hold music for queues</CardDescription>
          </div>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Upload className="h-4 w-4 mr-1.5" />
                Upload Audio
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Upload Hold Music</DialogTitle>
                <DialogDescription>
                  MP3, WAV, OGG, FLAC — auto-converted to Asterisk format
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label>Class Name</Label>
                  <Input
                    value={mohClassName}
                    onChange={(e) => setMohClassName(e.target.value)}
                    placeholder="custom"
                  />
                  <p className="text-[10px] text-muted-foreground">Group name for this music set</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Audio File</Label>
                  <Input
                    type="file"
                    accept=".mp3,.wav,.ogg,.flac,.m4a,.aac"
                    onChange={(e) => setMohFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUploadOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleUploadMoh} disabled={!mohFile || uploading}>
                  {uploading ? "Uploading..." : "Upload"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {/* Default system MOH files */}
            <div className="rounded-md border px-3 py-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">default</span>
                  <span className="text-xs text-muted-foreground">
                    {systemMohFiles.length} file(s)
                  </span>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  System
                </Badge>
              </div>
              {systemMohFiles.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-7">
                  {systemMohFiles.map((f) => (
                    <Button
                      key={f}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => playPreview(`/api/audio/moh/${f}`)}
                    >
                      <Play className="h-3 w-3" />
                      {f.replace(".wav", "").slice(0, 25)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            {/* Other system classes — show only as labels (no files on disk) */}
            {mohData.system_classes.filter((n) => n !== "default").length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-xs text-muted-foreground">Other system classes:</span>
                {mohData.system_classes
                  .filter((n) => n !== "default")
                  .map((name) => (
                    <Badge key={name} variant="outline" className="text-[10px]">
                      {name}
                    </Badge>
                  ))}
                <span className="text-[10px] text-muted-foreground">
                  (no audio files installed)
                </span>
              </div>
            )}
            {/* Org custom MOH classes */}
            {mohData.org_classes.map((c) => (
              <div
                key={c.moh_class_name}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-sm font-medium">{c.class}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {c.file_count} file(s)
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.files?.map((f) => (
                    <div key={f.filename} className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          playPreview(`/api/audio/moh/${c.moh_class_name}/${f.filename}`)
                        }
                      >
                        <Play className="h-3 w-3 mr-1" />
                        {f.filename.slice(0, 20)}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => handleDeleteMoh(c.moh_class_name, f.filename)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {mohData.org_classes.length === 0 && mohData.system_classes.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">No music classes configured</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Greetings (TTS) Section ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Greetings (TTS)
            </CardTitle>
            <CardDescription>Create text-to-speech greetings for callers</CardDescription>
          </div>
          <Dialog open={greetingOpen} onOpenChange={setGreetingOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4 mr-1.5" />
                Create Greeting
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create TTS Greeting</DialogTitle>
                <DialogDescription>
                  Type your greeting text — audio will be generated automatically
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input
                    value={greetingForm.name}
                    onChange={(e) => setGreetingForm({ ...greetingForm, name: e.target.value })}
                    placeholder="Welcome Greeting"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Greeting Text</Label>
                  <Textarea
                    value={greetingForm.text}
                    onChange={(e) => setGreetingForm({ ...greetingForm, text: e.target.value })}
                    placeholder="Welcome to Grand Estancia. Please hold while we connect you to a team member."
                    className="min-h-[80px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>TTS Model</Label>
                  <Select
                    value={greetingForm.tts_model}
                    onValueChange={(v) => {
                      // Snap voice + language to ones supported by the
                      // newly-selected model. Chirp3-HD has per-language
                      // voice names like en-IN-Chirp3-HD-Achernar; Gemini
                      // has bare names like Kore that work across all
                      // supported languages.
                      const def = ttsModels.find((m) => m.id === v);
                      const langOk = def && def.voicesByLanguage[greetingForm.language];
                      const nextLang = langOk
                        ? greetingForm.language
                        : def
                          ? Object.keys(def.voicesByLanguage)[0]
                          : greetingForm.language;
                      const nextVoice = def?.voicesByLanguage[nextLang]?.[0] || greetingForm.voice;
                      setGreetingForm({
                        ...greetingForm,
                        tts_model: v,
                        language: nextLang,
                        voice: nextVoice,
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ttsModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedModelDef?.description && (
                    <p className="text-xs text-muted-foreground">{selectedModelDef.description}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Language</Label>
                    <Select
                      value={greetingForm.language}
                      onValueChange={(v) => {
                        // Snap voice to the first one supported by the
                        // selected (model, new-language) pair.
                        const firstVoice =
                          selectedModelDef?.voicesByLanguage[v]?.[0] ||
                          voiceGroups.find((g) => g.language === v)?.voices[0] ||
                          greetingForm.voice;
                        setGreetingForm({ ...greetingForm, language: v, voice: firstVoice });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {languagesForSelectedModel.map((lc) => {
                          const fromList = voiceGroups.find((g) => g.language === lc);
                          return (
                            <SelectItem key={lc} value={lc}>
                              {fromList?.label || lc}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Voice</Label>
                    {/* SearchableSelect: limit 5 visible rows with
                        internal scroll + live search filter. Required
                        UX once we mix models (Chirp 3 HD per-language
                        + Gemini language-agnostic = bigger list). */}
                    <SearchableSelect
                      options={voicesForSelectedLang.map((v) => ({
                        value: v,
                        label: prettyVoice(v),
                      }))}
                      value={greetingForm.voice}
                      onChange={(v) => setGreetingForm({ ...greetingForm, voice: v })}
                      placeholder="Select voice"
                      searchPlaceholder="Search voice…"
                      limit={5}
                    />
                  </div>
                </div>
                {/* Style instructions — Gemini-only. Backend rejects
                    if sent with chirp3-hd, so we hide the field for
                    non-supporting models. */}
                {supportsStyle && (
                  <div className="space-y-1.5">
                    <Label>
                      Style instructions{" "}
                      <span className="text-xs text-muted-foreground">(optional)</span>
                    </Label>
                    <Textarea
                      rows={2}
                      value={greetingForm.style_instructions}
                      onChange={(e) =>
                        setGreetingForm({ ...greetingForm, style_instructions: e.target.value })
                      }
                      placeholder='e.g. "Speak in a warm hotel-reception tone." or "Sound urgent and clear."'
                      maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground">
                      A short natural-language nudge for how the bot should sound. Gemini models
                      only. Max 500 chars.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setGreetingOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateGreeting}
                  disabled={!greetingForm.name || !greetingForm.text || creatingGreeting}
                >
                  {creatingGreeting ? "Generating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {greetingList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No greetings created yet</p>
          ) : (
            <div className="space-y-2">
              {greetingList.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{g.name}</span>
                      <p className="text-xs text-muted-foreground truncate">{g.text}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px]">
                      {g.voice?.split("-").pop()}
                    </Badge>
                    <Badge
                      variant={g.status === "active" ? "default" : "secondary"}
                      className="text-[10px] cursor-pointer"
                      onClick={async () => {
                        try {
                          await greetingsApi.update(g.id, {
                            status: g.status === "active" ? "inactive" : "active",
                          });
                          showToast(
                            g.status === "active" ? "Greeting disabled" : "Greeting enabled",
                            "success"
                          );
                          await loadAll();
                        } catch (e) {
                          showToast(e instanceof Error ? e.message : "Failed", "error");
                        }
                      }}
                    >
                      {g.status === "active" ? "Enabled" : "Disabled"}
                    </Badge>
                    {g.audio_file && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => playPreview(`/api/audio/greetings/${g.id}/audio`)}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={async () => {
                            await greetingsApi.update(g.id, {
                              status: g.status === "active" ? "inactive" : "active",
                            });
                            await loadAll();
                          }}
                        >
                          {g.status === "active" ? "Disable" : "Enable"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDeleteGreeting(g.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Edit Queue Dialog ─── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        {/*
          Edit-queue sheet sizing — `max-h-[85vh]` + the flex-column +
          `overflow-y-auto` on the middle pane keep the dialog within
          the viewport when a queue has many members. Without this the
          dialog grew with content past the bottom of the screen and
          there was no way to reach the Save button. Header and footer
          stay pinned (shrink-0); the form body scrolls.
        */}
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
            <DialogTitle>Edit Queue — {editingQueue?.name}</DialogTitle>
            <DialogDescription>Update queue settings, hold music, and greeting</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Extension</Label>
                <Input
                  value={editForm.number}
                  onChange={(e) => setEditForm({ ...editForm, number: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Strategy</Label>
                <Select
                  value={editForm.strategy}
                  onValueChange={(v) => setEditForm({ ...editForm, strategy: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ringall">Ring All</SelectItem>
                    <SelectItem value="leastrecent">Least Recent</SelectItem>
                    <SelectItem value="fewestcalls">Fewest Calls</SelectItem>
                    <SelectItem value="random">Random</SelectItem>
                    <SelectItem value="rrmemory">Round Robin</SelectItem>
                    <SelectItem value="linear">Linear</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Max Wait (sec)</Label>
                <Input
                  type="number"
                  value={editForm.max_wait_time}
                  onChange={(e) => setEditForm({ ...editForm, max_wait_time: e.target.value })}
                  placeholder="45"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Timeout Destination</Label>
                <Select
                  value={editForm.timeout_destination_type}
                  onValueChange={(v) => setEditForm({ ...editForm, timeout_destination_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extension">Extension</SelectItem>
                    <SelectItem value="queue">Queue</SelectItem>
                    <SelectItem value="phone">Phone Number</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Destination{" "}
                  {editForm.timeout_destination_type === "phone"
                    ? "Number"
                    : editForm.timeout_destination_type === "queue"
                      ? "Queue"
                      : "Extension"}
                </Label>
                <Input
                  value={editForm.timeout_destination}
                  onChange={(e) =>
                    setEditForm({ ...editForm, timeout_destination: e.target.value })
                  }
                  placeholder={
                    editForm.timeout_destination_type === "phone"
                      ? "9876543210"
                      : editForm.timeout_destination_type === "queue"
                        ? "5002"
                        : "1003"
                  }
                />
              </div>
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label>Music on Hold</Label>
              <Select
                value={editForm.music_on_hold}
                onValueChange={(v) => setEditForm({ ...editForm, music_on_hold: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allMohForDropdown.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label} {c.is_system ? "(system)" : ""}{" "}
                      {c.file_count > 0 ? `— ${c.file_count} files` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Greeting</Label>
              <Select
                value={editForm.greeting_id || "__none__"}
                onValueChange={(v) =>
                  setEditForm({ ...editForm, greeting_id: v === "__none__" ? "" : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No greeting" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No greeting</SelectItem>
                  {greetingList.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Members</Label>
              {/*
                Each member row shows: name + ext, then priority up/down
                arrows (lower penalty = higher priority), a ring-time
                input (seconds, 5–300), and a remove button. The priority
                arrows mutate the queue_member's `penalty` field; for
                non-linear strategies Asterisk uses penalty to tier
                members (penalty 0 rings first; only after all penalty-0
                members fail does it ring penalty 1, etc.). For `linear`,
                penalty plus dialplan order determine ring order.
              */}
              {editingQueue?.members && editingQueue.members.length > 0 ? (
                <div className="space-y-1">
                  {(() => {
                    // Sort stably: primary by penalty, secondary by id so the
                    // displayed order is deterministic across renders for
                    // tied penalties (until the operator differentiates them
                    // with an arrow click).
                    const sortedMembers = [...editingQueue.members].sort(
                      (a, b) => (a.penalty ?? 0) - (b.penalty ?? 0) || a.id.localeCompare(b.id)
                    );
                    return sortedMembers.map((m, idx) => {
                      // Optimistic update: patch local state IMMEDIATELY on
                      // click then fire PATCH in the background. Without
                      // this, the user sees no feedback for ~5s while the
                      // server runs deployOrganizationConfiguration +
                      // reloadAsteriskConfiguration. On error we revert.
                      const applyLocal = (
                        changes: { id: string; next: Partial<QueueMember> }[]
                      ) => {
                        if (!editingQueue) return;
                        const byId = new Map(changes.map((c) => [c.id, c.next]));
                        setEditingQueue({
                          ...editingQueue,
                          members: (editingQueue.members || []).map((row) =>
                            byId.has(row.id) ? { ...row, ...byId.get(row.id)! } : row
                          ),
                        });
                      };
                      const refreshAfter = async () => {
                        await loadAll();
                        if (editingQueue) {
                          const updated = await queues.get(editingQueue.id);
                          setEditingQueue(updated);
                        }
                      };

                      // ── Swap-with-adjacent priority semantics ─────────
                      // Clicking ↑ on member B (with A directly above in the
                      // sorted list) should make B rank ABOVE A. We adjust
                      // BOTH members' penalties so they never end up tied:
                      //   - newB = pA               (B takes A's rank)
                      //   - newA = pB > pA ? pB : pA+1   (A goes below B)
                      // ↓ on A is symmetric: same operation initiated from
                      // the other side.
                      const swapWith = async (otherIdx: number) => {
                        if (!editingQueue) return;
                        if (otherIdx < 0 || otherIdx >= sortedMembers.length) return;
                        // Identify "upper" (currently higher rank) and "lower"
                        // (currently lower rank) members regardless of which
                        // arrow fired this swap.
                        const upper = sortedMembers[Math.min(idx, otherIdx)];
                        const lower = sortedMembers[Math.max(idx, otherIdx)];
                        const pUpper = upper.penalty ?? 0;
                        const pLower = lower.penalty ?? 0;
                        const newLowerPenalty = pUpper;
                        const newUpperPenalty = pLower > pUpper ? pLower : Math.min(10, pUpper + 1);
                        if (newLowerPenalty === pLower && newUpperPenalty === pUpper) return; // no-op
                        // Optimistic: swap their displayed P-values now.
                        applyLocal([
                          { id: lower.id, next: { penalty: newLowerPenalty } },
                          { id: upper.id, next: { penalty: newUpperPenalty } },
                        ]);
                        try {
                          // Sequentially patch — each PATCH triggers a deploy;
                          // running them in parallel could race on
                          // queues.conf / ext_<org>.conf file writes.
                          await queues.updateMember(editingQueue.id, lower.user_id, {
                            penalty: newLowerPenalty,
                          });
                          await queues.updateMember(editingQueue.id, upper.user_id, {
                            penalty: newUpperPenalty,
                          });
                          await refreshAfter();
                        } catch (e) {
                          applyLocal([
                            { id: lower.id, next: { penalty: pLower } },
                            { id: upper.id, next: { penalty: pUpper } },
                          ]);
                          showToast(e instanceof Error ? e.message : "Failed", "error");
                        }
                      };

                      // Ring-time edits are still single-member; reuse the
                      // simpler updateMember path for those.
                      const updateMember = async (updates: { ring_timeout_seconds?: number }) => {
                        if (!editingQueue) return;
                        const prev = { ring_timeout_seconds: m.ring_timeout_seconds };
                        applyLocal([{ id: m.id, next: updates }]);
                        try {
                          await queues.updateMember(editingQueue.id, m.user_id, updates);
                          await refreshAfter();
                        } catch (e) {
                          applyLocal([{ id: m.id, next: prev }]);
                          showToast(e instanceof Error ? e.message : "Failed", "error");
                        }
                      };

                      const penalty = m.penalty ?? 0;
                      const ringTime = m.ring_timeout_seconds ?? 20;
                      const canRaise = idx > 0; // not already top
                      const canLower = idx < sortedMembers.length - 1; // not already bottom
                      return (
                        <div
                          key={m.id}
                          className="flex items-center gap-2 text-sm border rounded-md px-2.5 py-1.5"
                        >
                          <span className="flex-1 min-w-0 truncate flex items-center gap-1.5">
                            <span className="truncate">
                              {m.user?.full_name || "Unknown"}{" "}
                              <span className="text-muted-foreground">
                                — ext {m.user?.extension}
                              </span>
                            </span>
                            {m.user?.status === "inactive" && (
                              // Off-shift indicator. Agents flip their user
                              // status to "inactive" when leaving for the day;
                              // the backend skips them from queues.conf so they
                              // don't ring, but the membership row stays in
                              // place so they're auto-restored when they flip
                              // back to active. "invited" and "suspended" are
                              // separate states (onboarding / admin-action)
                              // and intentionally not labelled "off shift".
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 h-4 shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400"
                              >
                                Off shift
                              </Badge>
                            )}
                          </span>
                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              disabled={!canRaise}
                              title={
                                canRaise
                                  ? `Move up — swap with ${sortedMembers[idx - 1]?.user?.full_name || "above"}`
                                  : "Already top"
                              }
                              onClick={() => swapWith(idx - 1)}
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <span className="text-xs text-muted-foreground w-6 text-center tabular-nums">
                              P{penalty}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              disabled={!canLower}
                              title={
                                canLower
                                  ? `Move down — swap with ${sortedMembers[idx + 1]?.user?.full_name || "below"}`
                                  : "Already bottom"
                              }
                              onClick={() => swapWith(idx + 1)}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </div>
                          <Input
                            type="number"
                            min={5}
                            max={300}
                            defaultValue={ringTime}
                            className="h-6 w-16 text-xs px-1"
                            title="Ring time (seconds) for this member"
                            onBlur={(e) => {
                              const v = Number(e.currentTarget.value);
                              if (Number.isInteger(v) && v >= 5 && v <= 300 && v !== ringTime) {
                                updateMember({ ring_timeout_seconds: v });
                              } else if (v !== ringTime) {
                                // Reset display if out-of-range so user sees the rejection
                                e.currentTarget.value = String(ringTime);
                                showToast("Ring time must be 5–300 seconds", "error");
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                            }}
                          />
                          <span className="text-xs text-muted-foreground">s</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive"
                            onClick={async () => {
                              try {
                                await queues.removeMember(editingQueue.id, m.user_id);
                                showToast("Member removed", "success");
                                await refreshAfter();
                              } catch (e) {
                                showToast(e instanceof Error ? e.message : "Failed", "error");
                              }
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No members</p>
              )}

              {/* Add member row: user select + ring time + add button.
                  Ring time defaults to 20s. Penalty is auto-assigned as
                  `max(existing penalties) + 1` so every new member slots
                  in at the LOWEST current priority — that's the more
                  useful default than "always P0", which gave every new
                  member the highest priority and required the operator
                  to immediately demote them. First member of an empty
                  queue still gets P0. */}
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  {/*
                    SearchableSelect — same component the IVR voice
                    picker uses. Internal scroll (limit=5 rows) + a
                    search input filters users by name or extension.
                    Required for orgs with many users; the regular
                    Select dropdown overflowed the dialog and had no
                    search so finding a specific user took manual
                    scanning.
                  */}
                  <SearchableSelect
                    options={userList
                      // Operators can add inactive users too — they are
                      // simply skipped from queues.conf until status flips
                      // back to "active". This supports the off-shift flow
                      // where an agent toggles themselves off when leaving.
                      .filter((u) => !editingQueue?.members?.some((m) => m.user_id === u.id))
                      .map((u) => ({
                        value: u.id,
                        label: u.full_name || u.username,
                        hint:
                          u.status === "inactive"
                            ? `ext ${u.extension} · off shift`
                            : `ext ${u.extension}`,
                      }))}
                    value={newMemberUserId}
                    onChange={setNewMemberUserId}
                    placeholder="+ Select user to add…"
                    searchPlaceholder="Search by name or extension…"
                    emptyText="No matching users"
                    className="h-8 text-xs"
                  />
                </div>
                <Input
                  type="number"
                  min={5}
                  max={300}
                  value={newMemberRingTime}
                  onChange={(e) => setNewMemberRingTime(e.target.value)}
                  className="h-8 w-16 text-xs px-1"
                  title="Ring time (seconds) for new member"
                />
                <span className="text-xs text-muted-foreground">s</span>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={!newMemberUserId}
                  onClick={async () => {
                    if (!editingQueue || !newMemberUserId) return;
                    const ringTime = Number(newMemberRingTime);
                    if (!Number.isInteger(ringTime) || ringTime < 5 || ringTime > 300) {
                      showToast("Ring time must be 5–300 seconds", "error");
                      return;
                    }
                    // Stair-step the new penalty: empty queue → P0,
                    // otherwise max+1 (capped at 10). Operator can still
                    // promote them with the ↑ arrow afterward.
                    const existingPenalties = (editingQueue.members || []).map(
                      (mm) => mm.penalty ?? 0
                    );
                    const nextPenalty =
                      existingPenalties.length === 0
                        ? 0
                        : Math.min(10, Math.max(...existingPenalties) + 1);
                    try {
                      await queues.addMember(editingQueue.id, newMemberUserId, {
                        ring_timeout_seconds: ringTime,
                        penalty: nextPenalty,
                      });
                      showToast("Member added", "success");
                      setNewMemberUserId("");
                      setNewMemberRingTime("20");
                      await loadAll();
                      const updated = await queues.get(editingQueue.id);
                      setEditingQueue(updated);
                    } catch (e) {
                      showToast(e instanceof Error ? e.message : "Failed", "error");
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm({ ...editForm, status: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="shrink-0 px-6 pb-6 pt-2 border-t">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
