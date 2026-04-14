"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { customFields, pipelines, type CustomField, type PipelineStage, DEFAULT_LEAD_STAGES, DEFAULT_DEAL_STAGES } from "@/lib/crm/client";

const ENTITY_TYPES = ["contact", "company", "deal"] as const;
const ENTITY_LABELS: Record<string, string> = { contact: "Contacts", company: "Companies", deal: "Deals" };
const FIELD_TYPES = ["text", "number", "date", "select", "checkbox", "email", "phone", "url", "textarea"] as const;
const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text", number: "Number", date: "Date", select: "Select (Dropdown)",
  checkbox: "Checkbox", email: "Email", phone: "Phone", url: "URL", textarea: "Long Text",
};

export default function CustomizePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [mainTab, setMainTab] = useState<"fields" | "pipelines">("pipelines");

  // ── Custom Fields state ──
  const [fields, setFields] = useState<CustomField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [activeEntityTab, setActiveEntityTab] = useState<string>("contact");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [form, setForm] = useState({ field_label: "", field_type: "text", required: false, options: "" });
  const [saving, setSaving] = useState(false);

  // ── Pipeline state ──
  const [leadStages, setLeadStages] = useState<PipelineStage[]>(DEFAULT_LEAD_STAGES);
  const [dealStages, setDealStages] = useState<PipelineStage[]>(DEFAULT_DEAL_STAGES);
  const [pipelineTab, setPipelineTab] = useState<"lead" | "deal">("lead");
  const [stageFormOpen, setStageFormOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<{ index: number; label: string } | null>(null);
  const [newStageLabel, setNewStageLabel] = useState("");
  const [pipelineSaving, setPipelineSaving] = useState(false);

  useEffect(() => { loadFields(); loadPipelines(); }, [orgId]);

  // ── Custom Fields logic ──
  async function loadFields() {
    setFieldsLoading(true);
    try { setFields(await customFields.list()); }
    catch (e: unknown) { showToast((e as Error).message, "error"); }
    setFieldsLoading(false);
  }

  function openCreateField() {
    setEditing(null);
    setForm({ field_label: "", field_type: "text", required: false, options: "" });
    setFormOpen(true);
  }

  function openEditField(f: CustomField) {
    setEditing(f);
    setForm({ field_label: f.field_label, field_type: f.field_type, required: f.required, options: (f.options || []).join(", ") });
    setFormOpen(true);
  }

  async function handleSaveField() {
    if (!form.field_label.trim()) { showToast("Label is required", "error"); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { field_label: form.field_label, field_type: form.field_type, required: form.required, entity_type: activeEntityTab };
      if (form.field_type === "select" && form.options.trim()) payload.options = form.options.split(",").map(o => o.trim()).filter(Boolean);
      if (editing) { await customFields.update(editing.id, payload as Partial<CustomField>); showToast("Field updated", "success"); }
      else { await customFields.create(payload as Partial<CustomField>); showToast("Field created", "success"); }
      setFormOpen(false);
      loadFields();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setSaving(false);
  }

  async function handleDeleteField(id: string) {
    try { await customFields.delete(id); showToast("Field deleted", "success"); loadFields(); }
    catch (e: unknown) { showToast((e as Error).message, "error"); }
  }

  const filteredFields = fields.filter(f => f.entity_type === activeEntityTab);

  // ── Pipeline logic ──
  async function loadPipelines() {
    try {
      const [lead, deal] = await Promise.all([pipelines.get("lead"), pipelines.get("deal")]);
      setLeadStages(lead);
      setDealStages(deal);
    } catch {}
  }

  const currentStages = pipelineTab === "lead" ? leadStages : dealStages;
  const setCurrentStages = pipelineTab === "lead" ? setLeadStages : setDealStages;

  function addStage() {
    if (!newStageLabel.trim()) return;
    const key = newStageLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (currentStages.some(s => s.stage_key === key)) { showToast("Stage already exists", "error"); return; }
    setCurrentStages([...currentStages, { stage_key: key, stage_label: newStageLabel.trim(), sort_order: currentStages.length }]);
    setNewStageLabel("");
  }

  function removeStage(index: number) {
    setCurrentStages(currentStages.filter((_, i) => i !== index).map((s, i) => ({ ...s, sort_order: i })));
  }

  function moveStage(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= currentStages.length) return;
    const arr = [...currentStages];
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    setCurrentStages(arr.map((s, i) => ({ ...s, sort_order: i })));
  }

  function renameStage(index: number, newLabel: string) {
    setCurrentStages(currentStages.map((s, i) => i === index ? { ...s, stage_label: newLabel } : s));
    setEditingStage(null);
  }

  async function savePipeline() {
    setPipelineSaving(true);
    try {
      await pipelines.save(pipelineTab, currentStages);
      showToast(`${pipelineTab === "lead" ? "Lead" : "Deal"} pipeline saved`, "success");
      loadPipelines();
    } catch (e: unknown) { showToast((e as Error).message, "error"); }
    setPipelineSaving(false);
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Customize CRM</h1>
        <p className="text-sm text-muted-foreground">Configure pipelines and custom fields</p>
      </div>

      <Tabs value={mainTab} onValueChange={v => setMainTab(v as "fields" | "pipelines")}>
        <TabsList>
          <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
          <TabsTrigger value="fields">Custom Fields</TabsTrigger>
        </TabsList>

        {/* ── PIPELINES TAB ── */}
        <TabsContent value="pipelines">
          <Tabs value={pipelineTab} onValueChange={v => setPipelineTab(v as "lead" | "deal")}>
            <TabsList>
              <TabsTrigger value="lead">Lead Pipeline</TabsTrigger>
              <TabsTrigger value="deal">Deal Pipeline</TabsTrigger>
            </TabsList>

            {(["lead", "deal"] as const).map(pt => (
              <TabsContent key={pt} value={pt}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{pt === "lead" ? "Lead" : "Deal"} Pipeline Stages</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Order</TableHead>
                          <TableHead>Stage Name</TableHead>
                          <TableHead>Key</TableHead>
                          <TableHead className="w-32"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {currentStages.map((s, i) => (
                          <TableRow key={s.stage_key}>
                            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">{s.stage_label}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{s.stage_key}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => moveStage(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === currentStages.length - 1} onClick={() => moveStage(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingStage({ index: i, label: s.stage_label })}><Pencil className="h-3 w-3" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeStage(i)} disabled={currentStages.length <= 2}><Trash2 className="h-3 w-3" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <div className="flex items-center gap-2">
                      <Input placeholder="New stage name..." value={newStageLabel} onChange={e => setNewStageLabel(e.target.value)} className="max-w-xs" onKeyDown={e => e.key === "Enter" && addStage()} />
                      <Button variant="outline" size="sm" onClick={addStage} disabled={!newStageLabel.trim()}><Plus className="h-4 w-4 mr-1" /> Add Stage</Button>
                    </div>

                    <Separator />

                    <div className="flex justify-end">
                      <Button onClick={savePipeline} disabled={pipelineSaving}>{pipelineSaving ? "Saving..." : "Save Pipeline"}</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>

        {/* ── CUSTOM FIELDS TAB ── */}
        <TabsContent value="fields">
          <div className="flex items-center justify-end mb-4">
            <Button onClick={openCreateField}><Plus className="h-4 w-4 mr-1" /> Add Field</Button>
          </div>

          <Tabs value={activeEntityTab} onValueChange={setActiveEntityTab}>
            <TabsList>
              {ENTITY_TYPES.map(t => (
                <TabsTrigger key={t} value={t}>
                  {ENTITY_LABELS[t]}
                  <Badge variant="secondary" className="ml-1.5 text-[10px]">{fields.filter(f => f.entity_type === t).length}</Badge>
                </TabsTrigger>
              ))}
            </TabsList>

            {ENTITY_TYPES.map(t => (
              <TabsContent key={t} value={t}>
                <Card>
                  <CardHeader><CardTitle className="text-base">Custom Fields for {ENTITY_LABELS[t]}</CardTitle></CardHeader>
                  <CardContent>
                    {fieldsLoading ? (
                      <p className="text-muted-foreground text-center py-8">Loading...</p>
                    ) : filteredFields.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-muted-foreground mb-2">No custom fields for {ENTITY_LABELS[t].toLowerCase()}</p>
                        <Button variant="outline" size="sm" onClick={openCreateField}><Plus className="h-4 w-4 mr-1" /> Add First Field</Button>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Label</TableHead>
                            <TableHead>Field Name</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Required</TableHead>
                            <TableHead>Options</TableHead>
                            <TableHead className="w-20"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredFields.map(f => (
                            <TableRow key={f.id}>
                              <TableCell className="font-medium">{f.field_label}</TableCell>
                              <TableCell className="text-muted-foreground font-mono text-xs">{f.field_name}</TableCell>
                              <TableCell><Badge variant="outline">{FIELD_TYPE_LABELS[f.field_type] || f.field_type}</Badge></TableCell>
                              <TableCell>{f.required ? <Badge variant="default">Required</Badge> : <span className="text-muted-foreground">Optional</span>}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-32 truncate">{(f.options || []).join(", ") || "—"}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditField(f)}><Pencil className="h-4 w-4" /></Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteField(f.id)}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>
      </Tabs>

      {/* Rename Stage Dialog */}
      <Dialog open={!!editingStage} onOpenChange={() => setEditingStage(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename Stage</DialogTitle><DialogDescription>Enter a new name for this stage.</DialogDescription></DialogHeader>
          <div className="grid gap-2 py-2">
            <Label>Stage Name</Label>
            <Input value={editingStage?.label || ""} onChange={e => editingStage && setEditingStage({ ...editingStage, label: e.target.value })} onKeyDown={e => e.key === "Enter" && editingStage && renameStage(editingStage.index, editingStage.label)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingStage(null)}>Cancel</Button>
            <Button onClick={() => editingStage && renameStage(editingStage.index, editingStage.label)}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Field Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Custom Field" : "Add Custom Field"}</DialogTitle><DialogDescription>Configure the custom field properties.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Entity Type</Label>
              <Select value={activeEntityTab} disabled>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ENTITY_TYPES.map(t => <SelectItem key={t} value={t}>{ENTITY_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Field Label *</Label>
              <Input value={form.field_label} onChange={e => setForm({ ...form, field_label: e.target.value })} placeholder="e.g. Contract Number" />
            </div>
            <div className="grid gap-2">
              <Label>Field Type</Label>
              <Select value={form.field_type} onValueChange={v => setForm({ ...form, field_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FIELD_TYPES.map(t => <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {form.field_type === "select" && (
              <div className="grid gap-2">
                <Label>Options (comma-separated)</Label>
                <Input value={form.options} onChange={e => setForm({ ...form, options: e.target.value })} placeholder="Option 1, Option 2, Option 3" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox checked={form.required} onCheckedChange={c => setForm({ ...form, required: !!c })} id="required" />
              <Label htmlFor="required">Required field</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveField} disabled={saving}>{saving ? "Saving..." : editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
