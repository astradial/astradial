"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, MoreHorizontal, Eye, EyeOff, Copy } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/Toast";
import {
  trunks,
  customerTunnels,
  type PbxTrunk,
  type PbxCustomerTunnel,
  type PbxCustomerTunnelStatus,
  type PbxCustomerTunnelConfig,
  type PbxCustomerTunnelMetric,
} from "@/lib/pbx/client";

// Live trunk status from Asterisk (`pjsip show contacts` / `show registrations`),
// returned by the API as `live_status: { status, rtt_ms, source }`. Falls back
// to the persisted `registration_status` column only if the live query failed.
const liveStatusVariant: Record<string, "default" | "secondary" | "destructive"> = {
  reachable: "default",
  registered: "default",
  unreachable: "destructive",
  failed: "destructive",
  nonqual: "secondary",
  unregistered: "secondary",
};
const liveStatusLabel: Record<string, string> = {
  reachable: "Reachable",
  unreachable: "Unreachable",
  registered: "Registered",
  failed: "Failed",
  nonqual: "Not qualified",
  unregistered: "Not registered",
};

// ─── Helpers (Network Tunnels) ───

function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`;
}

function formatAgoFromSeconds(secs: number | null | undefined): string {
  if (secs == null) return "never";
  if (secs < 5) return "just now";
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatAgo(date: string | Date | null | undefined): string {
  if (!date) return "never";
  const t = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  if (!Number.isFinite(t)) return "never";
  const secs = Math.max(0, (Date.now() - t) / 1000);
  return formatAgoFromSeconds(secs);
}

const tunnelStatusClass: Record<PbxCustomerTunnel["status"], string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  disabled: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  revoked: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

// Pull "PresharedKey = <value>" out of a wg-quick [Peer] block. Returns null
// if the config doesn't include one (peer was created without a PSK on the
// server, or the field name differs).
function extractPresharedKey(peerConfig: string): string | null {
  const m = peerConfig.match(/^\s*PresharedKey\s*=\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

export default function TrunksPage() {
  // ─── SIP Trunks state (unchanged) ───
  const [trunkList, setTrunkList] = useState<PbxTrunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingTrunk, setEditingTrunk] = useState<PbxTrunk | null>(null);
  const [credsOpen, setCredsOpen] = useState(false);
  const [credsTrunk, setCredsTrunk] = useState<PbxTrunk | null>(null);
  const [showPwInForm, setShowPwInForm] = useState(false);
  const [showPwInCreds, setShowPwInCreds] = useState(false);
  const isAdmin = typeof window !== "undefined" && !!localStorage.getItem("gateway_admin_key");
  const [form, setForm] = useState({ name: "", host: "", port: "5060", username: "", password: "", transport: "udp", trunk_type: "outbound", max_channels: "10" });
  const [editForm, setEditForm] = useState({ name: "", host: "", port: "5060", transport: "udp", trunk_type: "outbound", max_channels: "10", status: "active" });

  useEffect(() => { loadTrunks(); }, []);

  async function loadTrunks() {
    try { setLoading(true); setTrunkList(await trunks.list()); }
    catch (e) { showToast(e instanceof Error ? e.message : "Failed to load", "error"); }
    finally { setLoading(false); }
  }

  function generatePassword() {
    const bytes = new Uint8Array(16);
    (typeof window !== "undefined" ? window.crypto : crypto).getRandomValues(bytes);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    setForm((f) => ({ ...f, password: hex }));
    setShowPwInForm(true);
  }

  async function handleCreate() {
    if ((form.trunk_type === "inbound" || form.trunk_type === "outbound") && (!form.username || !form.password)) {
      showToast("Username and password are required for inbound and outbound trunks", "error");
      return;
    }
    try {
      const created = await trunks.create({
        name: form.name,
        host: form.host || undefined,
        port: parseInt(form.port),
        username: form.username,
        password: form.password,
        transport: form.transport as PbxTrunk["transport"],
        trunk_type: form.trunk_type as PbxTrunk["trunk_type"],
        max_channels: parseInt(form.max_channels),
      });
      setCreateOpen(false);
      setForm({ name: "", host: "", port: "5060", username: "", password: "", transport: "udp", trunk_type: "outbound", max_channels: "10" });
      setShowPwInForm(false);
      await loadTrunks();
      setCredsTrunk(created);
      setShowPwInCreds(false);
      setCredsOpen(true);
      showToast("Trunk created", "success");
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed to create", "error"); }
  }

  async function viewCredentials(t: PbxTrunk) {
    try {
      const full = await trunks.get(t.id);
      setCredsTrunk(full);
      setShowPwInCreds(false);
      setCredsOpen(true);
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed to load credentials", "error"); }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => showToast(`${label} copied`, "success"),
      () => showToast(`Failed to copy ${label.toLowerCase()}`, "error"),
    );
  }

  function openEdit(t: PbxTrunk) {
    setEditingTrunk(t);
    setEditForm({ name: t.name, host: t.host, port: String(t.port), transport: t.transport, trunk_type: t.trunk_type, max_channels: String(t.max_channels), status: t.status });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editingTrunk) return;
    try {
      await trunks.update(editingTrunk.id, { name: editForm.name, host: editForm.host, port: parseInt(editForm.port), transport: editForm.transport as PbxTrunk["transport"], trunk_type: editForm.trunk_type as PbxTrunk["trunk_type"], max_channels: parseInt(editForm.max_channels), status: editForm.status as PbxTrunk["status"] });
      showToast("Trunk updated", "success");
      setEditOpen(false);
      await loadTrunks();
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this trunk?")) return;
    try { await trunks.delete(id); showToast("Trunk deleted", "success"); await loadTrunks(); }
    catch (e) { showToast(e instanceof Error ? e.message : "Failed to delete", "error"); }
  }

  return (
    <div className="p-3 md:p-6 space-y-10">
      {/* ─── SIP Trunks Section ─── */}
      <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SIP Trunks</h1>
          <p className="text-sm text-muted-foreground">Manage SIP trunk connections to carriers</p>
        </div>
        {isAdmin && <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1.5" />Add Trunk</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Create Trunk</DialogTitle><DialogDescription>Connect a SIP carrier</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Tata SIP" /></div>
                <div className="space-y-1.5"><Label>Host</Label><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="sip.provider.com" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label>Port</Label><Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Transport</Label>
                  <Select value={form.transport} onValueChange={(v) => setForm({ ...form, transport: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="udp">UDP</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="tls">TLS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Type</Label>
                  <Select value={form.trunk_type} onValueChange={(v) => setForm({ ...form, trunk_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inbound">Inbound</SelectItem>
                      <SelectItem value="outbound">Outbound</SelectItem>
                      <SelectItem value="peer2peer">Peer-to-Peer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Username{form.trunk_type !== "peer2peer" && <span className="text-destructive ml-0.5">*</span>}</Label>
                  <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={form.trunk_type === "peer2peer" ? "Optional" : "Required"} />
                </div>
                <div className="space-y-1.5"><Label>Max Channels</Label><Input type="number" value={form.max_channels} onChange={(e) => setForm({ ...form, max_channels: e.target.value })} /></div>
              </div>
              {form.trunk_type !== "peer2peer" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Password<span className="text-destructive ml-0.5">*</span></Label>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={generatePassword}>Generate</Button>
                  </div>
                  <div className="relative">
                    <Input
                      type={showPwInForm ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="Required for inbound/outbound"
                      className="pr-9 font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                      onClick={() => setShowPwInForm((v) => !v)}
                      aria-label={showPwInForm ? "Hide password" : "Show password"}
                    >
                      {showPwInForm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {form.trunk_type === "inbound"
                      ? "Remote PBX uses these credentials to register to our cloud."
                      : "We use these credentials to register to the carrier."}
                    {" "}You will see this password again from the row menu &rarr; View credentials.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCreateOpen(false); setShowPwInForm(false); }}>Cancel</Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>}
      </div>

      <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-2">
        <div className="overflow-auto flex-1 relative">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
              <TableRow className="border-b-border/50 hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Transport</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Registration</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="w-16"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
            {loading ? (
              <TableSkeleton cols={8} />
            ) : trunkList.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No trunks configured</TableCell></TableRow>
            ) : trunkList.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="font-mono text-sm">{t.host}:{t.port}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs capitalize">{t.trunk_type}</Badge></TableCell>
                <TableCell className="text-sm uppercase">{t.transport}</TableCell>
                <TableCell className="text-sm">{t.max_channels}</TableCell>
                <TableCell>
                  {(() => {
                    // Prefer live status from Asterisk; fall back to persisted column.
                    const live = (t as PbxTrunk & { live_status?: { status: string; rtt_ms: number | null } }).live_status;
                    const key = live?.status || t.registration_status || "unknown";
                    const label = liveStatusLabel[key] || (key === "unknown" ? "Unknown" : key);
                    const variant = liveStatusVariant[key] || "secondary";
                    return (
                      <Badge
                        variant={variant}
                        className="text-xs"
                        title={live?.rtt_ms != null ? `RTT ${live.rtt_ms} ms` : undefined}
                      >
                        {label}
                      </Badge>
                    );
                  })()}
                </TableCell>
                <TableCell><Badge variant={t.status === "active" ? "default" : "secondary"} className="text-xs">{t.status}</Badge></TableCell>
                {isAdmin && <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(t)}>Edit</DropdownMenuItem>
                      {t.trunk_type !== "peer2peer" && (
                        <DropdownMenuItem onClick={() => viewCredentials(t)}>View credentials</DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(t.id)}>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Edit Trunk Dialog — admin only */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Trunk — {editingTrunk?.name}</DialogTitle>
            <DialogDescription>Update trunk configuration and channel limits</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Host</Label><Input value={editForm.host} onChange={(e) => setEditForm({ ...editForm, host: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Port</Label><Input value={editForm.port} onChange={(e) => setEditForm({ ...editForm, port: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Transport</Label>
                <Select value={editForm.transport} onValueChange={(v) => setEditForm({ ...editForm, transport: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="tls">TLS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Type</Label>
                <Select value={editForm.trunk_type} onValueChange={(v) => setEditForm({ ...editForm, trunk_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inbound">Inbound</SelectItem>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="peer2peer">Peer-to-Peer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Max Channels (concurrent calls)</Label>
                <Input type="number" value={editForm.max_channels} onChange={(e) => setEditForm({ ...editForm, max_channels: e.target.value })} />
                <p className="text-[10px] text-muted-foreground">Limits simultaneous calls on this trunk</p>
              </div>
              <div className="space-y-1.5"><Label>Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trunk Credentials Dialog — show after create or via row menu */}
      <Dialog open={credsOpen} onOpenChange={setCredsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Trunk credentials — {credsTrunk?.name}</DialogTitle>
            <DialogDescription>
              Paste these into your remote PBX (e.g. Grandstream UCM, FreePBX) to register against this trunk.
            </DialogDescription>
          </DialogHeader>
          {credsTrunk && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-[110px_1fr_auto] items-center gap-2">
                <span className="text-muted-foreground">Server</span>
                <code className="font-mono break-all">{credsTrunk.host || "sip.example.com"}</code>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyToClipboard(credsTrunk.host || "sip.example.com", "Server")}><Copy className="h-3.5 w-3.5" /></Button>

                <span className="text-muted-foreground">Port</span>
                <code className="font-mono">{credsTrunk.port}</code>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyToClipboard(String(credsTrunk.port), "Port")}><Copy className="h-3.5 w-3.5" /></Button>

                <span className="text-muted-foreground">Transport</span>
                <code className="font-mono uppercase">{credsTrunk.transport}</code>
                <span />

                <span className="text-muted-foreground">Username</span>
                <code className="font-mono break-all">{credsTrunk.username}</code>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyToClipboard(credsTrunk.username, "Username")}><Copy className="h-3.5 w-3.5" /></Button>

                <span className="text-muted-foreground">Password</span>
                <code className="font-mono break-all">
                  {showPwInCreds ? (credsTrunk.password ?? "—") : "•".repeat(Math.min(credsTrunk.password?.length ?? 12, 24))}
                </code>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowPwInCreds((v) => !v)} aria-label={showPwInCreds ? "Hide password" : "Show password"}>
                    {showPwInCreds ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={!credsTrunk.password} onClick={() => credsTrunk.password && copyToClipboard(credsTrunk.password, "Password")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Treat the password like any other secret. It is stored on the cloud Asterisk so the registering PBX can authenticate.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCredsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </section>

      {/* ─── Network Tunnels Section ─── */}
      <NetworkTunnelsSection isAdmin={isAdmin} copyToClipboard={copyToClipboard} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Network Tunnels (WireGuard)
// ─────────────────────────────────────────────────────────────────────────────

interface FieldError { field: string; message: string }

function NetworkTunnelsSection({
  isAdmin,
  copyToClipboard,
}: {
  isAdmin: boolean;
  copyToClipboard: (text: string, label: string) => void;
}) {
  const [tunnels, setTunnels] = useState<PbxCustomerTunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusById, setStatusById] = useState<Record<string, PbxCustomerTunnelStatus>>({});

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", customer_pubkey: "", customer_lan_cidr: "", notes: "" });
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  // Customer config dialog
  const [configOpen, setConfigOpen] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configData, setConfigData] = useState<PbxCustomerTunnelConfig | null>(null);
  const [configTunnelName, setConfigTunnelName] = useState<string>("");
  const [showPsk, setShowPsk] = useState(false);

  // Metrics dialog
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsData, setMetricsData] = useState<PbxCustomerTunnelMetric[]>([]);
  const [metricsTunnelName, setMetricsTunnelName] = useState<string>("");

  // Edit dialog (post-create — for fields the PATCH endpoint accepts:
  // notes + customer_lan_cidr; name is immutable, key fields require
  // delete+recreate)
  const [editOpen, setEditOpen] = useState(false);
  const [editTunnel, setEditTunnel] = useState<PbxCustomerTunnel | null>(null);
  const [editForm, setEditForm] = useState({ customer_lan_cidr: "", notes: "" });
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState(false);

  // ─── Load list ───
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const res = await customerTunnels.list();
        if (mounted) setTunnels(res.tunnels);
      } catch (e) {
        if (mounted) showToast(e instanceof Error ? e.message : "Failed to load tunnels", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function reloadTunnels() {
    try {
      const res = await customerTunnels.list();
      setTunnels(res.tunnels);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load tunnels", "error");
    }
  }

  // ─── Live status polling: every 10s for visible tunnels ───
  // Keep the id list stable (joined string) so the interval isn't recreated
  // on every status update.
  const tunnelIds = useMemo(() => tunnels.map((t) => t.id), [tunnels]);
  const idsKey = tunnelIds.join(",");
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    if (tunnelIds.length === 0) return;

    let cancelled = false;
    async function pollAll() {
      try {
        const results = await Promise.allSettled(
          tunnelIds.map((id) => customerTunnels.status(id)),
        );
        if (cancelled || unmountedRef.current) return;
        setStatusById((prev) => {
          const next = { ...prev };
          results.forEach((r, i) => {
            if (r.status === "fulfilled") next[tunnelIds[i]] = r.value.status;
          });
          return next;
        });
      } catch {
        // swallow — individual settled results already handled above
      }
    }

    pollAll();
    const interval = setInterval(pollAll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    return () => { unmountedRef.current = true; };
  }, []);

  // ─── Actions ───
  function resetCreateForm() {
    setCreateForm({ name: "", customer_pubkey: "", customer_lan_cidr: "", notes: "" });
    setCreateErrors({});
  }

  async function handleCreate() {
    setCreateErrors({});
    if (!createForm.name.trim()) {
      setCreateErrors({ name: "Name is required" });
      return;
    }
    if (!createForm.customer_pubkey.trim()) {
      setCreateErrors({ customer_pubkey: "Customer public key is required" });
      return;
    }
    setCreating(true);
    try {
      const body: { name: string; customer_pubkey: string; customer_lan_cidr?: string; notes?: string } = {
        name: createForm.name.trim(),
        customer_pubkey: createForm.customer_pubkey.trim(),
      };
      if (createForm.customer_lan_cidr.trim()) body.customer_lan_cidr = createForm.customer_lan_cidr.trim();
      if (createForm.notes.trim()) body.notes = createForm.notes.trim();
      const res = await customerTunnels.create(body);
      setCreateOpen(false);
      resetCreateForm();
      await reloadTunnels();
      // If the server flagged route-sync warnings, surface them as a
      // distinct warning toast so the operator knows SIP from the customer
      // LAN may NOT yet route through the tunnel even though the DB / wg1
      // config landed cleanly. Otherwise show the normal success toast.
      if (res.warnings && res.warnings.length > 0) {
        showToast(`Tunnel created — but: ${res.warnings.join("; ")}`, "warning");
      } else {
        showToast("Tunnel created", "success");
      }
      // Auto-open the customer config dialog so operator can copy peer block.
      await openCustomerConfig(res.tunnel);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create";
      // Try to parse `{status}: {body}` shape from request<T>() to extract field errors.
      try {
        const colon = msg.indexOf(":");
        const payload = colon >= 0 ? msg.slice(colon + 1).trim() : msg;
        const parsed = JSON.parse(payload) as { errors?: FieldError[]; error?: string };
        if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
          const fieldErrs: Record<string, string> = {};
          for (const fe of parsed.errors) fieldErrs[fe.field] = fe.message;
          setCreateErrors(fieldErrs);
          return;
        }
        if (parsed.error) {
          showToast(parsed.error, "error");
          return;
        }
      } catch {
        // not JSON — fall through to toast
      }
      showToast(msg, "error");
    } finally {
      setCreating(false);
    }
  }

  async function openCustomerConfig(t: PbxCustomerTunnel) {
    setConfigTunnelName(t.name);
    setConfigData(null);
    setShowPsk(false);
    setConfigOpen(true);
    setConfigLoading(true);
    try {
      const cfg = await customerTunnels.customerConfig(t.id);
      setConfigData(cfg);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load customer config", "error");
      setConfigOpen(false);
    } finally {
      setConfigLoading(false);
    }
  }

  async function openMetrics(t: PbxCustomerTunnel) {
    setMetricsTunnelName(t.name);
    setMetricsData([]);
    setMetricsOpen(true);
    setMetricsLoading(true);
    try {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await customerTunnels.metrics(t.id, { from });
      setMetricsData(res.metrics);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load metrics", "error");
    } finally {
      setMetricsLoading(false);
    }
  }

  async function toggleDisable(t: PbxCustomerTunnel) {
    const goingActive = t.status !== "active";
    if (!goingActive) {
      if (!confirm("Disable this tunnel? The customer's tunnel will go offline until re-enabled.")) return;
    }
    try {
      await customerTunnels.update(t.id, { status: goingActive ? "active" : "disabled" });
      showToast(goingActive ? "Tunnel enabled" : "Tunnel disabled", "success");
      await reloadTunnels();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update", "error");
    }
  }

  function openEdit(t: PbxCustomerTunnel) {
    setEditTunnel(t);
    setEditForm({
      customer_lan_cidr: t.customer_lan_cidr || "",
      notes: t.notes || "",
    });
    setEditErrors({});
    setEditOpen(true);
  }

  async function handleEditSave() {
    if (!editTunnel) return;
    setEditErrors({});
    setEditSaving(true);
    try {
      // PATCH body: only send fields that changed (so we don't trigger
      // unnecessary applier re-runs when only notes change).
      const body: { customer_lan_cidr?: string | null; notes?: string } = {};
      const trimmedLan = editForm.customer_lan_cidr.trim();
      const prevLan = editTunnel.customer_lan_cidr || "";
      if (trimmedLan !== prevLan) {
        body.customer_lan_cidr = trimmedLan === "" ? null : trimmedLan;
      }
      const trimmedNotes = editForm.notes.trim();
      const prevNotes = editTunnel.notes || "";
      if (trimmedNotes !== prevNotes) {
        body.notes = trimmedNotes;
      }
      if (Object.keys(body).length === 0) {
        setEditOpen(false);
        return;
      }
      const res = await customerTunnels.update(editTunnel.id, body);
      setEditOpen(false);
      await reloadTunnels();
      if (res.warnings && res.warnings.length > 0) {
        showToast(`Tunnel updated — but: ${res.warnings.join("; ")}`, "warning");
      } else {
        showToast("Tunnel updated", "success");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update";
      try {
        const colon = msg.indexOf(":");
        const payload = colon >= 0 ? msg.slice(colon + 1).trim() : msg;
        const parsed = JSON.parse(payload) as { errors?: FieldError[]; error?: string };
        if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
          const fieldErrs: Record<string, string> = {};
          for (const fe of parsed.errors) fieldErrs[fe.field] = fe.message;
          setEditErrors(fieldErrs);
          return;
        }
        if (parsed.error) {
          showToast(parsed.error, "error");
          return;
        }
      } catch {
        // fall through
      }
      showToast(msg, "error");
    } finally {
      setEditSaving(false);
    }
  }

  async function revokeTunnel(t: PbxCustomerTunnel) {
    if (!confirm("Revoke this tunnel permanently? This cannot be undone. The /30 subnet stays reserved for 30 days before it can be recycled.")) return;
    try {
      const res = await customerTunnels.revoke(t.id);
      if (res.warnings && res.warnings.length > 0) {
        showToast(`Tunnel revoked — but: ${res.warnings.join("; ")}`, "warning");
      } else {
        showToast("Tunnel revoked", "success");
      }
      await reloadTunnels();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to revoke", "error");
    }
  }

  // ─── Render ───
  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Network Tunnels (WireGuard)</h2>
          <p className="text-sm text-muted-foreground">
            Secure tunnels for customer PBXes — bypass CGNAT + multi-WAN issues.{" "}
            <a
              href="https://wiki.example.com/features/customer-tunnels/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Learn more &rarr;
            </a>
          </p>
        </div>
        {isAdmin && (
          <Dialog
            open={createOpen}
            onOpenChange={(o) => {
              setCreateOpen(o);
              if (!o) resetCreateForm();
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1.5" />
                Add Tunnel
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Network Tunnel</DialogTitle>
                <DialogDescription>
                  Allocate a /30 subnet and add the customer&apos;s WireGuard peer to the cloud server.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tun-name">Name</Label>
                  <Input
                    id="tun-name"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="v7-tirupathur-ucm"
                    aria-invalid={!!createErrors.name}
                  />
                  {createErrors.name && <p className="text-xs text-destructive">{createErrors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tun-pubkey">Customer WireGuard Public Key</Label>
                  <Textarea
                    id="tun-pubkey"
                    value={createForm.customer_pubkey}
                    onChange={(e) => setCreateForm({ ...createForm, customer_pubkey: e.target.value })}
                    placeholder="44-character base64 public key"
                    className="font-mono text-xs min-h-[64px]"
                    aria-invalid={!!createErrors.customer_pubkey}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    The customer&apos;s WireGuard public key — a 44-character base64 string
                    generated by their router or VPN client.
                  </p>
                  {createErrors.customer_pubkey && (
                    <p className="text-xs text-destructive">{createErrors.customer_pubkey}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tun-lan-cidr">Customer LAN CIDR (optional)</Label>
                  <Input
                    id="tun-lan-cidr"
                    value={createForm.customer_lan_cidr}
                    onChange={(e) => setCreateForm({ ...createForm, customer_lan_cidr: e.target.value })}
                    placeholder="e.g., 192.168.0.0/24"
                    className="font-mono text-xs"
                    aria-invalid={!!createErrors.customer_lan_cidr}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    The customer&apos;s internal LAN subnet. Required if devices on
                    the customer LAN (phones, PBX) need to reach Astradial through
                    the tunnel directly — without this, their source IP won&apos;t
                    pass WireGuard&apos;s cryptokey routing on the cloud side.
                    Must be RFC 1918 private space, /16-/30, no overlap with
                    reserved infra or other customers.
                  </p>
                  {createErrors.customer_lan_cidr && (
                    <p className="text-xs text-destructive">{createErrors.customer_lan_cidr}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tun-notes">Notes (optional)</Label>
                  <Textarea
                    id="tun-notes"
                    value={createForm.notes}
                    onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value.slice(0, 4000) })}
                    placeholder="Internal notes for this tunnel"
                    maxLength={4000}
                    className="min-h-[60px]"
                    aria-invalid={!!createErrors.notes}
                  />
                  {createErrors.notes && <p className="text-xs text-destructive">{createErrors.notes}</p>}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-2">
        <div className="overflow-auto flex-1 relative">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
              <TableRow className="border-b-border/50 hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Subnet</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last handshake</TableHead>
                <TableHead>Bytes (Rx / Tx)</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={7} />
              ) : tunnels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <div>No customer tunnels yet. Click + Add Tunnel to create one.</div>
                  </TableCell>
                </TableRow>
              ) : (
                tunnels.map((t) => {
                  const status = statusById[t.id];
                  // Dot: green=alive, red=missing from wg, amber=present-but-stale, gray=unknown
                  let dotClass = "bg-gray-300";
                  let dotTitle = "No live status yet";
                  if (status) {
                    if (!status.present_in_wg) {
                      dotClass = "bg-red-500";
                      dotTitle = "Not present in WireGuard interface";
                    } else if (status.alive) {
                      dotClass = "bg-green-500";
                      dotTitle = "Alive (handshake recent)";
                    } else {
                      dotClass = "bg-amber-500";
                      dotTitle = "Configured but handshake is stale";
                    }
                  }
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="font-mono text-sm">{t.tunnel_subnet}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            title={dotTitle}
                            className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
                          />
                          <Badge
                            variant="outline"
                            className={`text-xs capitalize border-transparent ${tunnelStatusClass[t.status]}`}
                          >
                            {t.status}
                          </Badge>
                          <span className="sr-only">{dotTitle}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {status
                          ? formatAgoFromSeconds(status.handshake_age_seconds)
                          : formatAgo(null)}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {status
                          ? `${formatBytes(status.bytes_received)} / ${formatBytes(status.bytes_sent)}`
                          : "— / —"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatAgo(t.created_at)}</TableCell>
                      <TableCell>
                        {isAdmin && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {t.status !== "revoked" && (
                                <DropdownMenuItem onClick={() => openEdit(t)}>
                                  Edit
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => openCustomerConfig(t)}>
                                View customer config
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openMetrics(t)}>
                                View metrics
                              </DropdownMenuItem>
                              {t.status !== "revoked" && (
                                <DropdownMenuItem onClick={() => toggleDisable(t)}>
                                  {t.status === "active" ? "Disable" : "Enable"}
                                </DropdownMenuItem>
                              )}
                              {t.status !== "revoked" && (
                                <DropdownMenuItem className="text-destructive" onClick={() => revokeTunnel(t)}>
                                  Revoke
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Customer Config Dialog */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Customer-side [Peer] block — {configTunnelName}</DialogTitle>
            <DialogDescription>
              Paste this into the customer router&apos;s WireGuard peer configuration.
            </DialogDescription>
          </DialogHeader>
          {configLoading || !configData ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-4 py-2 text-sm">
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                Pre-shared key is a credential. Share only over secure channels. Anyone with this key
                plus the customer&apos;s WireGuard private key can impersonate the customer.
              </div>

              {(() => {
                const psk = extractPresharedKey(configData.customer_peer_config);
                if (!psk) return null;
                return (
                  <div className="space-y-1.5">
                    <Label>Pre-shared key</Label>
                    <div className="flex items-center gap-2">
                      <code className="font-mono break-all flex-1 rounded border bg-muted/40 px-2 py-1 text-xs">
                        {showPsk ? psk : "•".repeat(Math.min(psk.length, 32))}
                      </code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setShowPsk((v) => !v)}
                        aria-label={showPsk ? "Hide pre-shared key" : "Show pre-shared key"}
                      >
                        {showPsk ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => copyToClipboard(psk, "Pre-shared key")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Full [Peer] block</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => copyToClipboard(configData.customer_peer_config, "[Peer] block")}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                    Copy to clipboard
                  </Button>
                </div>
                <pre className="font-mono text-xs whitespace-pre-wrap break-all rounded-md border bg-muted/40 px-3 py-2 max-h-64 overflow-auto">
                  {configData.customer_peer_config}
                </pre>
              </div>

              <div className="grid grid-cols-[140px_1fr_auto] items-center gap-2">
                <span className="text-muted-foreground">Cloud public key</span>
                <code className="font-mono break-all text-xs">{configData.cloud_public_key}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => copyToClipboard(configData.cloud_public_key, "Cloud public key")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>

                <span className="text-muted-foreground">Cloud endpoint</span>
                <code className="font-mono break-all text-xs">{configData.cloud_endpoint}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => copyToClipboard(configData.cloud_endpoint, "Cloud endpoint")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>

                <span className="text-muted-foreground">Cloud tunnel IP</span>
                <code className="font-mono break-all text-xs">{configData.cloud_tunnel_ip}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => copyToClipboard(configData.cloud_tunnel_ip, "Cloud tunnel IP")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>

                <span className="text-muted-foreground">Customer tunnel IP</span>
                <code className="font-mono break-all text-xs">{configData.customer_tunnel_ip}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => copyToClipboard(configData.customer_tunnel_ip, "Customer tunnel IP")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setConfigOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Metrics Dialog */}
      <Dialog open={metricsOpen} onOpenChange={setMetricsOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{metricsTunnelName} — last 24 hours</DialogTitle>
            <DialogDescription>
              Handshake recency and per-snapshot byte deltas. Snapshots are captured every 60 seconds.
            </DialogDescription>
          </DialogHeader>
          {metricsLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : metricsData.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No metrics yet. Snapshots are captured every 60 seconds.
            </div>
          ) : (
            <MetricsCharts data={metricsData} />
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setMetricsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tunnel Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Tunnel — {editTunnel?.name}</DialogTitle>
            <DialogDescription>
              Update the customer LAN or notes. Name and keys are immutable;
              revoke and recreate the tunnel if those need to change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-tun-lan-cidr">Customer LAN CIDR (optional)</Label>
              <Input
                id="edit-tun-lan-cidr"
                value={editForm.customer_lan_cidr}
                onChange={(e) => setEditForm({ ...editForm, customer_lan_cidr: e.target.value })}
                placeholder="e.g., 192.168.0.0/24"
                className="font-mono text-xs"
                aria-invalid={!!editErrors.customer_lan_cidr}
              />
              <p className="text-[11px] text-muted-foreground">
                Customer&apos;s internal LAN subnet. Required if devices on the
                customer LAN (phones, PBX) need to reach Astradial through the
                tunnel directly. RFC 1918 only, /16-/30, no overlap with reserved
                infra or other customers. Leave blank to clear (re-applies wg1.conf).
              </p>
              {editErrors.customer_lan_cidr && (
                <p className="text-xs text-destructive">{editErrors.customer_lan_cidr}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-tun-notes">Notes (optional)</Label>
              <Textarea
                id="edit-tun-notes"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value.slice(0, 4000) })}
                placeholder="Internal notes for this tunnel"
                maxLength={4000}
                className="min-h-[60px]"
                aria-invalid={!!editErrors.notes}
              />
              {editErrors.notes && (
                <p className="text-xs text-destructive">{editErrors.notes}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── Metrics charts ───

interface ChartPoint {
  ts: number;
  label: string;
  handshakeAgeSec: number | null;
  rxDelta: number;
  txDelta: number;
}

function MetricsCharts({ data }: { data: PbxCustomerTunnelMetric[] }) {
  const points: ChartPoint[] = useMemo(() => {
    // Server returns metrics in chronological order in `metrics`. Build per-point
    // handshake age (relative to snapshot_at) and byte deltas (vs previous point).
    return data.map((m, i) => {
      const ts = new Date(m.snapshot_at).getTime();
      const handshakeAgeSec =
        m.latest_handshake_at != null
          ? Math.max(0, (ts - new Date(m.latest_handshake_at).getTime()) / 1000)
          : null;
      const prev = i > 0 ? data[i - 1] : null;
      const rxDelta = prev ? Math.max(0, m.bytes_received - prev.bytes_received) : 0;
      const txDelta = prev ? Math.max(0, m.bytes_sent - prev.bytes_sent) : 0;
      const label = new Date(m.snapshot_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      return { ts, label, handshakeAgeSec, rxDelta, txDelta };
    });
  }, [data]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Handshake age (seconds)</div>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="tun-handshake-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                minTickGap={32}
                className="text-[10px]"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={40}
                className="text-[10px]"
                tickFormatter={(v: number) => (v >= 60 ? `${Math.round(v / 60)}m` : `${Math.round(v)}s`)}
              />
              <Tooltip
                cursor={{ stroke: "hsl(221, 83%, 53%)", strokeOpacity: 0.2 }}
                formatter={(value: number | string) => {
                  const n = typeof value === "number" ? value : Number(value);
                  return [formatAgoFromSeconds(n), "Age"];
                }}
              />
              <Area
                dataKey="handshakeAgeSec"
                type="monotone"
                stroke="hsl(221, 83%, 53%)"
                fill="url(#tun-handshake-fill)"
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Bytes per snapshot (Rx / Tx)</div>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="tun-rx-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="tun-tx-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(35, 92%, 50%)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="hsl(35, 92%, 50%)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                minTickGap={32}
                className="text-[10px]"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={56}
                className="text-[10px]"
                tickFormatter={(v: number) => formatBytes(v)}
              />
              <Tooltip
                cursor={{ stroke: "hsl(221, 83%, 53%)", strokeOpacity: 0.2 }}
                formatter={(value: number | string, name) => {
                  const n = typeof value === "number" ? value : Number(value);
                  return [formatBytes(n), name === "rxDelta" ? "Rx" : "Tx"];
                }}
              />
              <Area
                dataKey="rxDelta"
                type="monotone"
                stroke="hsl(142, 71%, 45%)"
                fill="url(#tun-rx-fill)"
              />
              <Area
                dataKey="txDelta"
                type="monotone"
                stroke="hsl(35, 92%, 50%)"
                fill="url(#tun-tx-fill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
