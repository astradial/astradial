"use client";

// Per UI.md §11.1. Per-campaign dashboard page:
//   header + status pill + Pause/Refresh (if running)
//   FunnelView with live tick
//   Tabs (single "Leads" tab in PR 4)
//   View switcher → Kanban OR List
//   LeadDrawer + (via drawer) TranscriptModal
// 4-second polling on /campaigns/:id/dashboard.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Pause, Play, RotateCw, Upload, WifiOff } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { lazy, Suspense, useEffect, useDeferredValue, useState, useTransition } from "react";

import { CampaignStatusPill } from "@/components/campaigns/CampaignStatusPill";
import { FunnelView, FunnelLiveTag } from "@/components/campaigns/FunnelView";
import { LeadsToolbar } from "@/components/campaigns/LeadsToolbar";
import { showToast } from "@/components/ui/Toast";
import { campaigns, dashboard } from "@/lib/campaigns/client";
import type { LeadStatus } from "@/lib/campaigns/types";

// Heavy/optional surfaces — code-split per UI.md §11.23.5.
const LeadsListView = lazy(() =>
  import("@/components/campaigns/LeadsListView").then((m) => ({ default: m.LeadsListView }))
);
const LeadsKanbanView = lazy(() =>
  import("@/components/campaigns/LeadsKanbanView").then((m) => ({ default: m.LeadsKanbanView }))
);
const LeadDrawer = lazy(() =>
  import("@/components/campaigns/LeadDrawer").then((m) => ({ default: m.LeadDrawer }))
);

const numberFmt = new Intl.NumberFormat("en-US");

type StatusFilter = LeadStatus | "all";
type View = "kanban" | "list";

export default function CampaignDetailPage() {
  const { orgId, campaignId } = useParams<{ orgId: string; campaignId: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [view, setView] = useState<View>("kanban");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [, startTransition] = useTransition();
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);

  const dashQ = useQuery({
    queryKey: ["campaigns", campaignId, "dashboard"],
    queryFn: ({ signal }) => dashboard.get(campaignId, { signal }),
    refetchInterval: 4_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (dashQ.dataUpdatedAt) {
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "kanban"] });
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "leads"] });
    }
  }, [dashQ.dataUpdatedAt, campaignId, qc]);

  const launchMut = useMutation({
    mutationFn: () => campaigns.launch(campaignId),
    onSuccess: () => {
      showToast("Campaign started", "success");
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "dashboard"] });
    },
    onError: (e: Error) => showToast(e.message, "error"),
  });

  const pauseMut = useMutation({
    mutationFn: () => campaigns.pause(campaignId),
    onSuccess: () => {
      showToast("Campaign paused", "success");
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "dashboard"] });
    },
    onError: (e: Error) => showToast(e.message, "error"),
  });

  const resumeMut = useMutation({
    mutationFn: () => campaigns.resume(campaignId),
    onSuccess: () => {
      showToast("Campaign resumed", "success");
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "dashboard"] });
    },
    onError: (e: Error) => showToast(e.message, "error"),
  });

  const camp = dashQ.data?.campaign;
  const isDraft = camp?.status === "draft";
  const isScheduled = camp?.status === "scheduled";
  const isRunning = camp?.status === "running";
  const isPaused = camp?.status === "paused";

  const funnelData = {
    total: dashQ.data?.totalLeads ?? 0,
    contacted: dashQ.data?.funnel.contacted ?? 0,
    engaged: dashQ.data?.funnel.engaged ?? 0,
    interested: dashQ.data?.funnel.interested ?? 0,
    qualified: dashQ.data?.funnel.qualified ?? 0,
  };

  const tickKey = dashQ.dataUpdatedAt;

  const counts: Partial<Record<StatusFilter, number>> = {
    all: dashQ.data?.totalLeads ?? 0,
    ...(dashQ.data?.leadCounts as Partial<Record<StatusFilter, number>>),
  };

  return (
    <div className="cmp-page-pad">
      {/* Header */}
      <div className="cmp-dashboard-head-row">
        <div style={{ minWidth: 0, flex: 1 }}>
          <button
            type="button"
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            onClick={() => router.push(`/dashboard/${orgId}/campaigns`)}
            style={{ marginBottom: 8 }}
          >
            <ChevronLeft size={14} /> All campaigns
          </button>
          <div className="cmp-dashboard-title-wrap">
            <h1 className="cmp-page-heading">{camp?.name || "Loading…"}</h1>
            {camp && <CampaignStatusPill status={camp.status} />}
          </div>
          <p className="cmp-page-subheading">
            {camp
              ? `${numberFmt.format(funnelData.total)} leads${
                  camp.start_at ? ` · started ${new Date(camp.start_at).toLocaleDateString()}` : ""
                }`
              : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="cmp-btn cmp-btn-outline cmp-btn-sm"
            onClick={() => router.push(`/dashboard/${orgId}/campaigns/${campaignId}/imports`)}
          >
            <Upload size={14} /> Imports
          </button>
          {(isDraft || isScheduled) && (
            <button
              type="button"
              className="cmp-btn cmp-btn-default cmp-btn-sm"
              onClick={() => launchMut.mutate()}
              disabled={launchMut.isPending}
            >
              <Play size={14} /> Start
            </button>
          )}
          {isRunning && (
            <button
              type="button"
              className="cmp-btn cmp-btn-outline cmp-btn-sm"
              onClick={() => pauseMut.mutate()}
              disabled={pauseMut.isPending}
            >
              <Pause size={14} /> Pause
            </button>
          )}
          {isPaused && (
            <button
              type="button"
              className="cmp-btn cmp-btn-outline cmp-btn-sm"
              onClick={() => resumeMut.mutate()}
              disabled={resumeMut.isPending}
            >
              <Play size={14} /> Resume
            </button>
          )}
          <button
            type="button"
            className="cmp-btn cmp-btn-outline cmp-btn-sm"
            onClick={() => dashQ.refetch()}
            disabled={dashQ.isFetching}
            aria-label="Refresh"
          >
            <RotateCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Funnel */}
      <div className="cmp-funnel-block">
        <div className="cmp-funnel-head-row">
          <h2 className="cmp-h2">Funnel</h2>
          {!dashQ.isPending && <FunnelLiveTag tickKey={tickKey} />}
        </div>
        {dashQ.isPending ? (
          <div className="cmp-funnel">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={`skel-${i}`} className="cmp-funnel-step">
                <div style={{ height: 12, width: 100, background: 'var(--muted)', borderRadius: 4, opacity: 0.5 }} />
                <div style={{ height: 20, width: 60, background: 'var(--muted)', borderRadius: 4, marginTop: 8, opacity: 0.5 }} />
              </div>
            ))}
          </div>
        ) : (
          <FunnelView data={funnelData} />
        )}
      </div>

      {/* Tabs (single tab in PR 4) */}
      <div className="cmp-tabs">
        <button type="button" className="cmp-tab cmp-tab-active">
          Leads <span className="cmp-tab-badge">{numberFmt.format(funnelData.total)}</span>
        </button>
      </div>

      {/* LeadsTab body — network error fallback (§11.24.14) replaces toolbar + view */}
      {dashQ.isError ? (
        <div className="cmp-empty" style={{ padding: "64px 16px" }}>
          <WifiOff size={32} style={{ color: "var(--destructive)" }} />
          <div style={{ fontSize: 16, fontWeight: 500 }}>Can't reach the server</div>
          <div className="cmp-empty-sub">
            {(dashQ.error as Error)?.message || "Network unreachable"}
          </div>
          <button
            type="button"
            className="cmp-btn cmp-btn-default cmp-btn-sm"
            onClick={() => dashQ.refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* Leads toolbar */}
          <LeadsToolbar
            query={query}
            onQueryChange={(q) => startTransition(() => setQuery(q))}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            view={view}
            onViewChange={(v) => startTransition(() => setView(v))}
            counts={counts}
          />

          {/* List or Kanban */}
          <Suspense fallback={<div className="cmp-empty">Loading view…</div>}>
            {view === "list" ? (
              <LeadsListView
                campaignId={campaignId}
                query={deferredQuery}
                statusFilter={statusFilter}
                onOpenLead={setDrawerLeadId}
              />
            ) : (
              <LeadsKanbanView
                campaignId={campaignId}
                query={deferredQuery}
                onOpenLead={setDrawerLeadId}
              />
            )}
          </Suspense>
        </>
      )}

      {/* Drawer */}
      {drawerLeadId && (
        <Suspense fallback={null}>
          <LeadDrawer
            open
            campaignId={campaignId}
            leadId={drawerLeadId}
            onClose={() => setDrawerLeadId(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
