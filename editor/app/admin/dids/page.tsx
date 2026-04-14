"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Plus, Check, X, ArrowRightLeft, RotateCcw, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/Toast";
import { didAdmin, type PoolDid, type AdminDidsResponse } from "@/lib/did-pool/client";

const POOL_STATUS_LABELS: Record<string, string> = { available: "Available", pending: "Pending", assigned: "Assigned", reserved: "Reserved" };
const POOL_STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = { available: "secondary", pending: "outline", assigned: "default", reserved: "destructive" };

export default function AdminDidsPage() {
  const [data, setData] = useState<AdminDidsResponse>({ dids: [], counts: { available: 0, pending: 0, assigned: 0, reserved: 0, total: 0 } });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);

  // Bulk add
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ rangeStart: "", rangeEnd: "", provider: "Tata", region: "Bangalore", monthly_price: "" });
  const [bulkSaving, setBulkSaving] = useState(false);

  // Assign dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDid, setAssignDid] = useState<PoolDid | null>(null);
  const [assignOrgId, setAssignOrgId] = useState("");

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editDid, setEditDid] = useState<PoolDid | null>(null);
  const [editForm, setEditForm] = useState({ description: "", region: "", provider: "", monthly_price: "" });

  useEffect(() => { loadAll(); }, [filter]);

  async function loadAll() {
    setLoading(true);
    try {
      // Use server-side bridge route (avoids org token requirement)
      const fetchRes = await fetch("/api/admin/dids");
      if (!fetchRes.ok) throw new Error("Failed to load DIDs");
      const res = await fetchRes.json() as AdminDidsResponse;
      setData(res);
      // Extract unique orgs
      const orgMap = new Map<string, string>();
      res.dids.forEach(d => { if (d.organization) orgMap.set(d.organization.id, d.organization.name); });
      setOrgs(Array.from(orgMap.entries()).map(([id, name]) => ({ id, name })));
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setLoading(false);
  }

  async function handleBulkAdd() {
    const start = parseInt(bulkForm.rangeStart);
    const end = parseInt(bulkForm.rangeEnd);
    if (isNaN(start) || isNaN(end) || end < start) { showToast("Invalid range", "error"); return; }

    const numbers: string[] = [];
    for (let i = start; i <= end; i++) numbers.push(String(i));

    setBulkSaving(true);
    try {
      const fetchRes = await fetch("/api/admin/dids/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers, provider: bulkForm.provider, region: bulkForm.region, monthly_price: bulkForm.monthly_price ? parseFloat(bulkForm.monthly_price) : undefined }),
      });
      const data = await fetchRes.json();
      if (!fetchRes.ok) throw new Error(data.error || "Failed");
      showToast(`Added ${data.created} DIDs${data.skipped > 0 ? `, ${data.skipped} already existed` : ""}`, "success");
      setBulkOpen(false);
      loadAll();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setBulkSaving(false);
  }

  async function adminAction(action: string, did_id: string, extra?: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/admin/dids/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ did_id, ...extra }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      showToast(action.charAt(0).toUpperCase() + action.slice(1) + "d", "success");
      loadAll();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function handleApprove(id: string) { adminAction("approve", id); }
  async function handleReject(id: string) { adminAction("reject", id); }

  async function handleAssign() {
    if (!assignDid || !assignOrgId) return;
    adminAction("assign", assignDid.id, { org_id: assignOrgId });
    setAssignOpen(false);
  }

  async function handleRelease(id: string) { adminAction("release", id); }

  async function handleEditSave() {
    if (!editDid) return;
    adminAction("update", editDid.id, {
      description: editForm.description || null,
      region: editForm.region || null,
      provider: editForm.provider || null,
      monthly_price: editForm.monthly_price || null,
    });
    setEditOpen(false);
  }

  function openAssign(did: PoolDid) { setAssignDid(did); setAssignOrgId(""); setAssignOpen(true); }
  function openEdit(did: PoolDid) {
    setEditDid(did);
    setEditForm({ description: did.description || "", region: did.region || "", provider: did.provider || "", monthly_price: did.monthly_price != null ? String(did.monthly_price) : "" });
    setEditOpen(true);
  }

  function formatNumber(num: string) {
    const clean = num.replace(/[^0-9]/g, "");
    if (clean.length === 12 && clean.startsWith("91")) return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
    return num;
  }

  const { counts } = data;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">DID Management</h1>
          <p className="text-sm text-muted-foreground">Manage phone number pool across all organisations</p>
        </div>
        <Button onClick={() => setBulkOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add DIDs to Pool</Button>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className={filter === "all" ? "border-primary" : "cursor-pointer"} onClick={() => setFilter("all")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{counts.total}</p></CardContent>
        </Card>
        <Card className={filter === "available" ? "border-primary" : "cursor-pointer"} onClick={() => setFilter("available")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Available</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{counts.available}</p></CardContent>
        </Card>
        <Card className={filter === "pending" ? "border-primary" : "cursor-pointer"} onClick={() => setFilter("pending")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{counts.pending}</p></CardContent>
        </Card>
        <Card className={filter === "assigned" ? "border-primary" : "cursor-pointer"} onClick={() => setFilter("assigned")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Assigned</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{counts.assigned}</p></CardContent>
        </Card>
        <Card className={filter === "reserved" ? "border-primary" : "cursor-pointer"} onClick={() => setFilter("reserved")}>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Reserved</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{counts.reserved}</p></CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Organisation</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Routing</TableHead>
              <TableHead>Price/mo</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : data.dids.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No DIDs found</TableCell></TableRow>
            ) : data.dids.map(did => (
              <TableRow key={did.id}>
                <TableCell className="font-mono text-sm font-medium">{formatNumber(did.number)}</TableCell>
                <TableCell><Badge variant={POOL_STATUS_VARIANTS[did.pool_status] || "secondary"}>{POOL_STATUS_LABELS[did.pool_status]}</Badge></TableCell>
                <TableCell>{did.organization?.name || (did.pool_status === "pending" ? <span className="text-muted-foreground italic">Requested</span> : "—")}</TableCell>
                <TableCell>{did.region || "—"}</TableCell>
                <TableCell>{did.provider || "—"}</TableCell>
                <TableCell>
                  {did.routing_type ? <Badge variant="outline" className="text-xs capitalize">{did.routing_type} → {did.routing_destination}</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                </TableCell>
                <TableCell>{did.monthly_price != null ? `₹${Number(did.monthly_price).toLocaleString()}` : "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {did.pool_status === "pending" && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Approve" onClick={() => handleApprove(did.id)}><Check className="h-4 w-4 text-green-600" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Reject" onClick={() => handleReject(did.id)}><X className="h-4 w-4 text-destructive" /></Button>
                      </>
                    )}
                    {did.pool_status === "available" && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Assign to org" onClick={() => openAssign(did)}><ArrowRightLeft className="h-4 w-4" /></Button>
                    )}
                    {did.pool_status === "assigned" && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Release to pool" onClick={() => handleRelease(did.id)}><RotateCcw className="h-4 w-4" /></Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit details" onClick={() => openEdit(did)}><Pencil className="h-3 w-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Bulk Add Dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add DIDs to Pool</DialogTitle><DialogDescription>Enter a number range to add to the available pool.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Range Start</Label><Input value={bulkForm.rangeStart} onChange={e => setBulkForm({ ...bulkForm, rangeStart: e.target.value })} placeholder="918065978000" /></div>
              <div className="grid gap-2"><Label>Range End</Label><Input value={bulkForm.rangeEnd} onChange={e => setBulkForm({ ...bulkForm, rangeEnd: e.target.value })} placeholder="918065978029" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Provider</Label><Input value={bulkForm.provider} onChange={e => setBulkForm({ ...bulkForm, provider: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Region</Label><Input value={bulkForm.region} onChange={e => setBulkForm({ ...bulkForm, region: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Monthly Price (INR)</Label><Input type="number" value={bulkForm.monthly_price} onChange={e => setBulkForm({ ...bulkForm, monthly_price: e.target.value })} placeholder="500" /></div>
            {bulkForm.rangeStart && bulkForm.rangeEnd && (
              <p className="text-sm text-muted-foreground">Will add {Math.max(0, parseInt(bulkForm.rangeEnd) - parseInt(bulkForm.rangeStart) + 1)} numbers</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkAdd} disabled={bulkSaving}>{bulkSaving ? "Adding..." : "Add to Pool"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign DID</DialogTitle><DialogDescription>Assign {assignDid ? formatNumber(assignDid.number) : ""} to an organisation.</DialogDescription></DialogHeader>
          <div className="grid gap-2 py-2">
            <Label>Organisation</Label>
            <Select value={assignOrgId} onValueChange={setAssignOrgId}>
              <SelectTrigger><SelectValue placeholder="Select organisation" /></SelectTrigger>
              <SelectContent>
                {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={!assignOrgId}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit DID Details</DialogTitle><DialogDescription>{editDid ? formatNumber(editDid.number) : ""}</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Description</Label><Input value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Region</Label><Input value={editForm.region} onChange={e => setEditForm({ ...editForm, region: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Provider</Label><Input value={editForm.provider} onChange={e => setEditForm({ ...editForm, provider: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Monthly Price (INR)</Label><Input type="number" value={editForm.monthly_price} onChange={e => setEditForm({ ...editForm, monthly_price: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
