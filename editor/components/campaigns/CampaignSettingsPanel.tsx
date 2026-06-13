"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Shield,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { showToast } from "@/components/ui/Toast";
import { leadFields as leadFieldsApi, orgSettings as orgSettingsApi } from "@/lib/campaigns/client";
import type { CampaignLeadField, LeadFieldType } from "@/lib/campaigns/types";

const FIELD_TYPES: { value: LeadFieldType; label: string; glyph: string; color: string }[] = [
  { value: "text", label: "Text", glyph: "T", color: "oklch(0.55 0.005 285)" },
  { value: "number", label: "Number", glyph: "#", color: "oklch(0.55 0.005 285)" },
  { value: "select", label: "Select", glyph: "◉", color: "oklch(0.55 0.18 264)" },
  { value: "multi", label: "Multi-select", glyph: "▦", color: "oklch(0.55 0.18 264)" },
  { value: "date", label: "Date", glyph: "📅", color: "oklch(0.55 0.18 264)" },
  { value: "datetime", label: "Date & time", glyph: "🕐", color: "oklch(0.55 0.18 264)" },
  { value: "phone", label: "Phone", glyph: "☎", color: "oklch(0.55 0.16 150)" },
  { value: "email", label: "Email", glyph: "@", color: "oklch(0.55 0.16 150)" },
  { value: "url", label: "URL", glyph: "🔗", color: "oklch(0.55 0.16 150)" },
  { value: "boolean", label: "Boolean", glyph: "✓", color: "oklch(0.55 0.16 150)" },
  { value: "currency", label: "Currency", glyph: "$", color: "oklch(0.62 0.18 65)" },
  { value: "identifier", label: "Identifier", glyph: "★", color: "oklch(0.55 0.005 285)" },
];

type ListResponse = { data: CampaignLeadField[] };

function makeUniqueLeadFieldId(slug: string, existing: CampaignLeadField[]) {
  const base = slug || "new_field";
  const existingIds = new Set(existing.map((field) => field.id));
  if (!existingIds.has(base)) return base;

  for (let i = 2; i <= 9999; i += 1) {
    const candidate = `${base}_${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }

  return `${base}_${existingIds.size + 1}`;
}

export function CampaignSettingsPanel({
  orgId,
  showBackLink = true,
  embedded = false,
}: {
  orgId: string;
  showBackLink?: boolean;
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const settingsQueryKey = useMemo(() => ["orgSettings", "campaign", orgId] as const, [orgId]);
  const leadFieldsQueryKey = useMemo(() => ["leadFields", orgId] as const, [orgId]);

  const [adding, setAdding] = useState(false);
  const [editingField, setEditingField] = useState<CampaignLeadField | null>(null);

  // ── Campaign concurrency settings ──────────────────────────────────
  const settingsQ = useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => orgSettingsApi.get(),
  });
  const [callsDraft, setCallsDraft] = useState<string | null>(null);
  const [wpmDraft, setWpmDraft] = useState<string | null>(null);
  const calls = callsDraft ?? String(settingsQ.data?.campaign_max_concurrent_calls ?? "");
  const wpm = wpmDraft ?? String(settingsQ.data?.campaign_max_whatsapp_per_minute ?? "");

  const concurrencyMut = useMutation({
    mutationFn: () => {
      const c = parseInt(calls, 10);
      const w = parseInt(wpm, 10);
      if (!Number.isFinite(c) || c < 1 || c > 500)
        throw new Error("Concurrent calls must be 1–500");
      if (!Number.isFinite(w) || w < 1 || w > 10000)
        throw new Error("WhatsApp/min must be 1–10 000");
      return orgSettingsApi.update({
        campaign_max_concurrent_calls: c,
        campaign_max_whatsapp_per_minute: w,
      });
    },
    onSuccess: () => {
      showToast("Campaign limits saved", "success");
      qc.invalidateQueries({ queryKey: settingsQueryKey });
    },
    onError: (e: Error) => showToast(e.message || "Save failed", "error"),
  });

  const listQ = useQuery({
    queryKey: leadFieldsQueryKey,
    queryFn: () => leadFieldsApi.list(),
  });

  const fields = useMemo(() => listQ.data?.data ?? [], [listQ.data]);
  const systemFields = useMemo(() => fields.filter((f) => f.is_system), [fields]);
  const customFields = useMemo(() => fields.filter((f) => !f.is_system), [fields]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => leadFieldsApi.reorder(ids),
    onSuccess: () => {
      showToast("Order saved", "success");
      qc.invalidateQueries({ queryKey: leadFieldsQueryKey });
    },
  });

  function handleDragEnd(evt: DragEndEvent) {
    const { active, over } = evt;
    if (!over || active.id === over.id) return;

    const oldIndex = customFields.findIndex((f) => f.id === active.id);
    const newIndex = customFields.findIndex((f) => f.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const snapshot = qc.getQueryData<ListResponse>(leadFieldsQueryKey);
    const next = arrayMove(customFields, oldIndex, newIndex);
    qc.setQueryData<ListResponse>(leadFieldsQueryKey, (old) =>
      old ? { ...old, data: [...systemFields, ...next] } : { data: [...systemFields, ...next] }
    );

    const ids = next.map((f) => f.id);
    reorderMut.mutate(ids, {
      onError: (e: Error) => {
        if (snapshot) qc.setQueryData(leadFieldsQueryKey, snapshot);
        showToast(e.message || "Reorder failed", "error");
      },
    });
  }

  const deleteMut = useMutation({
    mutationFn: (id: string) => leadFieldsApi.delete(id),
    onSuccess: () => {
      showToast("Field deleted", "success");
      qc.invalidateQueries({ queryKey: leadFieldsQueryKey });
    },
    onError: (e: Error) => showToast(e.message || "Delete failed", "error"),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {showBackLink ? (
        <div style={{ marginBottom: embedded ? -8 : 0 }}>
          <button
            type="button"
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            onClick={() => router.push(`/dashboard/${orgId}/campaigns`)}
          >
            <ArrowLeft size={14} /> Back to campaigns
          </button>
        </div>
      ) : null}

      {/* Campaign limits card */}
      <div className="cmp-card-static">
        <div className="cmp-card-static-header">
          <span className="cmp-card-static-title">Campaign Limits</span>
          <span className="cmp-card-static-description">
            Org-wide concurrency limits for all campaigns.
          </span>
        </div>
        <div className="cmp-card-static-content">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              concurrencyMut.mutate();
            }}
            style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}
          >
            <label style={fieldLabelStyle}>
              <span className="cmp-label" style={{ fontWeight: 600 }}>
                Max concurrent calls
              </span>
              <input
                type="number"
                min={1}
                max={500}
                value={calls}
                onChange={(e) => setCallsDraft(e.target.value)}
                disabled={settingsQ.isLoading}
                className="cmp-input"
                style={{ width: 130 }}
              />
            </label>
            <label style={fieldLabelStyle}>
              <span className="cmp-label" style={{ fontWeight: 600 }}>
                Max WhatsApp / min
              </span>
              <input
                type="number"
                min={1}
                max={10000}
                value={wpm}
                onChange={(e) => setWpmDraft(e.target.value)}
                disabled={settingsQ.isLoading}
                className="cmp-input"
                style={{ width: 130 }}
              />
            </label>
            <button
              type="submit"
              className="cmp-btn cmp-btn-default cmp-btn-sm"
              disabled={concurrencyMut.isPending || settingsQ.isLoading}
              style={{ height: 36, border: "1px solid var(--border)" }}
            >
              {concurrencyMut.isPending ? "Saving…" : "Save"}
            </button>
          </form>
        </div>
      </div>

      {/* Data Model Card */}
      <div className="cmp-card-static">
        <div className="cmp-card-static-header">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              width: "100%",
            }}
          >
            <div>
              <span className="cmp-card-static-title">Data Model</span>
              <div className="cmp-card-static-description">
                Define the fields stored on each Lead. The order here is the order of columns in the
                campaign Leads table.
              </div>
            </div>
            <span
              className="cmp-chip"
              style={{
                background: "oklch(0.965 0.04 150)",
                color: "oklch(0.4 0.13 150)",
                fontWeight: 600,
              }}
            >
              NEW
            </span>
          </div>
        </div>

        <div className="cmp-card-static-content" style={{ paddingTop: 4 }}>
          {/* Object header */}
          <div className="cmp-dm-object-head">
            <span className="cmp-dm-object-icon">
              <User size={16} />
            </span>
            <div className="col" style={{ gap: 0, flex: 1 }}>
              <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
                <span className="fw-600">Lead</span>
                <span className="text-12 fg-muted cmp-mono">leads</span>
                <span
                  className="cmp-chip"
                  style={{ padding: "1px 6px", fontSize: "11px", fontWeight: 500 }}
                >
                  standard
                </span>
              </div>
              <div className="text-12 fg-muted">
                A person being contacted as part of an outreach campaign.
              </div>
            </div>
            <span className="text-12 fg-muted">
              {fields.length} {fields.length === 1 ? "field" : "fields"}
            </span>
          </div>

          {/* Fields list */}
          <div className="cmp-dm-list">
            <div className="cmp-dm-list-head">
              <span style={{ width: 32 }}></span>
              <span style={{ flex: "0 0 28px" }}></span>
              <span style={{ flex: 2 }}>Field</span>
              <span style={{ flex: 1 }}>Type</span>
              <span style={{ flex: 1.6 }}>Description</span>
              <span style={{ width: 36 }}></span>
            </div>

            {/* System fields — grouped into a single collapsible subsection row */}
            <SystemFieldsRow fields={systemFields} />

            {/* Draggable custom fields */}
            {listQ.isLoading && (
              <div style={{ padding: 16, color: "var(--muted-foreground)", fontSize: 13 }}>
                Loading…
              </div>
            )}
            {listQ.isError && (
              <div style={{ padding: 16, color: "var(--destructive)", fontSize: 13 }}>
                Failed to load fields.
              </div>
            )}
            {!listQ.isLoading && !listQ.isError && customFields.length === 0 && (
              <div
                style={{
                  padding: 16,
                  color: "var(--muted-foreground)",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                No custom lead fields configured yet.
              </div>
            )}
            {!listQ.isLoading && !listQ.isError && customFields.length > 0 && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={customFields.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {customFields.map((f) => (
                    <SortableFieldRow
                      key={f.id}
                      field={f}
                      onEdit={() => setEditingField(f)}
                      onDelete={() => {
                        if (!confirm(`Delete field "${f.label}"?`)) return;
                        deleteMut.mutate(f.id);
                      }}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}

            <button className="cmp-dm-add-row" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add field
            </button>
          </div>
        </div>
      </div>

      {adding ? (
        <AddFieldModal
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            qc.invalidateQueries({ queryKey: leadFieldsQueryKey });
          }}
          existing={fields}
        />
      ) : null}

      {editingField ? (
        <EditFieldModal
          field={editingField}
          onClose={() => setEditingField(null)}
          onSaved={() => {
            setEditingField(null);
            qc.invalidateQueries({ queryKey: leadFieldsQueryKey });
          }}
        />
      ) : null}
    </div>
  );
}

// ── Dropdown Row Menu ───────────────────────────────────────────────
function FieldRowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".row-menu") && !target.closest(".row-menu-trigger")) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="cmp-icon-btn row-menu-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={14} />
      </button>
      {open ? (
        <div className="row-menu" onClick={(e) => e.stopPropagation()} style={rowMenuStyle}>
          <button
            type="button"
            className="row-menu-item"
            style={rowMenuItemStyle}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <Pencil size={14} /> Edit field
          </button>
          <hr className="separator" style={{ margin: "4px 0" }} />
          <button
            type="button"
            className="row-menu-item row-menu-item-danger"
            style={{ ...rowMenuItemStyle, color: "var(--destructive)" }}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={14} /> Delete field
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Collapsible System Fields Section ────────────────────────────────
function SystemFieldsRow({ fields }: { fields: CampaignLeadField[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="cmp-dm-section">
      <button
        type="button"
        className="cmp-dm-section-head"
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center" }}
      >
        <ChevronRight
          className="cmp-dm-section-chev"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
          size={14}
        />
        <span
          className="cmp-dm-type-chip"
          style={{ color: "var(--muted-foreground)", marginLeft: 8 }}
        >
          <span className="cmp-dm-type-glyph">★</span>
        </span>
        <span className="fw-500 text-13" style={{ marginLeft: 8 }}>
          Lead
        </span>
        <span className="cmp-dm-lock" style={{ marginLeft: 8 }}>
          <Shield size={11} />
          <span>System</span>
        </span>
        <span className="text-12 fg-muted" style={{ marginLeft: "auto" }}>
          {fields.length} fields · cannot be edited or removed
        </span>
      </button>
      {open ? (
        <div className="cmp-dm-section-body">
          {fields.map((f) => {
            const t = FIELD_TYPES.find((t) => t.value === f.type) || FIELD_TYPES[0];
            return (
              <div key={f.id} className="cmp-dm-subrow">
                <span className="cmp-dm-type-chip" style={{ color: t.color }}>
                  <span className="cmp-dm-type-glyph">{t.glyph}</span>
                </span>
                <div className="col" style={{ gap: 2, flex: 2, minWidth: 0 }}>
                  <span className="fw-500 text-13">{f.label}</span>
                  <span className="cmp-mono text-11 fg-muted">{f.id}</span>
                </div>
                <span className="text-13" style={{ flex: 1 }}>
                  {t.label}
                </span>
                <span
                  className="text-12 fg-muted"
                  style={{
                    flex: 1.6,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.description}
                </span>
                <span className="cmp-dm-locked-icon" title="System field — cannot be modified">
                  <Shield size={14} />
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── Custom Field Row (Draggable sortable) ───────────────────────────
function SortableFieldRow({
  field,
  onEdit,
  onDelete,
}: {
  field: CampaignLeadField;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const t = FIELD_TYPES.find((t) => t.value === field.type) || FIELD_TYPES[0];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`cmp-dm-row ${isDragging ? "cmp-dm-row-dragging" : ""}`}
    >
      {/* Drag handle */}
      <span className="cmp-dm-drag" title="Drag to reorder" {...attributes} {...listeners}>
        <GripVertical size={14} />
      </span>

      {/* Type chip */}
      <span
        className="cmp-dm-type-chip"
        style={{
          color: t.color,
          borderColor: `color-mix(in oklch, ${t.color} 30%, var(--border))`,
        }}
      >
        <span className="cmp-dm-type-glyph">{t.glyph}</span>
      </span>

      {/* Name */}
      <div className="col" style={{ gap: 2, flex: 2, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="fw-500 text-13" style={{ whiteSpace: "nowrap" }}>
            {field.label}
          </span>
          {field.required && (
            <span className="cmp-dm-lock" style={{ padding: "0px 4px", fontSize: "10px" }}>
              required
            </span>
          )}
        </div>
        <span
          className="cmp-mono text-11 fg-muted"
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {field.id}
        </span>
      </div>

      {/* Type label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="text-13">{t.label}</span>
        {field.type === "select" && field.options ? (
          <div className="text-11 fg-muted" style={{ marginTop: 2 }}>
            {field.options.length} options
          </div>
        ) : null}
      </div>

      {/* Description */}
      <div style={{ flex: 1.6, minWidth: 0 }}>
        <span
          className="text-12 fg-muted"
          style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {field.description || ""}
        </span>
      </div>

      {/* Actions dropdown menu */}
      <div style={{ width: 36, textAlign: "right" }}>
        <FieldRowMenu onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

// ── Field Type Picker Grid ──────────────────────────────────────────
function FieldTypePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: LeadFieldType;
  onChange: (t: LeadFieldType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="cmp-field-type-grid">
      {FIELD_TYPES.filter((t) => t.value !== "identifier").map((t) => (
        <button
          key={t.value}
          type="button"
          className={`cmp-field-type-tile ${value === t.value ? "cmp-active" : ""}`}
          onClick={() => !disabled && onChange(t.value)}
          style={{
            opacity: disabled && value !== t.value ? 0.4 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <span className="cmp-field-type-glyph" style={{ color: t.color }}>
            {t.glyph}
          </span>
          <span className="text-13">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Add Field Modal ─────────────────────────────────────────────────
function AddFieldModal({
  onClose,
  onCreated,
  existing,
}: {
  onClose: () => void;
  onCreated: () => void;
  existing: CampaignLeadField[];
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!open) onClose();
  }, [onClose, open]);

  const [label, setLabel] = useState("");
  const [type, setType] = useState<LeadFieldType>("text");
  const [description, setDescription] = useState("");
  const [required] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [newOpt, setNewOpt] = useState("");

  const slug = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  const computedId = makeUniqueLeadFieldId(slug, existing);

  const createMut = useMutation({
    mutationFn: () => {
      const trimmedId = computedId.trim();
      const trimmedLabel = label.trim();
      if (!trimmedLabel) throw new Error("Label is required.");
      return leadFieldsApi.create({
        id: trimmedId.toLowerCase(),
        label: trimmedLabel,
        type,
        description: description.trim() || undefined,
        required,
        options: type === "select" || type === "multi" ? options : undefined,
      });
    },
    onSuccess: () => {
      showToast("Field created", "success");
      onCreated();
    },
    onError: (e: Error) => showToast(e.message || "Create failed", "error"),
  });

  const isSelect = type === "select" || type === "multi";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add field</DialogTitle>
          <DialogDescription>Create a new lead field.</DialogDescription>
        </DialogHeader>
        <div className="modal-body col col-gap-4">
          <div className="col">
            <label className="cmp-label" style={{ fontWeight: 600 }}>
              Field name
            </label>
            <input
              className="cmp-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Owner"
              autoFocus
            />
            {label && (
              <div className="text-11 fg-muted cmp-mono" style={{ marginTop: 4 }}>
                API name: {computedId}
              </div>
            )}
          </div>
          <div className="col">
            <label className="cmp-label" style={{ fontWeight: 600 }}>
              Field type
            </label>
            <FieldTypePicker value={type} onChange={setType} />
          </div>
          <div className="col">
            <label className="cmp-label" style={{ fontWeight: 600 }}>
              Description (optional)
            </label>
            <input
              className="cmp-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Help text shown to your team"
            />
          </div>
          {isSelect && (
            <div className="col">
              <label className="cmp-label" style={{ fontWeight: 600 }}>
                Options
              </label>
              <div className="col" style={{ gap: 6 }}>
                {options.map((opt, i) => (
                  <div key={i} className="constraint-row">
                    <span className="chip" style={{ padding: "1px 7px" }}>
                      {i + 1}
                    </span>
                    <span style={{ flex: 1 }}>{opt}</span>
                    <button
                      type="button"
                      className="cmp-icon-btn"
                      onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="cmp-input"
                    value={newOpt}
                    onChange={(e) => setNewOpt(e.target.value)}
                    placeholder="Add an option"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newOpt) {
                        setOptions((os) => [...os, newOpt]);
                        setNewOpt("");
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="cmp-btn cmp-btn-outline cmp-btn-sm"
                    onClick={() => {
                      if (newOpt) {
                        setOptions((os) => [...os, newOpt]);
                        setNewOpt("");
                      }
                    }}
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="flex justify-end space-x-2">
          <button
            type="button"
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cmp-btn cmp-btn-default cmp-btn-sm"
            disabled={!label || createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            <Plus size={14} /> Create field
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Field Modal ────────────────────────────────────────────────
function EditFieldModal({
  field,
  onClose,
  onSaved,
}: {
  field: CampaignLeadField;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [type, setType] = useState<LeadFieldType>(field.type);
  const [description, setDescription] = useState(field.description ?? "");
  const [required] = useState(field.required);
  const [options, setOptions] = useState<string[]>(field.options ?? []);
  const [newOpt, setNewOpt] = useState("");

  const saveMut = useMutation({
    mutationFn: () => {
      const trimmedLabel = label.trim();
      if (!trimmedLabel) throw new Error("Label is required.");
      return leadFieldsApi.update(field.id, {
        label: trimmedLabel,
        description: description.trim() || null,
        required,
        options: type === "select" || type === "multi" ? options : undefined,
      });
    },
    onSuccess: () => {
      showToast("Field updated", "success");
      onSaved();
    },
    onError: (e: Error) => showToast(e.message || "Update failed", "error"),
  });

  const isSelect = type === "select" || type === "multi";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Edit field</DialogTitle>
          <DialogDescription>
            Updates apply to the Leads table immediately. Existing data is preserved.
          </DialogDescription>
        </DialogHeader>
        <div className="modal-body col col-gap-4">
          <div className="col">
            <label className="cmp-label" style={{ fontWeight: 600 }}>
              Field name
            </label>
            <input
              className="cmp-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </div>

          <div className="col">
            <label className="cmp-label" style={{ fontWeight: 600 }}>
              Field type
            </label>
            <FieldTypePicker value={type} onChange={setType} disabled={true} />
          </div>

          <div className="col">
            <label className="cmp-label" style={{ fontWeight: 600 }}>
              Description (optional)
            </label>
            <input
              className="cmp-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Help text shown to your team"
            />
          </div>

          {isSelect ? (
            <div className="col">
              <label className="cmp-label" style={{ fontWeight: 600 }}>
                Options
              </label>
              <div className="col" style={{ gap: 6 }}>
                {options.map((opt, i) => (
                  <div key={i} className="constraint-row">
                    <span className="chip" style={{ padding: "1px 7px" }}>
                      {i + 1}
                    </span>
                    <input
                      className="cmp-input"
                      value={opt}
                      onChange={(e) =>
                        setOptions((os) => os.map((o, j) => (j === i ? e.target.value : o)))
                      }
                      style={{ height: 30, flex: 1, border: "none", boxShadow: "none", padding: 0 }}
                    />
                    <button
                      type="button"
                      className="cmp-icon-btn"
                      onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="cmp-input"
                    value={newOpt}
                    onChange={(e) => setNewOpt(e.target.value)}
                    placeholder="Add an option"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newOpt) {
                        setOptions((os) => [...os, newOpt]);
                        setNewOpt("");
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="cmp-btn cmp-btn-outline cmp-btn-sm"
                    onClick={() => {
                      if (newOpt) {
                        setOptions((os) => [...os, newOpt]);
                        setNewOpt("");
                      }
                    }}
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter className="flex justify-end space-x-2">
          <button type="button" className="cmp-btn cmp-btn-ghost cmp-btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="cmp-btn cmp-btn-default cmp-btn-sm"
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            <Check size={14} /> Save changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Concurrency Label Style ─────────────────────────────────────────
const fieldLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  fontWeight: 500,
  color: "var(--muted-foreground)",
};

const rowMenuStyle: CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 4px)",
  zIndex: 20,
  minWidth: 150,
  padding: 4,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--popover)",
  boxShadow: "var(--shadow-md)",
};

const rowMenuItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "7px 8px",
  border: 0,
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  color: "var(--popover-foreground)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  textAlign: "left",
};
