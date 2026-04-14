"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { Plus, MoreHorizontal, Phone, ShoppingCart, Clock, Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { didPool, type PoolDid, type MyDidsResponse } from "@/lib/did-pool/client";
import { Textarea } from "@/components/ui/textarea";
import { dids, users, queues, type PbxUser, type PbxQueue } from "@/lib/pbx/client";

export default function DidsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [tab, setTab] = useState<"my" | "buy">("my");
  const [loading, setLoading] = useState(true);

  // My numbers
  const [myData, setMyData] = useState<MyDidsResponse>({ assigned: [], pending: [] });
  const [userList, setUserList] = useState<PbxUser[]>([]);
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);

  // Available pool
  const [available, setAvailable] = useState<PoolDid[]>([]);
  const [requesting, setRequesting] = useState<string | null>(null);

  // Add DID dialog (self-hosted)
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ number: "", description: "", trunk_id: "", routing_type: "extension", routing_destination: "" });
  const [trunkList, setTrunkList] = useState<{ id: string; name: string }[]>([]);

  // Edit routing dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingDid, setEditingDid] = useState<PoolDid | null>(null);
  const [editForm, setEditForm] = useState({ description: "", routing_type: "extension", routing_destination: "", status: "active" });

  useEffect(() => { loadAll(); loadTrunks(); }, [orgId]);

  async function loadTrunks() {
    try {
      const t = await import("@/lib/pbx/client").then(m => m.trunks.list());
      setTrunkList(t.map((tr: { id: string; name: string }) => ({ id: tr.id, name: tr.name })));
    } catch {}
  }

  async function handleAddDid() {
    if (!addForm.number.trim()) { showToast("Number is required", "error"); return; }
    try {
      await dids.create({
        number: addForm.number,
        description: addForm.description,
        trunk_id: addForm.trunk_id || undefined,
        routing_type: addForm.routing_type as "extension" | "queue" | "ivr" | "ai_agent" | "external" | "intercom",
        routing_destination: addForm.routing_destination,
      });
      showToast("Number added", "success");
      setAddOpen(false);
      setAddForm({ number: "", description: "", trunk_id: "", routing_type: "extension", routing_destination: "" });
      loadAll();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [my, avail, u, q] = await Promise.all([
        didPool.my(),
        didPool.available(),
        users.list(),
        queues.list(),
      ]);
      setMyData(my);
      setAvailable(avail);
      setUserList(u);
      setQueueList(q);
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setLoading(false);
  }

  async function handleRequest(id: string) {
    setRequesting(id);
    try {
      await didPool.request(id);
      showToast("Number requested — awaiting admin approval", "success");
      loadAll();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setRequesting(null);
  }

  async function handleCancelRequest(id: string) {
    try {
      await didPool.cancelRequest(id);
      showToast("Request cancelled", "success");
      loadAll();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  function openEdit(did: PoolDid) {
    setEditingDid(did);
    setEditForm({
      description: did.description || "",
      routing_type: did.routing_type || "extension",
      routing_destination: did.routing_destination || "",
      status: did.status || "active",
    });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editingDid) return;
    try {
      await dids.update(editingDid.id, {
        description: editForm.description,
        routing_type: editForm.routing_type as "extension" | "queue" | "ivr" | "ai_agent" | "intercom" | "external",
        routing_destination: editForm.routing_destination,
        status: editForm.status as "active" | "inactive",
      });
      showToast("Routing updated", "success");
      setEditOpen(false);
      loadAll();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  function DestinationField({ routingType, value, onChange }: { routingType: string; value: string; onChange: (v: string) => void }) {
    if (routingType === "extension") {
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Select extension" /></SelectTrigger>
          <SelectContent>
            {userList.filter(u => u.status === "active").map((u) => (
              <SelectItem key={u.id} value={u.extension}>{u.extension} — {u.full_name || u.username}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (routingType === "queue") {
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger><SelectValue placeholder="Select queue" /></SelectTrigger>
          <SelectContent>
            {queueList.filter(q => q.status === "active").map((q) => (
              <SelectItem key={q.id} value={q.number}>{q.number} — {q.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={routingType === "external" ? "+919944421125" : routingType === "ai_agent" ? "wss://bot.example.com" : "Destination"} />
    );
  }

  function formatNumber(num: string) {
    const clean = num.replace(/[^0-9]/g, "");
    if (clean.length === 12 && clean.startsWith("91")) {
      return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
    }
    return num;
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">DID Numbers</h1>
          <p className="text-sm text-muted-foreground">Manage your phone numbers and buy new ones</p>
        </div>
        <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add Number</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Active Numbers</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{myData.assigned.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pending Requests</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{myData.pending.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Available to Buy</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{available.length}</p></CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as "my" | "buy")}>
        <TabsList>
          <TabsTrigger value="my">
            <Phone className="h-4 w-4 mr-1.5" /> My Numbers
            {myData.pending.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px]">{myData.pending.length} pending</Badge>}
          </TabsTrigger>
          <TabsTrigger value="buy">
            <ShoppingCart className="h-4 w-4 mr-1.5" /> Buy a Number
            <Badge variant="secondary" className="ml-1.5 text-[10px]">{available.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── MY NUMBERS TAB ── */}
        <TabsContent value="my" className="space-y-4">
          {/* Pending requests */}
          {myData.pending.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Pending Approval</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {myData.pending.map(d => (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono">{formatNumber(d.number)}</TableCell>
                        <TableCell>{d.region || "—"}</TableCell>
                        <TableCell>{d.provider || "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{d.requested_at ? format(new Date(d.requested_at), "dd MMM yyyy HH:mm") : "—"}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleCancelRequest(d.id)}>Cancel</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Assigned numbers */}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Routing</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : myData.assigned.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No numbers assigned. Go to "Buy a Number" to get started.</TableCell></TableRow>
                ) : myData.assigned.map(did => (
                  <TableRow key={did.id}>
                    <TableCell className="font-mono text-sm">{formatNumber(did.number)}</TableCell>
                    <TableCell>{did.description || "—"}</TableCell>
                    <TableCell>
                      {did.routing_type ? <Badge variant="outline" className="text-xs capitalize">{did.routing_type}</Badge> : <Badge variant="secondary" className="text-xs">Not configured</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-sm max-w-[200px] truncate">{did.routing_destination || "—"}</TableCell>
                    <TableCell><Badge variant={did.status === "active" ? "default" : "secondary"} className="text-xs">{did.status}</Badge></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(did)}>Configure Routing</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* ── BUY A NUMBER TAB ── */}
        <TabsContent value="buy">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Price/mo</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : available.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No numbers available right now</TableCell></TableRow>
                ) : (() => {
                  const lowestPrice = Math.min(...available.filter(d => d.monthly_price).map(d => Number(d.monthly_price)));
                  return available.map(did => {
                    const isLowest = Number(did.monthly_price) === lowestPrice;
                    return (
                      <TableRow key={did.id} className={isLowest ? "bg-primary/5" : ""}>
                        <TableCell className="font-mono text-sm font-medium">{formatNumber(did.number)}</TableCell>
                        <TableCell className={isLowest ? "font-semibold" : ""}>
                          {did.monthly_price ? `₹${Number(did.monthly_price).toLocaleString()}/mo` : "—"}
                          {isLowest && <Badge variant="default" className="ml-2 text-[10px]">Best Value</Badge>}
                        </TableCell>
                        <TableCell>{did.region || "—"}</TableCell>
                        <TableCell>{did.provider || "—"}</TableCell>
                        <TableCell>
                          <Button size="sm" disabled={requesting === did.id} onClick={() => handleRequest(did.id)}>
                            {requesting === did.id ? "Requesting..." : "Request"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  });
                })()}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Number Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Phone Number</DialogTitle>
            <DialogDescription>Add a DID from your SIP trunk</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Phone Number *</Label><Input value={addForm.number} onChange={e => setAddForm({ ...addForm, number: e.target.value })} placeholder="+918065978015" /></div>
              <div className="space-y-1.5"><Label>Description</Label><Input value={addForm.description} onChange={e => setAddForm({ ...addForm, description: e.target.value })} placeholder="Main line" /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Trunk</Label>
              <Select value={addForm.trunk_id} onValueChange={v => setAddForm({ ...addForm, trunk_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select trunk" /></SelectTrigger>
                <SelectContent>
                  {trunkList.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Routing Type</Label>
                <Select value={addForm.routing_type} onValueChange={v => setAddForm({ ...addForm, routing_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extension">Extension</SelectItem>
                    <SelectItem value="queue">Queue</SelectItem>
                    <SelectItem value="ivr">IVR</SelectItem>
                    <SelectItem value="ai_agent">AI Agent</SelectItem>
                    <SelectItem value="external">External</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Destination</Label>
                <DestinationField routingType={addForm.routing_type} value={addForm.routing_destination} onChange={v => setAddForm({ ...addForm, routing_destination: v })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddDid}>Add Number</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Routing Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure — {editingDid ? formatNumber(editingDid.number) : ""}</DialogTitle>
            <DialogDescription>Set up how calls to this number are routed</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Main reception line" />
            </div>
            <div className="space-y-1.5">
              <Label>Routing Type</Label>
              <Select value={editForm.routing_type} onValueChange={(v) => setEditForm({ ...editForm, routing_type: v, routing_destination: "" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="extension">Extension</SelectItem>
                  <SelectItem value="queue">Queue</SelectItem>
                  <SelectItem value="external">External Number</SelectItem>
                  <SelectItem value="ai_agent">AI Agent (WSS)</SelectItem>
                  <SelectItem value="ivr">IVR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Destination</Label>
              <DestinationField routingType={editForm.routing_type} value={editForm.routing_destination} onChange={(v) => setEditForm({ ...editForm, routing_destination: v })} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={!editForm.routing_destination}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
