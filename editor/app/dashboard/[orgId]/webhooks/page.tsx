"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, MoreHorizontal, Copy, Eye, EyeOff, Key } from "lucide-react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { apiKeys, type ApiKey } from "@/lib/workflow/client";

const PBX_BASE = "/api/pbx";

interface PbxApiKey {
  id: string;
  name: string;
  api_key: string;
  api_secret?: string;
  permissions: string[];
  status: string;
  last_used_at: string | null;
  created_by: string | null;
  createdAt: string;
}

const ALL_PERMISSIONS = [
  { id: "calls.read", label: "Read call logs" },
  { id: "calls.write", label: "Manage calls" },
  { id: "calls.click_to_call", label: "Click to call" },
  { id: "calls.originate_ai", label: "Originate to AI" },
  { id: "calls.recording", label: "Call recording" },
  { id: "calls.live", label: "Live calls" },
  { id: "calls.transfer", label: "Transfer calls" },
  { id: "calls.hangup", label: "Hangup calls" },
  { id: "calls.hold", label: "Hold/unhold calls" },
];

const API_ENDPOINTS = [
  { method: "GET", path: "/calls", desc: "List call logs", perm: "calls.read" },
  { method: "GET", path: "/calls/live", desc: "Get live active calls", perm: "calls.live" },
  { method: "GET", path: "/calls/count", desc: "Get call count and statistics", perm: "calls.read" },
  { method: "GET", path: "/calls/channels", desc: "Get active channels with details", perm: "calls.live" },
  { method: "GET", path: "/calls/{callId}/recording", desc: "Download call recording", perm: "calls.recording" },
  { method: "POST", path: "/calls/click-to-call", desc: "Initiate click-to-call between two parties", perm: "calls.click_to_call" },
  { method: "POST", path: "/calls/originate-to-ai", desc: "Originate call and connect to AI agent", perm: "calls.originate_ai" },
  { method: "POST", path: "/calls/{channelId}/hangup", desc: "Hang up an active call", perm: "calls.hangup" },
  { method: "POST", path: "/calls/{channelId}/hold", desc: "Put a call on hold", perm: "calls.hold" },
  { method: "POST", path: "/calls/{channelId}/unhold", desc: "Resume a call from hold", perm: "calls.hold" },
  { method: "POST", path: "/calls/{channelId}/transfer", desc: "Transfer an active call", perm: "calls.transfer" },
];

export default function WebhooksPage() {
  const { orgId } = useParams<{ orgId: string }>();

  // Workflow API keys (existing)
  const [wfKeys, setWfKeys] = useState<ApiKey[]>([]);
  const [wfLoading, setWfLoading] = useState(true);
  const [wfCreateOpen, setWfCreateOpen] = useState(false);
  const [wfKeyName, setWfKeyName] = useState("");

  // PBX API keys (new)
  const [pbxKeys, setPbxKeys] = useState<PbxApiKey[]>([]);
  const [pbxLoading, setPbxLoading] = useState(true);
  const [pbxCreateOpen, setPbxCreateOpen] = useState(false);
  const [pbxKeyName, setPbxKeyName] = useState("");
  const [pbxPerms, setPbxPerms] = useState<string[]>(ALL_PERMISSIONS.map(p => p.id));
  const [newPbxSecret, setNewPbxSecret] = useState<string | null>(null);

  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  useEffect(() => { loadWfKeys(); loadPbxKeys(); }, [orgId]);

  // ── Workflow keys ──
  async function loadWfKeys() {
    try { setWfLoading(true); setWfKeys(await apiKeys.list(orgId)); } catch {} finally { setWfLoading(false); }
  }
  async function handleWfCreate() {
    try {
      await apiKeys.create(orgId, wfKeyName || "Default");
      showToast("Workflow key created", "success");
      setWfCreateOpen(false); setWfKeyName(""); loadWfKeys();
    } catch (e) { showToast((e as Error).message, "error"); }
  }
  async function handleWfToggle(k: ApiKey) {
    try { await apiKeys.update(k.id, { is_active: !k.is_active }); loadWfKeys(); } catch {}
  }
  async function handleWfDelete(id: string) {
    try { await apiKeys.delete(id); showToast("Deleted", "success"); loadWfKeys(); } catch {}
  }

  // ── PBX API keys ──
  function pbxHeaders() {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const t = typeof window !== "undefined" ? localStorage.getItem("pbx_org_token") || "" : "";
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  }

  async function loadPbxKeys() {
    try {
      setPbxLoading(true);
      const res = await fetch(`${PBX_BASE}/api-keys`, { headers: pbxHeaders() });
      if (res.ok) { const data = await res.json(); setPbxKeys(data.keys || []); }
    } catch {} finally { setPbxLoading(false); }
  }

  async function handlePbxCreate() {
    try {
      const res = await fetch(`${PBX_BASE}/api-keys`, {
        method: "POST", headers: pbxHeaders(),
        body: JSON.stringify({ name: pbxKeyName || "Default", permissions: pbxPerms }),
      });
      if (!res.ok) { const d = await res.json(); showToast(d.error, "error"); return; }
      const data = await res.json();
      setNewPbxSecret(data.api_secret);
      showToast("API key created — save the secret now!", "success");
      setPbxCreateOpen(false); setPbxKeyName(""); loadPbxKeys();
    } catch (e) { showToast((e as Error).message, "error"); }
  }

  async function handlePbxRevoke(id: string) {
    try {
      await fetch(`${PBX_BASE}/api-keys/${id}`, { method: "DELETE", headers: pbxHeaders() });
      showToast("API key revoked", "success"); loadPbxKeys();
    } catch {}
  }

  function toggleReveal(id: string) {
    setRevealedKeys(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function maskKey(key: string) { return key.slice(0, 8) + "••••••••" + key.slice(-4); }
  function copyKey(key: string) { navigator.clipboard.writeText(key); showToast("Copied", "success"); }

  const methodColor: Record<string, string> = { GET: "secondary", POST: "default" };

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API & Webhooks</h1>
        <p className="text-sm text-muted-foreground">Manage API keys and integrations</p>
      </div>

      <Tabs defaultValue="api-keys">
        <TabsList>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="workflow-keys">Workflow Keys</TabsTrigger>
          <TabsTrigger value="reference">API Reference</TabsTrigger>
        </TabsList>

        {/* ── API Keys Tab ── */}
        <TabsContent value="api-keys" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">API keys for call management, click-to-call, and AI origination</p>
            <Button size="sm" onClick={() => setPbxCreateOpen(true)}><Plus className="h-4 w-4 mr-1" /> Create API Key</Button>
          </div>

          {/* Show secret banner if just created */}
          {newPbxSecret && (
            <Card className="border-primary">
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-medium">Save your API secret — it won't be shown again</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-muted p-2 rounded break-all">{newPbxSecret}</code>
                  <Button variant="outline" size="sm" onClick={() => { copyKey(newPbxSecret); }}><Copy className="h-4 w-4" /></Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setNewPbxSecret(null)}>Dismiss</Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>API Key</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pbxLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : pbxKeys.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No API keys yet. Create one to start integrating.</TableCell></TableRow>
                ) : pbxKeys.map(k => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium text-sm">{k.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono text-muted-foreground">{revealedKeys.has(k.id) ? k.api_key : maskKey(k.api_key)}</code>
                        <button onClick={() => toggleReveal(k.id)} className="text-muted-foreground hover:text-foreground"><Eye className="h-3.5 w-3.5" /></button>
                        <button onClick={() => copyKey(k.api_key)} className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="secondary" className="text-[10px]">{(k.permissions || []).length} perms</Badge></TableCell>
                    <TableCell><Badge variant={k.status === "active" ? "default" : "secondary"} className="text-xs">{k.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{k.last_used_at ? format(new Date(k.last_used_at), "MMM d, h:mm a") : "Never"}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="text-destructive" onClick={() => handlePbxRevoke(k.id)}>Revoke</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Usage examples */}
          <Card>
            <CardHeader><CardTitle className="text-base">Usage</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Click to Call</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST http://localhost:8000/api/v1/calls/click-to-call \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ak_your_key_here" \\
  -d '{
    "from": "1001",
    "to": "+919944421125",
    "caller_id": "+918065978005"
  }'`}</pre>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Originate to AI Agent (call extension)</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST http://localhost:8000/api/v1/calls/originate-to-ai \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ak_your_key_here" \\
  -d '{
    "to": "2001",
    "caller_id": "AI Assistant",
    "wss_url": "wss://ai.example.com/voice/stream"
  }'`}</pre>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Originate to AI Agent (external number + OpenAI)</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST http://localhost:8000/api/v1/calls/originate-to-ai \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ak_your_key_here" \\
  -d '{
    "to": "+919944421125",
    "caller_id": "Support Bot",
    "ai_agent_app": "ai_agent",
    "wss_url": "wss://api.openai.com/v1/realtime",
    "timeout": 45,
    "variables": {
      "CAMPAIGN_ID": "summer2024",
      "LANGUAGE": "en-US"
    }
  }'`}</pre>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Get Call Logs</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl http://localhost:8000/api/v1/calls \\
  -H "X-API-Key: ak_your_key_here"`}</pre>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Get Live Calls</p>
                <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl http://localhost:8000/api/v1/calls/live \\
  -H "X-API-Key: ak_your_key_here"`}</pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Workflow Keys Tab ── */}
        <TabsContent value="workflow-keys" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Keys for triggering workflows via HTTP</p>
            <Dialog open={wfCreateOpen} onOpenChange={setWfCreateOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Create Key</Button></DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Create Workflow Key</DialogTitle><DialogDescription>Required to trigger workflows via HTTP</DialogDescription></DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1.5"><Label>Name</Label><Input value={wfKeyName} onChange={e => setWfKeyName(e.target.value)} placeholder="PMS Integration..." /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setWfCreateOpen(false)}>Cancel</Button>
                  <Button onClick={handleWfCreate}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wfLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : wfKeys.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No workflow keys</TableCell></TableRow>
                ) : wfKeys.map(k => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium text-sm">{k.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono text-muted-foreground">{revealedKeys.has(k.id) ? k.key : maskKey(k.key)}</code>
                        <button onClick={() => toggleReveal(k.id)} className="text-muted-foreground hover:text-foreground">{revealedKeys.has(k.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                        <button onClick={() => copyKey(k.key)} className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={k.is_active ? "default" : "secondary"} className="text-xs">{k.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{k.last_used_at ? format(new Date(k.last_used_at), "MMM d, h:mm a") : "Never"}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleWfToggle(k)}>{k.is_active ? "Deactivate" : "Activate"}</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => handleWfDelete(k.id)}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-medium">Usage</p>
              <p className="text-xs text-muted-foreground">Include the key when triggering workflows:</p>
              <pre className="text-xs font-mono bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : "http://localhost:3001"}/api/workflow/trigger/{workflow_id} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wfk_your_key_here" \\
  -d '{"name": "John", "phone": "9944421125"}'`}</pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── API Reference Tab ── */}
        <TabsContent value="reference" className="space-y-4">
          <p className="text-sm text-muted-foreground">All available API endpoints. Authenticate with <code className="text-xs bg-muted px-1 py-0.5 rounded">X-API-Key: ak_your_key</code></p>

          <Card>
            <CardHeader><CardTitle className="text-base">Call Management</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Method</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-32">Permission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {API_ENDPOINTS.map((ep, i) => (
                    <TableRow key={i}>
                      <TableCell><Badge variant={methodColor[ep.method] as "default" | "secondary" || "default"} className="text-xs font-mono">{ep.method}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/api/v1{ep.path}</TableCell>
                      <TableCell className="text-sm">{ep.desc}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{ep.perm}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Authentication</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">All requests require an API key in the header:</p>
              <pre className="text-xs font-mono bg-muted rounded-lg p-3">{`X-API-Key: ak_your_api_key_here`}</pre>
              <p className="text-sm text-muted-foreground">API keys are scoped to your organisation. You can only access your own DIDs, calls, and recordings.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* PBX Create Key Dialog */}
      <Dialog open={pbxCreateOpen} onOpenChange={setPbxCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create API Key</DialogTitle><DialogDescription>Generate a key for call management integrations</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Key Name</Label>
              <Input value={pbxKeyName} onChange={e => setPbxKeyName(e.target.value)} placeholder="CRM Integration, IVR System..." />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_PERMISSIONS.map(p => (
                  <div key={p.id} className="flex items-center gap-2">
                    <Checkbox checked={pbxPerms.includes(p.id)} onCheckedChange={c => {
                      setPbxPerms(prev => c ? [...prev, p.id] : prev.filter(x => x !== p.id));
                    }} id={p.id} />
                    <Label htmlFor={p.id} className="text-xs">{p.label}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPbxCreateOpen(false)}>Cancel</Button>
            <Button onClick={handlePbxCreate}>Create Key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
