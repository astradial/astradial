"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Plus, Search, MoreHorizontal, Pencil, Trash2, UserPlus, LayoutGrid, List, IndianRupee } from "lucide-react";

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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { deals, companies, contacts, pipelines, type Deal, type Company, type Contact, type PipelineStage, DEFAULT_DEAL_STAGES, stats as crmStats } from "@/lib/crm/client";
import { users as pbxUsers, type PbxUser } from "@/lib/pbx/client";
import { KanbanBoard, type KanbanItem } from "@/components/crm/KanbanBoard";

export default function DealsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [pipelineValue, setPipelineValue] = useState(0);
  const [wonValue, setWonValue] = useState(0);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [form, setForm] = useState({ title: "", stage: "lead", amount: "", currency: "INR", expected_close: "", company_id: "", contact_id: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const [companyList, setCompanyList] = useState<Company[]>([]);
  const [contactList, setContactList] = useState<Contact[]>([]);
  const [orgUsers, setOrgUsers] = useState<PbxUser[]>([]);

  // Pipeline stages
  const [stages, setStages] = useState<PipelineStage[]>(DEFAULT_DEAL_STAGES);
  const stageKeys = stages.map(s => s.stage_key);
  const stageLabels = Object.fromEntries(stages.map(s => [s.stage_key, s.stage_label]));

  // Assign
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Deal | null>(null);
  const [assignTo, setAssignTo] = useState("");

  useEffect(() => { load(); loadCompanies(); loadContacts(); loadUsers(); loadStats(); loadStages(); }, [orgId, page, search]);

  async function loadStages() {
    try { setStages(await pipelines.get("deal")); } catch {}
  }

  async function load() {
    setLoading(true);
    try {
      const res = await deals.list({ page, limit: 100, search: search || undefined });
      setData(res.data);
      setTotal(res.total);
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setLoading(false);
  }

  async function loadStats() {
    try {
      const s = await crmStats.get();
      setPipelineValue(s.pipeline_value);
      setWonValue(s.won_value);
    } catch {}
  }

  async function loadCompanies() { try { const r = await companies.list({ limit: 100 }); setCompanyList(r.data); } catch {} }
  async function loadContacts() { try { const r = await contacts.list({ limit: 100 }); setContactList(r.data); } catch {} }
  async function loadUsers() { try { setOrgUsers(await pbxUsers.list()); } catch {} }

  function openCreate() {
    setEditing(null);
    setForm({ title: "", stage: "lead", amount: "", currency: "INR", expected_close: "", company_id: "", contact_id: "", notes: "" });
    setFormOpen(true);
  }

  function openEdit(d: Deal) {
    setEditing(d);
    setForm({
      title: d.title, stage: d.stage, amount: d.amount != null ? String(d.amount) : "",
      currency: d.currency, expected_close: d.expected_close || "",
      company_id: d.company_id || "", contact_id: d.contact_id || "", notes: d.notes || "",
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) { showToast("Title is required", "error"); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        stage: form.stage as Deal["stage"],
        amount: form.amount ? parseFloat(form.amount) : null,
        company_id: form.company_id || null,
        contact_id: form.contact_id || null,
        expected_close: form.expected_close || null,
      };
      if (editing) {
        await deals.update(editing.id, payload);
        showToast("Deal updated", "success");
      } else {
        await deals.create(payload);
        showToast("Deal created", "success");
      }
      setFormOpen(false);
      load();
      loadStats();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try { await deals.delete(id); showToast("Deal deleted", "success"); load(); loadStats(); }
    catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  async function handleStageChange(itemId: string, newStage: string) {
    // Optimistic update — move card instantly, sync API in background
    const prev = data;
    setData(d => d.map(deal => deal.id === itemId ? { ...deal, stage: newStage as Deal["stage"] } : deal));
    try {
      await deals.updateStage(itemId, newStage);
      loadStats();
    } catch (e: unknown) {
      setData(prev); // revert on failure
      showToast((e as Error).message, "error");
    }
  }

  async function handleAssign() {
    if (!assignTarget) return;
    try {
      await deals.assign(assignTarget.id, assignTo === "none" ? null : assignTo);
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

  const kanbanItems: (Deal & KanbanItem)[] = data.map(d => ({ ...d, stage: d.stage }));

  function renderDealCard(item: Deal & KanbanItem) {
    return (
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium truncate">{item.title}</p>
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
          <div className="flex items-center justify-between">
            {item.amount != null ? (
              <span className="text-sm font-semibold">{"\u20B9"}{Number(item.amount).toLocaleString()}</span>
            ) : (
              <span className="text-xs text-muted-foreground">No amount</span>
            )}
            {item.expected_close && <span className="text-[10px] text-muted-foreground">{format(new Date(item.expected_close), "dd MMM")}</span>}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.contact && <Badge variant="secondary" className="text-[10px]">{item.contact.first_name}</Badge>}
            {item.assigned_to && <Badge variant="outline" className="text-[10px]">{getUserName(item.assigned_to)}</Badge>}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Deals</h1>
          <p className="text-sm text-muted-foreground">{total} deals in pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={v => setView(v as "kanban" | "list")}>
            <TabsList>
              <TabsTrigger value="kanban"><LayoutGrid className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="list"><List className="h-4 w-4" /></TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add Deal</Button>
        </div>
      </div>

      {/* Pipeline stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pipeline Value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{"\u20B9"}{(pipelineValue || 0).toLocaleString()}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Won Value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{"\u20B9"}{(wonValue || 0).toLocaleString()}</p></CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search deals..." className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
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
          renderCard={renderDealCard}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Close Date</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No deals found</TableCell></TableRow>
              ) : data.map(d => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.title}</TableCell>
                  <TableCell>{d.company?.name || "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{stageLabels[d.stage]}</Badge></TableCell>
                  <TableCell>{d.amount != null ? `${"\u20B9"}${Number(d.amount).toLocaleString()}` : "—"}</TableCell>
                  <TableCell>{d.expected_close ? format(new Date(d.expected_close), "dd MMM yyyy") : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{getUserName(d.assigned_to)}</Badge></TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(d)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setAssignTarget(d); setAssignTo(d.assigned_to || ""); setAssignOpen(true); }}><UserPlus className="h-4 w-4 mr-2" /> Assign</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(d.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
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
          <DialogHeader><DialogTitle>{editing ? "Edit Deal" : "Add Deal"}</DialogTitle><DialogDescription>Enter deal details.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Title *</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Stage</Label>
                <Select value={form.stage} onValueChange={v => setForm({ ...form, stage: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{stageKeys.map(s => <SelectItem key={s} value={s}>{stageLabels[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Amount ({form.currency})</Label>
                <Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
              <div className="grid gap-2">
                <Label>Contact</Label>
                <Select value={form.contact_id} onValueChange={v => setForm({ ...form, contact_id: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {contactList.map(c => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name || ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Expected Close Date</Label>
              <Input type="date" value={form.expected_close} onChange={e => setForm({ ...form, expected_close: e.target.value })} />
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
          <DialogHeader><DialogTitle>Assign Deal</DialogTitle><DialogDescription>Select a team member to assign.</DialogDescription></DialogHeader>
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
