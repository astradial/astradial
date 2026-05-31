"use client";

// Per UI.md §11.6. Six columns, one useInfiniteQuery per column for
// in-place Load-more. dnd-kit for keyboard-accessible drag-drop.
// Optimistic mutation per §11.23.4 with rollback on PATCH failure.

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { memo, useState, useRef, useEffect } from "react";

import { CampaignStatusPill } from "./CampaignStatusPill";
import { showToast } from "@/components/ui/Toast";
import { leads as leadsApi, type OverviewLeadsResponse } from "@/lib/campaigns/client";
import type { CampaignLead, LeadStatus, Paginated } from "@/lib/campaigns/types";

const numberFmt = new Intl.NumberFormat("en-US");

// Pipeline order. DNC is rendered into the disqualified column for
// kanban display only (per design).
const COLUMNS: { id: LeadStatus; label: string; hint: string }[] = [
  { id: "raw", label: "Raw", hint: "Untouched" },
  { id: "contacted", label: "Contacted", hint: "First touch sent" },
  { id: "engaged", label: "Engaged", hint: "Replied or answered" },
  { id: "interested", label: "Interested", hint: "Matches some rules" },
  { id: "qualified", label: "Qualified", hint: "Marked for handoff" },
  { id: "disqualified", label: "Disqualified", hint: "Off-pipe / DNC" },
];

const PAGE_SIZE = 50;

interface Props {
  campaignId: string;
  query: string;
  onOpenLead: (leadId: string, campaignId?: string) => void;
}

export function LeadsKanbanView({ campaignId, query, onOpenLead }: Props) {
  const qc = useQueryClient();

  // PATCH lead status. Optimistic: remove from source-column's first page,
  // prepend to target column, rollback on error.
  type MoveVars = { leadId: string; status: LeadStatus; fromStatus: LeadStatus; lead: CampaignLead & { campaign_id?: string } };
  const move = useMutation({
    mutationFn: ({ leadId, status, lead }: MoveVars) =>
      leadsApi.update(campaignId === "overview" && lead.campaign_id ? lead.campaign_id : campaignId, leadId, { status }),
    onMutate: async ({ leadId, status, fromStatus, lead }: MoveVars) => {
      const allKeys = [
        ["campaigns", campaignId, "kanban", fromStatus, { q: query }],
        ["campaigns", campaignId, "kanban", status, { q: query }],
      ];
      await Promise.all(allKeys.map((k) => qc.cancelQueries({ queryKey: k })));

      const snapshot = qc.getQueriesData<{
        pages: Paginated<CampaignLead>[];
        pageParams: unknown[];
      }>({ queryKey: ["campaigns", campaignId, "kanban"] });

      // Remove from source column.
      qc.setQueryData<{ pages: Paginated<CampaignLead>[]; pageParams: unknown[] }>(
        ["campaigns", campaignId, "kanban", fromStatus, { q: query }],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((p, i) =>
              i === 0
                ? {
                    ...p,
                    data: p.data.filter((l) => l.id !== leadId),
                    filtered: Math.max(0, (p.filtered ?? p.total) - 1),
                    total: Math.max(0, p.total - 1),
                  }
                : p
            ),
          };
        }
      );
      // Prepend to target column.
      qc.setQueryData<{ pages: Paginated<CampaignLead>[]; pageParams: unknown[] }>(
        ["campaigns", campaignId, "kanban", status, { q: query }],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((p, i) =>
              i === 0
                ? {
                    ...p,
                    data: [{ ...lead, status, last_touch_at: new Date().toISOString() }, ...p.data],
                    filtered: (p.filtered ?? p.total) + 1,
                    total: p.total + 1,
                  }
                : p
            ),
          };
        }
      );

      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) {
        ctx.snapshot.forEach(([key, value]) => qc.setQueryData(key, value));
      }
      showToast("Move failed", "error");
    },
    onSuccess: (_data, { fromStatus, status, lead }) => {
      const activeCid = campaignId === "overview" && lead.campaign_id ? lead.campaign_id : campaignId;
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "kanban", fromStatus] });
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "kanban", status] });
      qc.invalidateQueries({ queryKey: ["campaigns", activeCid, "dashboard"] });
      if (campaignId === "overview") {
        qc.invalidateQueries({ queryKey: ["campaigns", "overview", "dashboard"] });
      }
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleScroll = () => {
    setIsScrolling(true);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  function onDragEnd(e: DragEndEvent) {
    const active = e.active;
    const over = e.over;
    if (!over) return;
    const lead = active.data.current as CampaignLead | undefined;
    if (!lead) return;
    const target = over.id as LeadStatus;
    if (target === lead.status) return;
    if (!COLUMNS.find((c) => c.id === target)) return;
    move.mutate({
      leadId: lead.id,
      status: target,
      fromStatus: lead.status,
      lead,
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div 
        className={`cmp-kanban-wrap ${isScrolling ? "is-scrolling" : ""}`}
        onScroll={handleScroll}
        style={{ overflowX: "auto" }}
      >
        <div className="cmp-kanban-board">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              campaignId={campaignId}
              column={col}
              query={query}
              onOpenLead={onOpenLead}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

interface KanbanColumnProps {
  campaignId: string;
  column: { id: LeadStatus; label: string; hint: string };
  query: string;
  onOpenLead: (leadId: string, campaignId?: string) => void;
}

function KanbanColumn({ campaignId, column, query, onOpenLead }: KanbanColumnProps) {
  const q = useInfiniteQuery<Paginated<CampaignLead> | OverviewLeadsResponse>({
    queryKey: ["campaigns", campaignId, "kanban", column.id, { q: query }],
    queryFn: ({ pageParam, signal }) => {
      if (campaignId === "overview") {
        return leadsApi.overview(
          {
            status: column.id,
            q: query || undefined,
            page: pageParam as number,
            limit: PAGE_SIZE,
            sort: "last_touch_at:desc",
          },
          { signal }
        );
      }
      return leadsApi.list(
        campaignId,
        {
          status: column.id,
          q: query || undefined,
          page: pageParam as number,
          limit: PAGE_SIZE,
          sort: "lastTouch:desc",
        },
        { signal }
      );
    },
    initialPageParam: 1,
    getNextPageParam: (last: any) =>
      (last.filtered ?? last.total) > last.page * (last.pageSize ?? PAGE_SIZE)
        ? last.page + 1
        : undefined,
  });

  const rows: CampaignLead[] = q.data?.pages.flatMap((p) => p.data) ?? [];
  const firstPage = q.data?.pages[0] as any;
  const filtered = firstPage?.filtered ?? firstPage?.total ?? 0;
  const hasMore = !!q.hasNextPage;
  const loading = q.isPending;
  const fetchingMore = q.isFetchingNextPage;

  const { isOver, setNodeRef } = useDroppable({ id: column.id });
  const cls = `cmp-kanban-col ${isOver ? "cmp-kanban-col-target" : ""}`;

  return (
    <div ref={setNodeRef} className={cls}>
      <div className="cmp-kanban-col-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <CampaignStatusPill status={column.id} />
          <span className="cmp-kanban-col-count cmp-tabular">
            {numberFmt.format(filtered)}
          </span>
        </div>
        <button className="cmp-toolbar-icon-btn" aria-label="Column actions">
          <MoreHorizontal size={14} />
        </button>
      </div>
      <div className="cmp-kanban-col-hint">{column.hint}</div>

      <div className="cmp-kanban-col-body">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={`skel-${i}`} className="cmp-skeleton-card" />
          ))}

        {!loading && q.isError && (
          <div className="cmp-kanban-empty">
            Couldn&apos;t load —{" "}
            <button
              className="underline"
              onClick={() => q.refetch()}
              style={{ background: "transparent", border: "none", cursor: "pointer" }}
            >
              retry
            </button>
          </div>
        )}

        {!loading && !q.isError && rows.length === 0 && (
          <div className={`cmp-kanban-empty ${isOver ? "cmp-kanban-empty-target" : ""}`}>
            {isOver ? "Drop here" : "No lead"}
          </div>
        )}

        {rows.map((l) => (
          <KanbanCard key={l.id} lead={l} onClick={onOpenLead} />
        ))}

        {hasMore && (
          <button
            className="cmp-kanban-more"
            disabled={fetchingMore}
            onClick={() => q.fetchNextPage()}
          >
            {fetchingMore
              ? "Loading…"
              : `Load next ${Math.min(PAGE_SIZE, filtered - rows.length)}`}
          </button>
        )}
      </div>
    </div>
  );
}

interface KanbanCardProps {
  lead: CampaignLead & { campaign_name?: string | null; campaign_id?: string };
  onClick: (id: string, campaignId?: string) => void;
}

const KanbanCard = memo(
  function KanbanCard({ lead, onClick }: KanbanCardProps) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
      id: lead.id,
      data: lead,
    });
    const cls = `cmp-kanban-card ${isDragging ? "cmp-kanban-card-dragging" : ""}`;
    // Relative time vs "now". Date.now() is read at render — deliberate
    // because the label is "X ago" and there's no cheap alternative that
    // captures wall-clock without state. Static snapshot per render is fine.
    function relTime(iso: string | null | undefined): string {
      if (!iso) return "No activity";
      // eslint-disable-next-line react-hooks/purity
      const d = Date.now() - new Date(iso).getTime();
      const m = Math.round(d / 60000);
      if (m < 60) return `${m}m ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.round(h / 24)}d ago`;
    }
    return (
      <div
        ref={setNodeRef}
        className={cls}
        {...listeners}
        {...attributes}
        onClick={(e) => {
          if (!isDragging) onClick(lead.id, lead.campaign_id);
          e.stopPropagation();
        }}
      >
        <div className="cmp-kanban-card-name">{lead.name}</div>
        {lead.campaign_name && (
          <div className="text-[11px] text-muted-foreground mb-1 font-medium">{lead.campaign_name}</div>
        )}
        <div className="cmp-kanban-card-phone">{lead.phone}</div>
        <div className="cmp-kanban-card-foot">
          <span className="cmp-kanban-card-time">{relTime(lead.last_touch_at)}</span>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.lead.id === next.lead.id &&
    prev.lead.status === next.lead.status &&
    prev.lead.last_touch_at === next.lead.last_touch_at &&
    prev.lead.name === next.lead.name &&
    prev.lead.campaign_name === next.lead.campaign_name &&
    prev.onClick === next.onClick
);
