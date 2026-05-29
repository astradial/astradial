"use client";

// Studio Editor — exact reproduction of
// Astra Campaign-handoff/app/screens/studio.jsx#StudioEditorScreen.
// Layout, classes, drag/drop behaviour, and mutators per
// editor/components/campaigns/UI.md §9 and §9.15.

import {
  Check,
  ChevronLeft,
  File as FileIcon,
  MessageCircle,
  Phone,
  Play,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { showToast } from "@/components/ui/Toast";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { templates, whatsappTemplates, type WhatsAppTemplateMeta } from "@/lib/campaigns/client";
import type {
  ActionType,
  CampaignTemplate,
  Workflow,
  WorkflowAction,
  WorkflowDay,
} from "@/lib/campaigns/types";

// ── Action-type accent palette (verbatim from app/data.jsx) ──────
const ACTION_TYPES = {
  whatsapp: {
    short: "WhatsApp",
    label: "WhatsApp message",
    sub: "Template-based",
    accent: "oklch(0.55 0.16 150)",      // green
    accentSoft: "oklch(0.94 0.06 150)",
    cssVar: "--accent-wa",
  },
  call: {
    short: "Phone call",
    label: "Phone call",
    sub: "Voice + caller ID",
    accent: "oklch(0.5 0.22 264)",       // primary blue
    accentSoft: "oklch(0.95 0.05 264)",
    cssVar: "--accent-call",
  },
} as const;

// Bubble style per handoff: transparent bg, accent applied as `color` so
// the icon picks up the brand colour. CSS-var fallback lets a theme override.
function bubbleColor(type: ActionType): React.CSSProperties {
  const def = ACTION_TYPES[type];
  return { color: `var(${def.cssVar}, ${def.accent})` };
}

function ActionIcon({ type, size = 14 }: { type: ActionType; size?: number }) {
  return type === "whatsapp" ? (
    <MessageCircle size={size} strokeWidth={2.4} />
  ) : (
    <Phone size={size} strokeWidth={2.4} />
  );
}

function GripGlyph() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden="true">
      {[0, 1, 2].map((r) =>
        [0, 1].map((c) => (
          <circle
            key={`${r}-${c}`}
            cx={c === 0 ? 2.5 : 7.5}
            cy={2 + r * 5}
            r="1.2"
            fill="currentColor"
          />
        ))
      )}
    </svg>
  );
}

function actionSummary(a: WorkflowAction): string {
  if (a.type === "whatsapp") return a.template || "no template";
  return a.script || "no script";
}

function makeAction(type: ActionType): WorkflowAction {
  const id = "a_" + Math.random().toString(36).slice(2, 8);
  if (type === "whatsapp") return { id, type, template: "", namespace: "" };
  return { id, type, script: "", callerId: "" };
}
function makeDay(initial: WorkflowAction | null, gap = 2): WorkflowDay {
  return {
    id: "d_" + Math.random().toString(36).slice(2, 8),
    gap,
    actions: initial ? [initial] : [],
  };
}

function computeDayNumbers(days: WorkflowDay[]): number[] {
  let cumulative = 1;
  return days.map((d, i) => {
    if (i === 0) return 1;
    cumulative += Math.max(1, d.gap || 1);
    return cumulative;
  });
}

// ── Drag payload + hover types ────────────────────────────────────
type DragPayload =
  | { kind: "palette"; actionType: ActionType }
  | { kind: "day"; dayIdx: number; dayId: string }
  | { kind: "action"; dayId: string; actionIdx: number; actionId: string };

type HoverState =
  | { kind: "gap"; idx: number }
  | { kind: "day"; dayId: string }
  | { kind: "actionGap"; dayId: string; idx: number }
  | null;

// =================================================================
// Page
// =================================================================

export default function StudioEditorPage() {
  const { orgId, templateId } = useParams<{ orgId: string; templateId: string }>();
  const router = useRouter();

  const [tpl, setTpl] = useState<CampaignTemplate | null>(null);
  const [workflow, setWorkflow] = useState<Workflow>({ meta: {}, days: [] });
  const [name, setName] = useState("");
  const [selection, setSelection] = useState<{ dayId: string; actionId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hover, setHover] = useState<HoverState>(null);

  const dragRef = useRef<DragPayload | null>(null);
  const dirtySnapshot = useRef("");

  // Load template
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  async function load() {
    setLoading(true);
    try {
      const t = await templates.get(templateId);
      setTpl(t);
      setName(t.name);
      const wf: Workflow =
        t.workflow && Array.isArray(t.workflow.days)
          ? t.workflow
          : { meta: { name: t.name }, days: [] };
      setWorkflow(wf);
      dirtySnapshot.current = JSON.stringify({ name: t.name, workflow: wf });
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
    setLoading(false);
  }

  const dirty = useMemo(
    () => JSON.stringify({ name, workflow }) !== dirtySnapshot.current,
    [name, workflow]
  );

  // ── Mutators (UI.md §9.15) ──────────────────────────────────────
  const addActionToDay = useCallback((dayId: string, type: ActionType) => {
    const action = makeAction(type);
    setWorkflow((w) => ({
      ...w,
      days: w.days.map((d) => (d.id === dayId ? { ...d, actions: [...d.actions, action] } : d)),
    }));
    setSelection({ dayId, actionId: action.id });
  }, []);

  const insertDayAt = useCallback((index: number, type: ActionType) => {
    const action = makeAction(type);
    const day = makeDay(action, index === 0 ? 0 : 2);
    setWorkflow((w) => {
      const days = [...w.days];
      days.splice(index, 0, day);
      if (days[0]) days[0] = { ...days[0], gap: 0 };
      return { ...w, days };
    });
    setSelection({ dayId: day.id, actionId: action.id });
  }, []);

  const moveDay = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx === toIdx - 1) return;
    setWorkflow((w) => {
      const days = [...w.days];
      const [moved] = days.splice(fromIdx, 1);
      const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
      days.splice(adjustedTo, 0, moved);
      if (days[0]) days[0] = { ...days[0], gap: 0 };
      return { ...w, days };
    });
  }, []);

  const moveActionWithinDay = useCallback((dayId: string, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx === toIdx - 1) return;
    setWorkflow((w) => ({
      ...w,
      days: w.days.map((d) => {
        if (d.id !== dayId) return d;
        const actions = [...d.actions];
        const [moved] = actions.splice(fromIdx, 1);
        const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
        actions.splice(adjustedTo, 0, moved);
        return { ...d, actions };
      }),
    }));
  }, []);

  const updateAction = useCallback(
    (dayId: string, actionId: string, patch: Partial<WorkflowAction>) => {
      setWorkflow((w) => ({
        ...w,
        days: w.days.map((d) =>
          d.id !== dayId
            ? d
            : {
                ...d,
                actions: d.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)),
              }
        ),
      }));
    },
    []
  );

  const updateGap = useCallback((dayId: string, gap: number) => {
    setWorkflow((w) => ({
      ...w,
      days: w.days.map((d) => (d.id === dayId ? { ...d, gap: Math.max(1, Number(gap) || 1) } : d)),
    }));
  }, []);

  const deleteAction = useCallback((dayId: string, actionId: string) => {
    setWorkflow((w) => ({
      ...w,
      days: w.days
        .map((d) =>
          d.id !== dayId ? d : { ...d, actions: d.actions.filter((a) => a.id !== actionId) }
        )
        .filter((d) => d.actions.length > 0),
    }));
    setSelection(null);
  }, []);

  const deleteDay = useCallback((dayId: string) => {
    setWorkflow((w) => ({ ...w, days: w.days.filter((d) => d.id !== dayId) }));
    setSelection(null);
  }, []);

  // ── Drag plumbing ───────────────────────────────────────────────
  const onDragStart = useCallback(
    (payload: DragPayload) => (e: React.DragEvent) => {
      dragRef.current = payload;
      e.dataTransfer.effectAllowed = payload.kind === "palette" ? "copy" : "move";
      try {
        e.dataTransfer.setData("text/plain", payload.kind);
      } catch {
        /* ignore */
      }
    },
    []
  );
  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    setHover(null);
  }, []);
  const isPaletteDrag = () => dragRef.current?.kind === "palette";
  const isDayDrag = () => dragRef.current?.kind === "day";
  const isActionDrag = () => dragRef.current?.kind === "action";

  // ── Save / publish ──────────────────────────────────────────────
  async function handleSave(publishAfter = false) {
    if (!tpl) return;
    setSaving(true);
    try {
      const next = await templates.update(tpl.id, {
        name: name.trim(),
        workflow,
      });
      dirtySnapshot.current = JSON.stringify({ name: next.name, workflow });
      if (publishAfter) {
        const pub = await templates.publish(tpl.id);
        showToast(`Published v${pub.version}`, "success");
        router.replace(`/dashboard/${orgId}/campaigns/studio`);
        router.refresh();
        return;
      } else {
        setTpl(next);
        showToast("Saved", "success");
      }
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
    setSaving(false);
  }

  if (loading || !tpl) {
    return <div className="p-6 text-muted-foreground">Loading template…</div>;
  }

  const dayNumbers = computeDayNumbers(workflow.days);

  return (
    <div className="cmp-studio-shell" onDragEnd={onDragEnd}>
      {/* Top toolbar */}
      <div className="cmp-flow-toolbar">
        <div className="cmp-flow-toolbar-group">
          <button
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            onClick={() => router.push(`/dashboard/${orgId}/campaigns/studio`)}
          >
            <ChevronLeft /> Back
          </button>
          <div className="cmp-toolbar-sep" />
          <div className="cmp-flow-breadcrumb">
            <FileIcon />
            <span className="text-muted-foreground text-sm">Studio /</span>
            <input
              className="cmp-template-name-input"
              value={name}
              placeholder="Untitled template"
              onChange={(e) => setName(e.target.value)}
              size={Math.max(8, (name || "Untitled template").length)}
            />
            <span className="cmp-version-badge">
              v{tpl.version} · {tpl.status}
            </span>
          </div>
        </div>
        <div className="cmp-flow-toolbar-group">
          <button
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            disabled
            title="Undo (not yet wired)"
          >
            <Undo2 />
          </button>
          <button
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            disabled
            title="Redo (not yet wired)"
          >
            <Redo2 />
          </button>
          <div className="cmp-toolbar-sep" />
          <button
            className="cmp-btn cmp-btn-sm"
            style={{
              background: "var(--background)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            }}
            disabled
            title="Test run coming soon"
          >
            <Play /> Test run
          </button>
          <button
            className="cmp-btn cmp-btn-default cmp-btn-sm"
            disabled={saving || workflow.days.length === 0 || !dirty}
            onClick={() => handleSave(true)}
          >
            <Upload /> {saving ? "Saving…" : "Publish"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="cmp-editor-body">
        <Palette onDragStart={onDragStart} />

        <WorkflowCanvas
          workflow={workflow}
          dayNumbers={dayNumbers}
          selection={selection}
          setSelection={setSelection}
          hover={hover}
          setHover={setHover}
          dragRef={dragRef}
          onDragStart={onDragStart}
          isPaletteDrag={isPaletteDrag}
          isDayDrag={isDayDrag}
          isActionDrag={isActionDrag}
          insertDayAt={insertDayAt}
          addActionToDay={addActionToDay}
          moveDay={moveDay}
          moveActionWithinDay={moveActionWithinDay}
          updateGap={updateGap}
          deleteAction={deleteAction}
          deleteDay={deleteDay}
        />

        <Inspector
          workflow={workflow}
          selection={selection}
          updateAction={updateAction}
          deleteAction={deleteAction}
          onClose={() => setSelection(null)}
        />
      </div>

      {/* Save-pending indicator */}
      {dirty && (
        <div
          style={{
            position: "fixed",
            bottom: 18,
            right: 24,
            zIndex: 40,
          }}
        >
          <button
            className="cmp-btn cmp-btn-default cmp-btn-sm"
            onClick={() => handleSave(false)}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}

// =================================================================
// Palette
// =================================================================

function Palette({
  onDragStart,
}: {
  onDragStart: (p: DragPayload) => (e: React.DragEvent) => void;
}) {
  return (
    <aside className="cmp-palette">
      <div className="cmp-palette-head">
        <div className="cmp-palette-title">Actions</div>
        <div className="cmp-palette-hint">Drag onto canvas</div>
      </div>
      <div className="cmp-palette-stack">
        <PaletteCard type="whatsapp" onDragStart={onDragStart} />
        <PaletteCard type="call" onDragStart={onDragStart} />
      </div>
      <div className="cmp-palette-rule">
        <div className="cmp-palette-rule-dot" />
        <div>
          <div className="cmp-palette-rule-title">Auto-stops on reply</div>
          <div className="cmp-palette-rule-body">
            The workflow halts the moment a lead shows interest.
          </div>
        </div>
      </div>
    </aside>
  );
}

function PaletteCard({
  type,
  onDragStart,
}: {
  type: ActionType;
  onDragStart: (p: DragPayload) => (e: React.DragEvent) => void;
}) {
  const def = ACTION_TYPES[type];
  return (
    <div
      className="cmp-palette-card"
      draggable
      onDragStart={onDragStart({ kind: "palette", actionType: type })}
    >
      <span className="cmp-palette-bubble" style={bubbleColor(type)}>
        <ActionIcon type={type} size={18} />
      </span>
      <div>
        <div className="cmp-palette-card-title">{def.short}</div>
        <div className="cmp-palette-card-sub">{def.sub}</div>
      </div>
      <span className="cmp-palette-grip" aria-hidden="true">
        ⋮⋮
      </span>
    </div>
  );
}

// =================================================================
// Canvas
// =================================================================

interface CanvasProps {
  workflow: Workflow;
  dayNumbers: number[];
  selection: { dayId: string; actionId: string } | null;
  setSelection: React.Dispatch<React.SetStateAction<{ dayId: string; actionId: string } | null>>;
  hover: HoverState;
  setHover: React.Dispatch<React.SetStateAction<HoverState>>;
  dragRef: React.MutableRefObject<DragPayload | null>;
  onDragStart: (p: DragPayload) => (e: React.DragEvent) => void;
  isPaletteDrag: () => boolean;
  isDayDrag: () => boolean;
  isActionDrag: () => boolean;
  insertDayAt: (idx: number, t: ActionType) => void;
  addActionToDay: (dayId: string, t: ActionType) => void;
  moveDay: (from: number, to: number) => void;
  moveActionWithinDay: (dayId: string, from: number, to: number) => void;
  updateGap: (dayId: string, gap: number) => void;
  deleteAction: (dayId: string, actionId: string) => void;
  deleteDay: (dayId: string) => void;
}

function WorkflowCanvas(props: CanvasProps) {
  const {
    workflow,
    dayNumbers,
    selection,
    setSelection,
    hover,
    setHover,
    dragRef,
    isPaletteDrag,
    isDayDrag,
    isActionDrag,
    onDragStart,
    insertDayAt,
    addActionToDay,
    moveDay,
    moveActionWithinDay,
    updateGap,
    deleteAction,
    deleteDay,
  } = props;

  const gapDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const dr = dragRef.current;
    setHover(null);
    if (!dr) return;
    if (dr.kind === "palette") insertDayAt(idx, dr.actionType);
    else if (dr.kind === "day") moveDay(dr.dayIdx, idx);
  };

  const dayDrop = (dayId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const dr = dragRef.current;
    setHover(null);
    if (!dr) return;
    if (dr.kind === "palette") addActionToDay(dayId, dr.actionType);
  };

  return (
    <div className="cmp-canvas-wrap" onClick={() => setSelection(null)}>
      <div className="cmp-canvas-stage">
        <StartCap />
        <ConnectorLine
          length={64}
          hover={hover?.kind === "gap" && hover.idx === 0}
          onDragOver={(e) => {
            if (isPaletteDrag() || isDayDrag()) {
              e.preventDefault();
              setHover({ kind: "gap", idx: 0 });
            }
          }}
          onDragLeave={() => setHover((h) => (h?.kind === "gap" && h.idx === 0 ? null : h))}
          onDrop={gapDrop(0)}
          isFirst
        />

        {workflow.days.length === 0 ? (
          <EmptyState onPick={(t) => insertDayAt(0, t)} />
        ) : (
          workflow.days.map((day, idx) => (
            <React.Fragment key={day.id}>
              <DayNode
                day={day}
                dayIdx={idx}
                dayNumber={dayNumbers[idx]}
                selection={selection}
                setSelection={setSelection}
                hover={hover}
                setHover={setHover}
                isPaletteDrag={isPaletteDrag}
                isActionDrag={isActionDrag}
                dragRef={dragRef}
                onDragStart={onDragStart}
                onDropAdd={dayDrop(day.id)}
                moveActionWithinDay={moveActionWithinDay}
                deleteAction={deleteAction}
                deleteDay={deleteDay}
              />
              {idx < workflow.days.length - 1 && (
                <GapEditor
                  length={64}
                  gap={workflow.days[idx + 1].gap}
                  onChange={(g) => updateGap(workflow.days[idx + 1].id, g)}
                  hover={hover?.kind === "gap" && hover.idx === idx + 1}
                  onDragOver={(e) => {
                    if (isPaletteDrag() || isDayDrag()) {
                      e.preventDefault();
                      setHover({ kind: "gap", idx: idx + 1 });
                    }
                  }}
                  onDragLeave={() =>
                    setHover((h) => (h?.kind === "gap" && h.idx === idx + 1 ? null : h))
                  }
                  onDrop={gapDrop(idx + 1)}
                />
              )}
            </React.Fragment>
          ))
        )}

        <ConnectorLine
          length={28}
          hover={hover?.kind === "gap" && hover.idx === workflow.days.length}
          onDragOver={(e) => {
            if (isPaletteDrag() || isDayDrag()) {
              e.preventDefault();
              setHover({ kind: "gap", idx: workflow.days.length });
            }
          }}
          onDragLeave={() =>
            setHover((h) => (h?.kind === "gap" && h.idx === workflow.days.length ? null : h))
          }
          onDrop={gapDrop(workflow.days.length)}
        />

        {workflow.days.length > 0 && (
          <>
            <AddStepButton onPick={(t) => insertDayAt(workflow.days.length, t)} />
            <div className="cmp-connector" style={{ height: 28 }}>
              <div className="cmp-connector-line" />
            </div>
          </>
        )}

        <EndCap />
      </div>
    </div>
  );
}

function StartCap() {
  return (
    <div className="cmp-cap">
      <span className="cmp-cap-dot">
        <Play size={12} fill="currentColor" />
      </span>
      <div className="cmp-cap-text">
        <div className="cmp-cap-title">Lead enters campaign</div>
        <div className="cmp-cap-sub">Trigger</div>
      </div>
    </div>
  );
}
function EndCap() {
  return (
    <div className="cmp-cap">
      <span className="cmp-cap-dot cmp-cap-dot-end">
        <Check size={12} strokeWidth={3} />
      </span>
      <div className="cmp-cap-text">
        <div className="cmp-cap-title">Lead shows interest</div>
        <div className="cmp-cap-sub">Workflow stops · Status modified as success</div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (t: ActionType) => void }) {
  return (
    <div className="cmp-empty-state">
      <div className="cmp-empty-state-eyebrow">Start your cadence</div>
      <h2 className="cmp-empty-state-title">What&apos;s the first thing that should happen?</h2>
      <p className="cmp-empty-state-sub">
        Pick the action that fires when a lead enters this campaign. You can add more steps after.
      </p>
      <div className="cmp-empty-state-choices">
        <button
          className="cmp-empty-choice"
          onClick={(e) => {
            e.stopPropagation();
            onPick("whatsapp");
          }}
        >
          <span className="cmp-empty-choice-icon" style={bubbleColor("whatsapp")}>
            <MessageCircle size={20} strokeWidth={2.4} />
          </span>
          <div className="cmp-empty-choice-title">Send a WhatsApp</div>
          <div className="cmp-empty-choice-sub">
            Template-based message · the most common first touch
          </div>
        </button>
        <button
          className="cmp-empty-choice"
          onClick={(e) => {
            e.stopPropagation();
            onPick("call");
          }}
        >
          <span className="cmp-empty-choice-icon" style={bubbleColor("call")}>
            <Phone size={20} strokeWidth={2.4} />
          </span>
          <div className="cmp-empty-choice-title">Make a phone call</div>
          <div className="cmp-empty-choice-sub">Voice agent + caller ID · best for warm leads</div>
        </button>
      </div>
      <div className="cmp-empty-state-hint">
        <span className="cmp-empty-state-hint-dot" />
        You can also drag actions from the left palette.
      </div>
    </div>
  );
}

function ConnectorLine({
  length,
  hover,
  onDragOver,
  onDragLeave,
  onDrop,
  isFirst,
}: {
  length: number;
  hover?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  isFirst?: boolean;
}) {
  return (
    <div
      className={`cmp-connector ${hover ? "cmp-connector-hover" : ""}`}
      style={{ height: length }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="cmp-connector-line" />
      {hover && (
        <div className="cmp-connector-dropchip">Drop to {isFirst ? "insert at top" : "add"}</div>
      )}
    </div>
  );
}

function GapEditor({
  length,
  gap,
  onChange,
  hover,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  length: number;
  gap: number;
  onChange: (g: number) => void;
  hover?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(gap));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setVal(String(gap)), [gap]);
  const commit = () => {
    setEditing(false);
    onChange(Number(val) || 1);
  };
  return (
    <div
      className={`cmp-gap ${hover ? "cmp-gap-hover" : ""}`}
      style={{ minHeight: length }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cmp-connector-line" />
      {editing ? (
        <div className="cmp-gap-pill cmp-gap-pill-editing">
          <span className="cmp-gap-pill-prefix">+</span>
          <input
            className="cmp-gap-input"
            type="number"
            min={1}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setEditing(false);
                setVal(String(gap));
              }
            }}
            autoFocus
          />
          <span className="cmp-gap-pill-suffix">{Number(val) === 1 ? "day" : "days"}</span>
        </div>
      ) : (
        <button className="cmp-gap-pill" onClick={() => setEditing(true)}>
          + {gap} {gap === 1 ? "day" : "days"}
          <span className="cmp-gap-pill-edit-hint">edit</span>
        </button>
      )}
      {hover && <div className="cmp-connector-dropchip">Drop to insert a new step here</div>}
    </div>
  );
}

// =================================================================
// Day node
// =================================================================

interface DayProps {
  day: WorkflowDay;
  dayIdx: number;
  dayNumber: number;
  selection: { dayId: string; actionId: string } | null;
  setSelection: React.Dispatch<React.SetStateAction<{ dayId: string; actionId: string } | null>>;
  hover: HoverState;
  setHover: React.Dispatch<React.SetStateAction<HoverState>>;
  isPaletteDrag: () => boolean;
  isActionDrag: () => boolean;
  dragRef: React.MutableRefObject<DragPayload | null>;
  onDragStart: (p: DragPayload) => (e: React.DragEvent) => void;
  onDropAdd: (e: React.DragEvent) => void;
  moveActionWithinDay: (dayId: string, from: number, to: number) => void;
  deleteAction: (dayId: string, actionId: string) => void;
  deleteDay: (dayId: string) => void;
}

function DayNode({
  day,
  dayIdx,
  dayNumber,
  selection,
  setSelection,
  hover,
  setHover,
  isPaletteDrag,
  isActionDrag,
  dragRef,
  onDragStart,
  onDropAdd,
  moveActionWithinDay,
  deleteAction,
  deleteDay,
}: DayProps) {
  const isDropTargetDay = hover?.kind === "day" && hover.dayId === day.id;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      className={`cmp-day-node ${isDropTargetDay ? "cmp-day-node-droptarget" : ""}`}
      onClick={stop}
      onDragOver={(e) => {
        if (isPaletteDrag()) {
          e.preventDefault();
          setHover({ kind: "day", dayId: day.id });
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setHover((h) => (h?.kind === "day" && h.dayId === day.id ? null : h));
      }}
      onDrop={onDropAdd}
    >
      <div
        className="cmp-day-grip"
        draggable
        onDragStart={onDragStart({ kind: "day", dayIdx, dayId: day.id })}
        title="Drag to reorder"
      >
        <GripGlyph />
      </div>

      <div className="cmp-day-head">
        <div className="cmp-day-pill">DAY {dayNumber}</div>
        <div className="cmp-day-pill-sub">
          {dayIdx === 0
            ? "fires when lead enters"
            : `${day.gap} day${day.gap === 1 ? "" : "s"} after the previous step`}
        </div>
        <button className="cmp-day-delete" onClick={() => deleteDay(day.id)} title="Delete day">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="cmp-action-list">
        {day.actions.map((action, aIdx) => (
          <React.Fragment key={action.id}>
            <ActionDropLine
              hover={hover?.kind === "actionGap" && hover.dayId === day.id && hover.idx === aIdx}
              onDragOver={(e) => {
                if (
                  isActionDrag() &&
                  dragRef.current?.kind === "action" &&
                  dragRef.current.dayId === day.id
                ) {
                  e.preventDefault();
                  setHover({ kind: "actionGap", dayId: day.id, idx: aIdx });
                }
              }}
              onDragLeave={() =>
                setHover((h) =>
                  h?.kind === "actionGap" && h.dayId === day.id && h.idx === aIdx ? null : h
                )
              }
              onDrop={(e) => {
                e.preventDefault();
                const dr = dragRef.current;
                setHover(null);
                if (dr?.kind === "action" && dr.dayId === day.id) {
                  moveActionWithinDay(day.id, dr.actionIdx, aIdx);
                }
              }}
            />
            <ActionRow
              action={action}
              actionIdx={aIdx}
              dayId={day.id}
              selected={selection?.actionId === action.id}
              onSelect={() => setSelection({ dayId: day.id, actionId: action.id })}
              onDelete={() => deleteAction(day.id, action.id)}
              onDragStart={onDragStart({
                kind: "action",
                dayId: day.id,
                actionIdx: aIdx,
                actionId: action.id,
              })}
            />
          </React.Fragment>
        ))}
        <ActionDropLine
          hover={
            hover?.kind === "actionGap" &&
            hover.dayId === day.id &&
            hover.idx === day.actions.length
          }
          onDragOver={(e) => {
            if (
              isActionDrag() &&
              dragRef.current?.kind === "action" &&
              dragRef.current.dayId === day.id
            ) {
              e.preventDefault();
              setHover({ kind: "actionGap", dayId: day.id, idx: day.actions.length });
            }
          }}
          onDragLeave={() =>
            setHover((h) =>
              h?.kind === "actionGap" && h.dayId === day.id && h.idx === day.actions.length
                ? null
                : h
            )
          }
          onDrop={(e) => {
            e.preventDefault();
            const dr = dragRef.current;
            setHover(null);
            if (dr?.kind === "action" && dr.dayId === day.id) {
              moveActionWithinDay(day.id, dr.actionIdx, day.actions.length);
            }
          }}
        />
        <button className="cmp-action-add-row" onClick={(e) => e.stopPropagation()}>
          <Plus size={12} /> Drag an action here, or pick from the left
        </button>
      </div>
    </div>
  );
}

function ActionRow({
  action,
  actionIdx,
  selected,
  onSelect,
  onDelete,
  onDragStart,
}: {
  action: WorkflowAction;
  actionIdx: number;
  dayId: string;
  selected?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const def = ACTION_TYPES[action.type];
  return (
    <div
      className={`cmp-action-row ${selected ? "cmp-action-row-selected" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      draggable
      onDragStart={onDragStart}
    >
      <span className="cmp-action-grip" aria-hidden="true">
        <GripGlyph />
      </span>
      <span className="cmp-action-index">{actionIdx + 1}</span>
      <span className="cmp-action-bubble" style={bubbleColor(action.type)}>
        <ActionIcon type={action.type} size={14} />
      </span>
      <div className="cmp-action-text">
        <div className="cmp-action-name">{def.short}</div>
        <div className="cmp-action-meta">{actionSummary(action)}</div>
      </div>
      <button
        className="cmp-action-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Remove"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function ActionDropLine({
  hover,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  hover?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={`cmp-action-dropline ${hover ? "cmp-action-dropline-hover" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    />
  );
}

// =================================================================
// Add-step pill (between last day and EndCap)
// =================================================================

function AddStepButton({ onPick }: { onPick: (t: ActionType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="cmp-add-step-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        className={`cmp-add-step-pill ${open ? "cmp-add-step-pill-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={13} /> Add step
      </button>
      {open && (
        <div className="cmp-add-step-menu">
          <button
            className="cmp-row-menu-item"
            onClick={() => {
              onPick("whatsapp");
              setOpen(false);
            }}
          >
            <span className="cmp-action-bubble-mini" style={bubbleColor("whatsapp")}>
              <MessageCircle size={12} strokeWidth={2.4} />
            </span>
            <div>
              <div className="text-[13px] font-medium">WhatsApp message</div>
              <div className="text-[11px] text-muted-foreground">Template-based</div>
            </div>
          </button>
          <button
            className="cmp-row-menu-item"
            onClick={() => {
              onPick("call");
              setOpen(false);
            }}
          >
            <span className="cmp-action-bubble-mini" style={bubbleColor("call")}>
              <Phone size={12} strokeWidth={2.4} />
            </span>
            <div>
              <div className="text-[13px] font-medium">Phone call</div>
              <div className="text-[11px] text-muted-foreground">Voice + caller ID</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

// =================================================================
// Inspector (right rail)
// =================================================================

function Inspector({
  workflow,
  selection,
  updateAction,
  deleteAction,
  onClose,
}: {
  workflow: Workflow;
  selection: { dayId: string; actionId: string } | null;
  updateAction: (dayId: string, actionId: string, patch: Partial<WorkflowAction>) => void;
  deleteAction: (dayId: string, actionId: string) => void;
  onClose: () => void;
}) {
  const [waTemplates, setWaTemplates] = useState<WhatsAppTemplateMeta[]>([]);
  const [waLoading, setWaLoading] = useState(false);
  const [waConfigured, setWaConfigured] = useState(true);

  useEffect(() => {
    if (!selection) return;
    const d = workflow.days.find((dd) => dd.id === selection.dayId);
    const a = d?.actions.find((aa) => aa.id === selection.actionId);
    if (a?.type !== "whatsapp") return;
    let cancelled = false;
    setWaLoading(true);
    whatsappTemplates
      .list()
      .then((res) => {
        if (cancelled) return;
        setWaTemplates(res.templates || []);
        setWaConfigured(res.configured);
      })
      .catch(() => {
        if (cancelled) return;
        setWaConfigured(false);
      })
      .finally(() => {
        if (!cancelled) setWaLoading(false);
      });
    return () => { cancelled = true; };
  }, [selection, workflow.days]);

  if (!selection) return null;
  const day = workflow.days.find((d) => d.id === selection.dayId);
  const action = day?.actions.find((a) => a.id === selection.actionId);
  if (!day || !action) return null;
  const def = ACTION_TYPES[action.type];

  return (
    <aside className="cmp-editor-inspector">
      <div className="cmp-inspector-head-row">
        <div className="cmp-kicker">{def.short.toUpperCase()}</div>
        <button className="cmp-icon-btn" onClick={onClose} aria-label="Close inspector">
          <X size={14} />
        </button>
      </div>
      <div className="cmp-inspector-title">Configure {def.short.toLowerCase()}</div>

      {action.type === "whatsapp" ? (
        <>
          <div className="cmp-field">
            <label className="cmp-field-label">Message template</label>
            {waConfigured && waTemplates.length > 0 ? (
              <Select
                value={action.template || "__none__"}
                onValueChange={(val) => {
                  const templateVal = val === "__none__" ? "" : val;
                  const selected = waTemplates.find((t) => t.name === templateVal);
                  updateAction(day.id, action.id, {
                    template: templateVal,
                    namespace: selected?.namespace || action.namespace || undefined,
                  });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a template…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__none__">Select a template…</SelectItem>
                    {waTemplates.map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.name}{t.language ? ` (${t.language})` : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <input
                className="cmp-input"
                value={action.template || ""}
                placeholder="e.g. intro_hotel_v2"
                onChange={(e) => updateAction(day.id, action.id, { template: e.target.value })}
              />
            )}
            <div className="cmp-field-hint">
              {waLoading
                ? "Loading templates…"
                : waConfigured
                  ? "MSG91 template name (must be approved)."
                  : "MSG91 not configured — type the template name manually."}
            </div>
          </div>
          <div className="cmp-field">
            <label className="cmp-field-label">
              Namespace{" "}
              {waConfigured && waTemplates.length > 0 && (
                <span className="cmp-field-optional">(auto-filled)</span>
              )}
            </label>
            <input
              className="cmp-input"
              value={action.namespace || ""}
              placeholder="e.g. 5e4f3c2b_1a2b_3c4d_5e6f_7a8b9c0d1e2f"
              readOnly={waConfigured && waTemplates.length > 0}
              onChange={(e) => updateAction(day.id, action.id, { namespace: e.target.value })}
            />
            <div className="cmp-field-hint">MSG91 template namespace. Required for sending.</div>
          </div>
          {action.template && (
            <div className="cmp-field">
              <label className="cmp-field-label">Preview</label>
              <div className="cmp-msg-preview">
                Live preview unavailable in the editor. Server-side renders the template body using
                lead variables at send time.
              </div>
            </div>
          )}
          <div className="cmp-field">
            <label className="cmp-field-label">
              Interest keywords <span className="cmp-field-optional">(optional)</span>
            </label>
            <div className="cmp-keyword-tags">
              {(action.interest_keywords || []).map((kw, i) => (
                <span key={i} className="cmp-keyword-tag">
                  {kw}
                  <button
                    className="cmp-keyword-tag-remove"
                    onClick={() => {
                      const next = (action.interest_keywords || []).filter((_, j) => j !== i);
                      updateAction(day.id, action.id, { interest_keywords: next });
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="cmp-keyword-input"
                placeholder={
                  (action.interest_keywords || []).length > 0
                    ? "Add more…"
                    : "e.g. interested, yes, callback"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    const val = e.currentTarget.value.trim().replace(/,+$/, "");
                    if (val && !(action.interest_keywords || []).includes(val)) {
                      updateAction(day.id, action.id, {
                        interest_keywords: [...(action.interest_keywords || []), val],
                      });
                    }
                    e.currentTarget.value = "";
                  } else if (
                    e.key === "Backspace" &&
                    !e.currentTarget.value &&
                    (action.interest_keywords || []).length > 0
                  ) {
                    const next = (action.interest_keywords || []).slice(0, -1);
                    updateAction(day.id, action.id, { interest_keywords: next });
                  }
                }}
              />
            </div>
            <div className="cmp-field-hint">
              If a lead replies with any of these words, they are marked{" "}
              <strong>interested</strong> and outreach stops. Without keywords, any reply
              marks them <strong>engaged</strong> (outreach continues).
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="cmp-field">
            <label className="cmp-field-label">Voice script</label>
            <input
              className="cmp-input"
              value={action.script || ""}
              placeholder="e.g. sales_jaipur_v1"
              onChange={(e) => updateAction(day.id, action.id, { script: e.target.value })}
            />
            <div className="cmp-field-hint">
              Pipecat bot ID. Configure scripts in the Bots section.
            </div>
          </div>
          <div className="cmp-field">
            <label className="cmp-field-label">Caller ID</label>
            <input
              className="cmp-input"
              value={action.callerId || ""}
              placeholder="+91 14155551142"
              onChange={(e) => updateAction(day.id, action.id, { callerId: e.target.value })}
            />
          </div>
          <div className="cmp-field">
            <label className="cmp-field-label">
              Interest keywords <span className="cmp-field-optional">(optional)</span>
            </label>
            <div className="cmp-keyword-tags">
              {(action.interest_keywords || []).map((kw, i) => (
                <span key={i} className="cmp-keyword-tag">
                  {kw}
                  <button
                    className="cmp-keyword-tag-remove"
                    onClick={() => {
                      const next = (action.interest_keywords || []).filter((_, j) => j !== i);
                      updateAction(day.id, action.id, { interest_keywords: next });
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="cmp-keyword-input"
                placeholder={
                  (action.interest_keywords || []).length > 0
                    ? "Add more…"
                    : "e.g. interested, yes, callback"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    const val = e.currentTarget.value.trim().replace(/,+$/, "");
                    if (val && !(action.interest_keywords || []).includes(val)) {
                      updateAction(day.id, action.id, {
                        interest_keywords: [...(action.interest_keywords || []), val],
                      });
                    }
                    e.currentTarget.value = "";
                  } else if (
                    e.key === "Backspace" &&
                    !e.currentTarget.value &&
                    (action.interest_keywords || []).length > 0
                  ) {
                    const next = (action.interest_keywords || []).slice(0, -1);
                    updateAction(day.id, action.id, { interest_keywords: next });
                  }
                }}
              />
            </div>
            <div className="cmp-field-hint">
              If the AI detects any of these words in the conversation, the lead is marked{" "}
              <strong>interested</strong> and outreach stops. Without keywords, any completed
              call marks them <strong>interested</strong> (outreach stops).
            </div>
          </div>
        </>
      )}

      <hr className="cmp-inspector-separator" />
      <div className="cmp-inspector-foot">
        <button
          className="cmp-btn cmp-btn-ghost cmp-btn-sm"
          onClick={() => deleteAction(day.id, action.id)}
        >
          <Trash2 size={14} /> Remove
        </button>
        <button className="cmp-btn cmp-btn-default cmp-btn-sm" onClick={onClose}>
          Done
        </button>
      </div>
    </aside>
  );
}
