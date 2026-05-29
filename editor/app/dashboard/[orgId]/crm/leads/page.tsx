"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Plus, Search, MoreHorizontal, Pencil, Trash2, UserPlus, LayoutGrid, List } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { contacts, companies, pipelines, type Contact, type Company, type PipelineStage, DEFAULT_LEAD_STAGES } from "@/lib/crm/client";
import { users as pbxUsers, type PbxUser } from "@/lib/pbx/client";
import { KanbanBoard, type KanbanItem } from "@/components/crm/KanbanBoard";

const SOURCES = ["website", "phone", "referral", "social", "advertisement", "cold_call", "event", "other"];

export default function LeadsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "list">("kanban");

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", job_title: "", lead_source: "", lead_status: "new", company_id: "", notes: "" });
  const [saving, setSaving] = useState(false);

  // Company list for select
  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [orgUsers, setOrgUsers] = useState<PbxUser[]>([]);

  // Pipeline stages
  const [stages, setStages] = useState<PipelineStage[]>(DEFAULT_LEAD_STAGES);
  const stageKeys = stages.map(s => s.stage_key);
  const stageLabels = Object.fromEntries(stages.map(s => [s.stage_key, s.stage_label]));

  // Assign
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Contact | null>(null);
  const [assignTo, setAssignTo] = useState("");

  useEffect(() => { load(); loadCompanies(); loadUsers(); loadStages(); }, [orgId, page, search]);

  async function loadStages() {
    try { setStages(await pipelines.get("lead")); } catch {}
  }

  async function load() {
    setLoading(true);
    try {
      const res = await contacts.list({ page, limit: 100, search: search || undefined });
      setData(res.data);
      setTotal(res.total);
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setLoading(false);
  }

  async function loadCompanies() {
    try { const res = await companies.list({ limit: 100 }); setCompanyList(res.data); } catch {}
  }

  async function loadUsers() {
    try { setOrgUsers(await pbxUsers.list()); } catch {}
  }

  function openCreate() {
    setEditing(null);
    setForm({ first_name: "", last_name: "", email: "", phone: "", job_title: "", lead_source: "", lead_status: "new", company_id: "", notes: "" });
    setFormOpen(true);
  }

  function openEdit(c: Contact) {
    setEditing(c);
    setForm({
      first_name: c.first_name, last_name: c.last_name || "", email: c.email || "",
      phone: c.phone || "", job_title: c.job_title || "", lead_source: c.lead_source || "",
      lead_status: c.lead_status, company_id: c.company_id || "", notes: c.notes || "",
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.first_name.trim()) { showToast("First name is required", "error"); return; }
    setSaving(true);
    try {
      const payload = { ...form, lead_status: form.lead_status as Contact["lead_status"], company_id: form.company_id || null };
      if (editing) {
        await contacts.update(editing.id, payload);
        showToast("Contact updated", "success");
      } else {
        await contacts.create(payload);
        showToast("Lead created", "success");
      }
      setFormOpen(false);
      load();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try { await contacts.delete(id); showToast("Lead deleted", "success"); load(); }
    catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function handleStageChange(itemId: string, newStage: string) {
    // Optimistic update — move card instantly, sync API in background
    const prev = data;
    setData(d => d.map(c => c.id === itemId ? { ...c, lead_status: newStage as Contact["lead_status"] } : c));
    try {
      await contacts.updateStatus(itemId, newStage);
    } catch (e: unknown) {
      setData(prev); // revert on failure
      showToast((e as Error).message, "error");
    }
  }

  async function handleAssign() {
    if (!assignTarget) return;
    try {
      await contacts.assign(assignTarget.id, assignTo === "none" ? null : assignTo);
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

  // Map contacts to KanbanItem
  const kanbanItems: (Contact & KanbanItem)[] = data.map(c => ({ ...c, stage: c.lead_status }));

  function renderLeadCard(item: Contact & KanbanItem) {
    return (
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium truncate">{item.first_name} {item.last_name || ""}</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3 w-3" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(item)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setAssignTarget(item); setAssignTo(item.assigned_to || ""); setAssignOpen(true); }}><UserPlus className="h-4 w-4 mr-2" /> Assign</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {item.company && <p className="text-xs text-muted-foreground">{item.company.name}</p>}
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.lead_source && <Badge variant="secondary" className="text-[10px]">{item.lead_source}</Badge>}
            {item.assigned_to && <Badge variant="outline" className="text-[10px]">{getUserName(item.assigned_to)}</Badge>}
          </div>
          {item.phone && <p className="text-xs text-muted-foreground">{item.phone}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">{total} contacts in pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={v => setView(v as "kanban" | "list")}>
            <TabsList>
              <TabsTrigger value="kanban"><LayoutGrid className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="list"><List className="h-4 w-4" /></TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add Lead</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search leads..." className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-12">Loading...</p>
      ) : view === "kanban" ? (
        <KanbanBoard
          stages={stageKeys}
          stageLabels={stageLabels}
          items={kanbanItems}
          onStageChange={handleStageChange}
          renderCard={renderLeadCard}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No leads found</TableCell></TableRow>
              ) : data.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.first_name} {c.last_name || ""}</TableCell>
                  <TableCell>{c.company?.name || "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{stageLabels[c.lead_status]}</Badge></TableCell>
                  <TableCell>{c.lead_source || "—"}</TableCell>
                  <TableCell>{c.phone || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{getUserName(c.assigned_to)}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-xs">{format(new Date(c.createdAt), "dd MMM yyyy")}</TableCell>
                  <TableCell>
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
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Lead" : "Add Lead"}</DialogTitle><DialogDescription>Enter contact and lead details.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>First Name *</Label><Input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Last Name</Label><Input value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Job Title</Label><Input value={form.job_title} onChange={e => setForm({ ...form, job_title: e.target.value })} /></div>
              <div className="grid gap-2">
                <Label>Lead Source</Label>
                <Select value={form.lead_source} onValueChange={v => setForm({ ...form, lead_source: v })}>
                  <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                  <SelectContent>{SOURCES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.lead_status} onValueChange={v => setForm({ ...form, lead_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{stageKeys.map(s => <SelectItem key={s} value={s}>{stageLabels[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Company</Label>
                <Select value={form.company_id} onValueChange={v => setForm({ ...form, company_id: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {companyList.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
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
          <DialogHeader><DialogTitle>Assign Lead</DialogTitle><DialogDescription>Select a team member to assign.</DialogDescription></DialogHeader>
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
    </div>
  );
}
