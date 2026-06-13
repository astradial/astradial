"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Edit3,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

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
import { Switch } from "@/components/ui/switch";
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
import { type Ivr, ivrs, tts, type TtsVoiceGroup } from "@/lib/pbx/client";

export default function IvrListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [list, setList] = useState<Ivr[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [voices, setVoices] = useState<TtsVoiceGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    extension: "",
    description: "",
    greeting_language: "en-IN",
    greeting_voice: "en-IN-Chirp3-HD-Achernar",
    timeout: 10,
    max_retries: 3,
    enable_direct_dial: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [i, v] = await Promise.all([
        ivrs.list(),
        tts.voices().catch(() => [] as TtsVoiceGroup[]),
      ]);
      setList(i);
      setVoices(v);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load IVRs", "error");
    } finally {
      setLoading(false);
    }
  }

  const voicesForLang = (lang: string) => voices.find((v) => v.language === lang)?.voices ?? [];

  async function handleCreate() {
    if (!form.name.trim() || !form.extension.trim()) {
      showToast("Name and extension are required", "error");
      return;
    }
    setSaving(true);
    try {
      const created = await ivrs.create(form);
      showToast(`IVR "${created.name}" created`, "success");
      setCreateOpen(false);
      setForm({
        name: "",
        extension: "",
        description: "",
        greeting_language: "en-IN",
        greeting_voice: "en-IN-Chirp3-HD-Achernar",
        timeout: 10,
        max_retries: 3,
        enable_direct_dial: false,
      });
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to create", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ivr: Ivr) {
    if (!confirm(`Delete IVR "${ivr.name}"? This cannot be undone.`)) return;
    try {
      await ivrs.delete(ivr.id);
      showToast("IVR deleted", "success");
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete", "error");
    }
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">IVR</h1>
          <p className="text-sm text-muted-foreground">
            Interactive voice menus — greet callers, route them by digit press
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create IVR
        </Button>
      </div>

      <CardContent>
        {loading ? (
          <Table>
            <TableBody>
              <TableSkeleton rows={3} cols={6} />
            </TableBody>
          </Table>
        ) : list.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="mb-4">No IVRs yet.</p>
            <Button onClick={() => setCreateOpen(true)} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Create your first IVR
            </Button>
          </div>
        ) : (
          <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-2">
            <div className="overflow-auto flex-1 relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
                  <TableRow className="border-b-border/50 hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Extension</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>Options</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.slice((page - 1) * pageSize, page * pageSize).map((ivr) => (
                    <TableRow key={ivr.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/dashboard/${orgId}/ivr/${ivr.id}`}
                          className="hover:underline"
                        >
                          {ivr.name}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums">{ivr.extension}</TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {ivr.greeting_language}
                        </span>
                      </TableCell>
                      <TableCell>
                        {ivr.menuOptions?.length ?? 0} option
                        {(ivr.menuOptions?.length ?? 0) === 1 ? "" : "s"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ivr.status === "active" ? "default" : "secondary"}>
                          {ivr.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/dashboard/${orgId}/ivr/${ivr.id}`}>
                                <Edit3 className="h-4 w-4 mr-2" />
                                Open builder
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(ivr)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {list.length > 10 && (
              <div className="border-t border-border/50 bg-muted/30 px-4 py-3 sticky bottom-0 z-10 flex items-center justify-between">
                <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, list.length)} of{" "}
                  {list.length} entries
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
                    Page {page} of {Math.ceil(list.length / pageSize) || 1}
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
                      disabled={page * pageSize >= list.length}
                    >
                      <span className="sr-only">Go to next page</span>
                      <ChevronRight className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="hidden size-8 lg:flex"
                      size="icon"
                      onClick={() => setPage(Math.ceil(list.length / pageSize))}
                      disabled={page * pageSize >= list.length}
                    >
                      <span className="sr-only">Go to last page</span>
                      <ChevronsRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Create IVR dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create IVR</DialogTitle>
            <DialogDescription>
              The greeting and menu options can be configured in the builder after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="ivr-name">Name</Label>
              <Input
                id="ivr-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Main reception menu"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="ivr-ext">Extension</Label>
                <Input
                  id="ivr-ext"
                  value={form.extension}
                  onChange={(e) => setForm({ ...form, extension: e.target.value })}
                  placeholder="7001"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ivr-timeout">Timeout (seconds)</Label>
                <Input
                  id="ivr-timeout"
                  type="number"
                  value={form.timeout}
                  onChange={(e) => setForm({ ...form, timeout: Number(e.target.value) || 10 })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Greeting language</Label>
                <Select
                  value={form.greeting_language}
                  onValueChange={(v) => {
                    const firstVoice = voicesForLang(v)[0] || "";
                    setForm({
                      ...form,
                      greeting_language: v,
                      greeting_voice: firstVoice,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v.language} value={v.language}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Greeting voice</Label>
                <Select
                  value={form.greeting_voice}
                  onValueChange={(v) => setForm({ ...form, greeting_voice: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {voicesForLang(form.greeting_language).map((voice) => (
                      <SelectItem key={voice} value={voice}>
                        {voice}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="direct-dial">Allow direct extension dial</Label>
                <p className="text-xs text-muted-foreground">
                  Callers can type a 4-digit extension to skip the menu
                </p>
              </div>
              <Switch
                id="direct-dial"
                checked={form.enable_direct_dial}
                onCheckedChange={(c) => setForm({ ...form, enable_direct_dial: c })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
