"use client";

// Lead-field configurator. Org-wide settings page for campaigns —
// list/create/edit/delete/reorder lead fields. Type is immutable after
// creation (API blocks it). System fields are draggable but undeleteable.

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { showToast } from "@/components/ui/Toast";
import { leadFields as leadFieldsApi, orgSettings as orgSettingsApi } from "@/lib/campaigns/client";
import type { CampaignLeadField, LeadFieldType } from "@/lib/campaigns/types";

const FIELD_TYPES: { value: LeadFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "multi", label: "Multi-select" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
  { value: "boolean", label: "Boolean" },
  { value: "currency", label: "Currency" },
  { value: "identifier", label: "Identifier" },
];

const SLUG_RE = /^[a-z][a-z0-9_]{0,63}$/i;

type ListResponse = { data: CampaignLeadField[] };

export default function CampaignSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const qc = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Campaign concurrency settings ──────────────────────────────────
  const settingsQ = useQuery({
    queryKey: ["orgSettings", "campaign"],
    queryFn: () => orgSettingsApi.get(),
  });
  const [calls, setCalls] = useState<string>("");
  const [wpm, setWpm] = useState<string>("");

  // Seed inputs once data arrives.
  useEffect(() => {
    if (settingsQ.data) {
      setCalls(String(settingsQ.data.campaign_max_concurrent_calls));
      setWpm(String(settingsQ.data.campaign_max_whatsapp_per_minute));
    }
  }, [settingsQ.data]);

  const concurrencyMut = useMutation({
    mutationFn: () => {
      const c = parseInt(calls, 10);
      const w = parseInt(wpm, 10);
      if (!Number.isFinite(c) || c < 1 || c > 500) throw new Error("Concurrent calls must be 1–500");
      if (!Number.isFinite(w) || w < 1 || w > 10000) throw new Error("WhatsApp/min must be 1–10 000");
      return orgSettingsApi.update({
        campaign_max_concurrent_calls: c,
        campaign_max_whatsapp_per_minute: w,
      });
    },
    onSuccess: () => {
      showToast("Campaign limits saved", "success");
      qc.invalidateQueries({ queryKey: ["orgSettings", "campaign"] });
    },
    onError: (e: Error) => showToast(e.message || "Save failed", "error"),
  });

  const listQ = useQuery({
    queryKey: ["leadFields"],
    queryFn: () => leadFieldsApi.list(),
  });

  const fields = useMemo(() => listQ.data?.data ?? [], [listQ.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => leadFieldsApi.reorder(ids),
    onSuccess: () => {
      showToast("Order saved", "success");
      qc.invalidateQueries({ queryKey: ["leadFields"] });
    },
    // onError is provided per-call (handleDragEnd) so it can rollback to
    // that call's snapshot.
  });

  function handleDragEnd(evt: DragEndEvent) {
    const { active, over } = evt;
    if (!over || active.id === over.id) return;

    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const snapshot = qc.getQueryData<ListResponse>(["leadFields"]);
    const next = arrayMove(fields, oldIndex, newIndex);
    qc.setQueryData<ListResponse>(["leadFields"], (old) =>
      old ? { ...old, data: next } : { data: next }
    );

    const ids = next.map((f) => f.id);
    // Cast to attach snapshot to mutation context — the onError reads it.
    reorderMut.mutate(ids, {
      onError: (e: Error) => {
        if (snapshot) qc.setQueryData(["leadFields"], snapshot);
        showToast(e.message || "Reorder failed", "error");
      },
    });
  }

  const deleteMut = useMutation({
    mutationFn: (id: string) => leadFieldsApi.delete(id),
    onSuccess: () => {
      showToast("Field deleted", "success");
      qc.invalidateQueries({ queryKey: ["leadFields"] });
    },
    onError: (e: Error) => showToast(e.message || "Delete failed", "error"),
  });

  return (
    <div className="cmp-page-pad">
      <div style={{ marginBottom: 12 }}>
        <Link
          href={`/dashboard/${orgId}/campaigns`}
          className="cmp-btn cmp-btn-ghost cmp-btn-sm"
          style={{ paddingLeft: 8 }}
        >
          <ChevronLeft size={14} /> All campaigns
        </Link>
      </div>

      <div className="cmp-page-actions-row">
        <div>
          <h1 className="cmp-page-heading">Settings</h1>
          <p className="cmp-page-subheading">
            Configure the fields used by every campaign in this org.
          </p>
        </div>
      </div>

      {/* Campaign concurrency card */}
      <section
        style={{
          marginTop: 24,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md, 8px)",
          padding: 20,
        }}
      >
        <h2 className="cmp-h2" style={{ marginBottom: 4 }}>Campaign</h2>
        <p className="cmp-page-subheading" style={{ marginBottom: 16 }}>
          Org-wide concurrency limits for all campaigns.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            concurrencyMut.mutate();
          }}
          style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <label style={fieldLabelStyle}>
            <span>Max concurrent calls</span>
            <input
              type="number"
              min={1}
              max={500}
              value={calls}
              onChange={(e) => setCalls(e.target.value)}
              disabled={settingsQ.isLoading}
              style={{ ...inputStyle, width: 130 }}
            />
          </label>
          <label style={fieldLabelStyle}>
            <span>Max WhatsApp / min</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={wpm}
              onChange={(e) => setWpm(e.target.value)}
              disabled={settingsQ.isLoading}
              style={{ ...inputStyle, width: 130 }}
            />
          </label>
          <button
            type="submit"
            className="cmp-btn cmp-btn-default cmp-btn-sm"
            disabled={concurrencyMut.isPending || settingsQ.isLoading}
            style={{ alignSelf: "flex-end" }}
          >
            {concurrencyMut.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      <section style={{ marginTop: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            margin: "24px 0 12px",
          }}
        >
          <h2 className="cmp-h2">Lead fields</h2>
          {!adding && (
            <button
              type="button"
              className="cmp-btn cmp-btn-default cmp-btn-sm"
              onClick={() => {
                setAdding(true);
                setEditingId(null);
              }}
            >
              <Plus size={14} /> Add field
            </button>
          )}
        </div>

        {adding && (
          <AddFieldForm
            onCancel={() => setAdding(false)}
            onCreated={() => {
              setAdding(false);
              qc.invalidateQueries({ queryKey: ["leadFields"] });
            }}
          />
        )}

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md, 8px)",
            overflow: "hidden",
            marginTop: 12,
          }}
        >
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
          {!listQ.isLoading && !listQ.isError && fields.length === 0 && (
            <div className="cmp-empty">No lead fields configured yet.</div>
          )}
          {!listQ.isLoading && !listQ.isError && fields.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={fields.map((f) => f.id)}
                strategy={verticalListSortingStrategy}
              >
                {fields.map((f) =>
                  editingId === f.id ? (
                    <EditFieldRow
                      key={f.id}
                      field={f}
                      onCancel={() => setEditingId(null)}
                      onSaved={() => {
                        setEditingId(null);
                        qc.invalidateQueries({ queryKey: ["leadFields"] });
                      }}
                    />
                  ) : (
                    <SortableFieldRow
                      key={f.id}
                      field={f}
                      onEdit={() => {
                        setEditingId(f.id);
                        setAdding(false);
                      }}
                      onDelete={() => {
                        if (!confirm(`Delete field "${f.label}"?`)) return;
                        deleteMut.mutate(f.id);
                      }}
                    />
                  )
                )}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────

function SortableFieldRow({
  field,
  onEdit,
  onDelete,
}: {
  field: CampaignLeadField;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`cmp-settings-row${isDragging ? " is-dragging" : ""}`}
    >
      <button
        type="button"
        className="cmp-settings-row-handle"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{field.label}</div>
        <div className="cmp-settings-id">{field.id}</div>
      </div>
      <span className="cmp-chip">{field.type}</span>
      <div style={{ display: "flex", gap: 6 }}>
        {field.required && <span className="cmp-chip">required</span>}
        {field.is_system && <span className="cmp-chip">system</span>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className="cmp-btn cmp-btn-ghost cmp-btn-sm"
          onClick={onEdit}
          aria-label="Edit field"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="cmp-btn cmp-btn-ghost cmp-btn-sm"
          onClick={onDelete}
          disabled={field.is_system}
          title={field.is_system ? "System fields cannot be deleted" : "Delete field"}
          aria-label="Delete field"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Add form ────────────────────────────────────────────────────────

function AddFieldForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<LeadFieldType>("text");
  const [description, setDescription] = useState("");
  const [required, setRequired] = useState(false);
  const [optionsCsv, setOptionsCsv] = useState("");

  const createMut = useMutation({
    mutationFn: () => {
      const trimmedId = id.trim();
      if (!SLUG_RE.test(trimmedId)) {
        throw new Error("Field id must be a slug: lowercase letters, digits, underscore.");
      }
      const trimmedLabel = label.trim();
      if (!trimmedLabel) throw new Error("Label is required.");
      const options =
        type === "select" || type === "multi"
          ? optionsCsv
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      return leadFieldsApi.create({
        id: trimmedId.toLowerCase(),
        label: trimmedLabel,
        type,
        description: description.trim() || undefined,
        required,
        options,
      });
    },
    onSuccess: () => {
      showToast("Field created", "success");
      onCreated();
    },
    onError: (e: Error) => showToast(e.message || "Create failed", "error"),
  });

  const needsOptions = type === "select" || type === "multi";

  return (
    <form
      className="cmp-settings-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        createMut.mutate();
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={fieldLabelStyle}>
          <span>Field id</span>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. job_title"
            required
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          <span>Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Job Title"
            required
            style={inputStyle}
          />
        </label>
      </div>
      <label style={fieldLabelStyle}>
        <span>Type</span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as LeadFieldType)}
          style={inputStyle}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label style={fieldLabelStyle}>
        <span>Description (optional)</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={inputStyle}
        />
      </label>
      {needsOptions && (
        <label style={fieldLabelStyle}>
          <span>Options (comma-separated)</span>
          <input
            type="text"
            value={optionsCsv}
            onChange={(e) => setOptionsCsv(e.target.value)}
            placeholder="e.g. small, medium, large"
            style={inputStyle}
          />
        </label>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
        />
        <span>Required</span>
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="cmp-btn cmp-btn-ghost cmp-btn-sm"
          onClick={onCancel}
        >
          <X size={14} /> Cancel
        </button>
        <button
          type="submit"
          className="cmp-btn cmp-btn-default cmp-btn-sm"
          disabled={createMut.isPending}
        >
          {createMut.isPending ? "Creating…" : "Create field"}
        </button>
      </div>
    </form>
  );
}

// ── Edit row ────────────────────────────────────────────────────────

function EditFieldRow({
  field,
  onCancel,
  onSaved,
}: {
  field: CampaignLeadField;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [description, setDescription] = useState(field.description ?? "");
  const [required, setRequired] = useState(field.required);
  const [optionsCsv, setOptionsCsv] = useState((field.options ?? []).join(", "));

  const needsOptions = field.type === "select" || field.type === "multi";

  const saveMut = useMutation({
    mutationFn: () => {
      const trimmedLabel = label.trim();
      if (!trimmedLabel) throw new Error("Label is required.");
      const options = needsOptions
        ? optionsCsv
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      return leadFieldsApi.update(field.id, {
        label: trimmedLabel,
        description: description.trim() || null,
        required,
        ...(options !== undefined ? { options } : {}),
      });
    },
    onSuccess: () => {
      showToast("Field updated", "success");
      onSaved();
    },
    onError: (e: Error) => showToast(e.message || "Update failed", "error"),
  });

  return (
    <form
      className="cmp-settings-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        saveMut.mutate();
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={fieldLabelStyle}>
          <span>Field id</span>
          <input type="text" value={field.id} disabled style={inputStyle} />
        </label>
        <label style={fieldLabelStyle}>
          <span>Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            style={inputStyle}
          />
        </label>
      </div>
      <label style={fieldLabelStyle} title="Type cannot be changed after creation">
        <span>Type</span>
        <div style={{ position: "relative", cursor: "not-allowed" }}>
          <select value={field.type} disabled style={{ ...inputStyle, backgroundColor: "var(--muted)", color: "var(--muted-foreground)", opacity: 0.65, pointerEvents: "none", width: "100%" }}>
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </label>
      <label style={fieldLabelStyle}>
        <span>Description (optional)</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={inputStyle}
        />
      </label>
      {needsOptions && (
        <label style={fieldLabelStyle}>
          <span>Options (comma-separated)</span>
          <input
            type="text"
            value={optionsCsv}
            onChange={(e) => setOptionsCsv(e.target.value)}
            style={inputStyle}
          />
        </label>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
        />
        <span>Required</span>
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="cmp-btn cmp-btn-ghost cmp-btn-sm"
          onClick={onCancel}
        >
          <X size={14} /> Cancel
        </button>
        <button
          type="submit"
          className="cmp-btn cmp-btn-default cmp-btn-sm"
          disabled={saveMut.isPending}
        >
          {saveMut.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

// ── Local inline styles for form fields ─────────────────────────────

const fieldLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  fontWeight: 500,
  color: "var(--muted-foreground)",
};

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--background)",
  color: "var(--foreground)",
  fontFamily: "inherit",
};
