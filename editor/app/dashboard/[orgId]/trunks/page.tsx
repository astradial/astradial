"use client";

import { useEffect, useState } from "react";
import { Plus, MoreHorizontal, Phone, Mail } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { showToast } from "@/components/ui/Toast";
import { trunks, type PbxTrunk } from "@/lib/pbx/client";
import { PasswordInput } from "@/components/ui/password-input";

const regStatusColors: Record<string, string> = {
  registered: "default",
  unregistered: "secondary",
  failed: "destructive",
};

export default function TrunksPage() {
  const [trunkList, setTrunkList] = useState<PbxTrunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingTrunk, setEditingTrunk] = useState<PbxTrunk | null>(null);
  const isAdmin = typeof window !== "undefined" && (!!localStorage.getItem("gateway_admin_key") || localStorage.getItem("user_role") === "owner" || localStorage.getItem("user_role") === "admin");
  const [form, setForm] = useState({ name: "", host: "", port: "5060", username: "", password: "", transport: "udp", trunk_type: "outbound", max_channels: "10" });
  const [editForm, setEditForm] = useState({ name: "", host: "", port: "5060", username: "", password: "", transport: "udp", trunk_type: "outbound", max_channels: "10", status: "active" });

  useEffect(() => { loadTrunks(); }, []);

  async function loadTrunks() {
    try { setLoading(true); setTrunkList(await trunks.list()); }
    catch (e) { showToast(e instanceof Error ? e.message : "Failed to load", "error"); }
    finally { setLoading(false); }
  }

  async function handleCreate() {
    try {
      await trunks.create({ name: form.name, host: form.host, port: parseInt(form.port), username: form.username, password: form.password, transport: form.transport as PbxTrunk["transport"], trunk_type: form.trunk_type as PbxTrunk["trunk_type"], max_channels: parseInt(form.max_channels) } as Partial<PbxTrunk>);
      showToast("Trunk created", "success");
      setCreateOpen(false);
      setForm({ name: "", host: "", port: "5060", username: "", password: "", transport: "udp", trunk_type: "outbound", max_channels: "10" });
      await loadTrunks();
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed to create", "error"); }
  }

  function openEdit(t: PbxTrunk) {
    setEditingTrunk(t);
    setEditForm({ name: t.name, host: t.host, port: String(t.port), username: (t as unknown as Record<string, unknown>).username as string || "", password: "", transport: t.transport, trunk_type: t.trunk_type, max_channels: String(t.max_channels), status: t.status });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editingTrunk) return;
    try {
      const updateData: Record<string, unknown> = { name: editForm.name, host: editForm.host, port: parseInt(editForm.port), username: editForm.username, transport: editForm.transport, trunk_type: editForm.trunk_type, max_channels: parseInt(editForm.max_channels), status: editForm.status };
      if (editForm.password) updateData.password = editForm.password;
      await trunks.update(editingTrunk.id, updateData as Partial<PbxTrunk>);
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
    <div className="p-3 md:p-6 space-y-6">
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
                <div className="space-y-1.5"><Label>Username</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="SIP username" /></div>
                <div className="space-y-1.5"><Label>Password</Label><PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="SIP password" /></div>
              </div>
              <div className="space-y-1.5"><Label>Max Channels</Label><Input type="number" value={form.max_channels} onChange={(e) => setForm({ ...form, max_channels: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>}
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
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
                  <Badge variant={regStatusColors[t.registration_status] as "default" | "secondary" | "destructive" || "secondary"} className="text-xs capitalize">
                    {t.registration_status || "unknown"}
                  </Badge>
                </TableCell>
                <TableCell><Badge variant={t.status === "active" ? "default" : "secondary"} className="text-xs">{t.status}</Badge></TableCell>
                {isAdmin && <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(t)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(t.id)}>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Developer trunk request */}
      <Card className="max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            <CardTitle className="text-base">Need a SIP trunk?</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Get a free developer SIP trunk with 1 channel and 1 Indian DID for 30 days. Perfect for testing.
          </p>
        </CardHeader>
        <CardFooter>
          <a href="mailto:cats@astradial.com?subject=Developer%20SIP%20Trunk%20Request&body=Hi%2C%20I%20would%20like%20a%20free%20developer%20SIP%20trunk%20for%20testing%20Astradial.%0A%0AMy%20name%3A%20%0AGitHub%3A%20" className="w-full">
            <Button variant="outline" className="w-full gap-2">
              <Mail className="h-4 w-4" />
              Request Free Trunk
            </Button>
          </a>
        </CardFooter>
      </Card>

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
              <div className="space-y-1.5"><Label>Username</Label><Input value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} placeholder="SIP username" /></div>
              <div className="space-y-1.5"><Label>Password</Label><PasswordInput value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} placeholder="Leave blank to keep current" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Max Channels</Label>
                <Input type="number" value={editForm.max_channels} onChange={(e) => setEditForm({ ...editForm, max_channels: e.target.value })} />
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
    </div>
  );
}
