"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Plus, Search, Building2, MoreHorizontal, Pencil, Trash2, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/Toast";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { companies, type Company, activities, type Activity, stats as crmStats, type CrmStats } from "@/lib/crm/client";
import { users as pbxUsers, type PbxUser } from "@/lib/pbx/client";

const SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"];

export default function ClientsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [statData, setStatData] = useState<CrmStats | null>(null);

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: "", industry: "", size: "", phone: "", email: "", website: "", address: "", notes: "" });
  const [saving, setSaving] = useState(false);

  // Detail sheet
  const [selected, setSelected] = useState<Company | null>(null);
  const [companyActivities, setCompanyActivities] = useState<Activity[]>([]);

  // Users for assignment
  const [orgUsers, setOrgUsers] = useState<PbxUser[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Company | null>(null);
  const [assignTo, setAssignTo] = useState("");

  useEffect(() => { load(); loadStats(); loadUsers(); }, [orgId, page, search]);

  async function load() {
    setLoading(true);
    try {
      const res = await companies.list({ page, limit: 25, search: search || undefined });
      setData(res.data);
      setTotal(res.total);
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setLoading(false);
  }

  async function loadStats() {
    try { setStatData(await crmStats.get()); } catch {}
  }

  async function loadUsers() {
    try { setOrgUsers(await pbxUsers.list()); } catch {}
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: "", industry: "", size: "", phone: "", email: "", website: "", address: "", notes: "" });
    setFormOpen(true);
  }

  function openEdit(c: Company) {
    setEditing(c);
    setForm({ name: c.name, industry: c.industry || "", size: c.size || "", phone: c.phone || "", email: c.email || "", website: c.website || "", address: c.address || "", notes: c.notes || "" });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { showToast("Name is required", "error"); return; }
    setSaving(true);
    try {
      if (editing) {
        await companies.update(editing.id, form);
        showToast("Company updated", "success");
      } else {
        await companies.create(form);
        showToast("Company created", "success");
      }
      setFormOpen(false);
      load();
      loadStats();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try {
      await companies.delete(id);
      showToast("Company deleted", "success");
      load();
      loadStats();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function openDetail(c: Company) {
    try {
      const full = await companies.get(c.id);
      setSelected(full);
      const acts = await activities.list({ company_id: c.id, limit: 20 });
      setCompanyActivities(acts.data);
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function handleAssign() {
    if (!assignTarget) return;
    try {
      await companies.update(assignTarget.id, { assigned_to: assignTo || null } as Partial<Company>);
      showToast("Assigned", "success");
      setAssignOpen(false);
      load();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  function getUserName(id: string | null) {
    if (!id) return "Unassigned";
    const u = orgUsers.find(u => u.id === id);
    return u ? (u.full_name || u.username) : id.slice(0, 8);
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-muted-foreground">Manage companies and accounts</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add Company</Button>
      </div>

      {/* Stats */}
      {statData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Companies</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{statData.companies}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Contacts</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{statData.contacts}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Open Deals</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{statData.open_deals}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pipeline Value</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{"\u20B9"}{(statData.pipeline_value || 0).toLocaleString()}</p></CardContent></Card>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search companies..." className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Assigned To</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No companies found</TableCell></TableRow>
            ) : data.map(c => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => openDetail(c)}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center h-8 w-8 rounded-md bg-accent text-accent-foreground text-xs font-semibold">
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    {c.name}
                  </div>
                </TableCell>
                <TableCell>{c.industry || "—"}</TableCell>
                <TableCell>{c.size ? <Badge variant="secondary">{c.size}</Badge> : "—"}</TableCell>
                <TableCell>{c.phone || "—"}</TableCell>
                <TableCell>{c.email || "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{getUserName(c.assigned_to)}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{format(new Date(c.createdAt), "dd MMM yyyy")}</TableCell>
                <TableCell onClick={e => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(c)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setAssignTarget(c); setAssignTo(c.assigned_to || ""); setAssignOpen(true); }}><UserPlus className="h-4 w-4 mr-2" /> Assign</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(c.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{total} companies</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Company" : "Add Company"}</DialogTitle>
            <DialogDescription>Fill in the company details below.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Company Name *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Industry</Label>
                <Input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} placeholder="e.g. Healthcare" />
              </div>
              <div className="grid gap-2">
                <Label>Size</Label>
                <Select value={form.size} onValueChange={v => setForm({ ...form, size: v })}>
                  <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                  <SelectContent>{SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Website</Label>
              <Input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="https://" />
            </div>
            <div className="grid gap-2">
              <Label>Address</Label>
              <Textarea rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign Company</DialogTitle><DialogDescription>Select a team member to assign.</DialogDescription></DialogHeader>
          <div className="grid gap-2 py-2">
            <Label>Assign to</Label>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {orgUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.username} ({u.extension})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" /> {selected.name}
                </SheetTitle>
                <SheetDescription>Company details and activity</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Industry</p><p>{selected.industry || "—"}</p></div>
                  <div><p className="text-muted-foreground">Size</p><p>{selected.size || "—"}</p></div>
                  <div><p className="text-muted-foreground">Phone</p><p>{selected.phone || "—"}</p></div>
                  <div><p className="text-muted-foreground">Email</p><p>{selected.email || "—"}</p></div>
                  <div className="col-span-2"><p className="text-muted-foreground">Website</p><p>{selected.website || "—"}</p></div>
                  <div className="col-span-2"><p className="text-muted-foreground">Address</p><p>{selected.address || "—"}</p></div>
                </div>
                {selected.notes && (<><Separator /><div><p className="text-sm text-muted-foreground mb-1">Notes</p><p className="text-sm">{selected.notes}</p></div></>)}
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Contacts ({(selected.contacts || []).length})</p>
                  {(selected.contacts || []).length === 0 ? <p className="text-sm text-muted-foreground">No contacts linked</p> : (
                    <div className="space-y-1">{(selected.contacts as { id: string; first_name: string; last_name?: string; email?: string }[]).map(ct => (
                      <div key={ct.id} className="flex items-center justify-between text-sm py-1">
                        <span>{ct.first_name} {ct.last_name || ""}</span>
                        <span className="text-muted-foreground">{ct.email || ""}</span>
                      </div>
                    ))}</div>
                  )}
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Recent Activity</p>
                  {companyActivities.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet</p> : (
                    <div className="space-y-2">{companyActivities.map(a => (
                      <div key={a.id} className="flex items-start gap-2 text-sm">
                        <Badge variant="outline" className="text-[10px] shrink-0">{a.type}</Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{a.subject || a.type}</p>
                          {a.body && <p className="text-muted-foreground truncate">{a.body}</p>}
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0">{format(new Date(a.createdAt), "dd MMM")}</span>
                      </div>
                    ))}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
