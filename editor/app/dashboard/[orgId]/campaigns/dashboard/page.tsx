"use client";

// Campaign overview — isOverview="Live campaigns" view.
// Per UI.md §11.1 (overview mode) + §11.24.10 (empty state).
// Uses TanStack Query so cache shares with the per-campaign dashboard.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCw, WifiOff } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { lazy, Suspense, useEffect, useDeferredValue, useState, useTransition } from "react";

import { FunnelView, FunnelLiveTag } from "@/components/campaigns/FunnelView";
import { LeadsToolbar } from "@/components/campaigns/LeadsToolbar";
import { leads as leadsApi } from "@/lib/campaigns/client";
import type { LeadStatus } from "@/lib/campaigns/types";

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

export default function CampaignsOverviewPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [view, setView] = useState<View>("kanban");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [, startTransition] = useTransition();
  const [drawerLead, setDrawerLead] = useState<{ id: string; campaignId: string } | null>(null);

  // Query the leads.overview endpoint to fetch counts (ignoring statusFilter, but respecting q)
  const leadsOverviewQ = useQuery({
    queryKey: ["campaigns", "overview", "dashboard", { q: deferredQuery }],
    queryFn: ({ signal }) =>
      leadsApi.overview(
        {
          q: deferredQuery || undefined,
          limit: 1, // Only need counts for the funnel and toolbar badges
        },
        { signal }
      ),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Automatically refresh list/Kanban column views when overview data changes
  useEffect(() => {
    if (leadsOverviewQ.dataUpdatedAt) {
      qc.invalidateQueries({ queryKey: ["campaigns", "overview", "kanban"] });
      qc.invalidateQueries({ queryKey: ["campaigns", "overview", "leads"] });
    }
  }, [leadsOverviewQ.dataUpdatedAt, qc]);

  const counts = leadsOverviewQ.data?.counts ?? {
    raw: 0,
    contacted: 0,
    engaged: 0,
    interested: 0,
    qualified: 0,
    disqualified: 0,
    dnc: 0,
  };

  const totalLeads =
    counts.raw +
    counts.contacted +
    counts.engaged +
    counts.interested +
    counts.qualified +
    counts.disqualified +
    counts.dnc;

  const funnelData = {
    total: totalLeads,
    contacted: counts.contacted,
    engaged: counts.engaged,
    interested: counts.interested,
    qualified: counts.qualified,
  };

  const toolbarCounts: Partial<Record<StatusFilter, number>> = {
    all: totalLeads,
    ...counts,
  };

  const tickKey = leadsOverviewQ.dataUpdatedAt;
  const isLoading = leadsOverviewQ.isPending;

  return (
    <div className="cmp-page-pad">
      {/* Header */}
      <div className="cmp-page-actions-row">
        <div>
          <h1 className="cmp-page-heading">Live campaigns</h1>
          <p className="cmp-page-subheading">Real-time view across all running campaigns</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="cmp-btn cmp-btn-outline cmp-btn-sm"
            onClick={() => leadsOverviewQ.refetch()}
            disabled={leadsOverviewQ.isFetching}
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
          {!isLoading && <FunnelLiveTag tickKey={tickKey} />}
        </div>
        {isLoading ? (
          <div className="cmp-funnel">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={`skel-${i}`} className="cmp-funnel-step">
                <div
                  style={{
                    height: 12,
                    width: 100,
                    background: "var(--muted)",
                    borderRadius: 4,
                    opacity: 0.5,
                  }}
                />
                <div
                  style={{
                    height: 20,
                    width: 60,
                    background: "var(--muted)",
                    borderRadius: 4,
                    marginTop: 8,
                    opacity: 0.5,
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <FunnelView data={funnelData} />
        )}
      </div>

      {/* Tabs */}
      <div className="cmp-tabs">
        <button type="button" className="cmp-tab cmp-tab-active">
          Leads <span className="cmp-tab-badge">{numberFmt.format(totalLeads)}</span>
        </button>
      </div>

      {/* Leads body */}
      {leadsOverviewQ.isError ? (
        <div className="cmp-empty" style={{ padding: "64px 16px" }}>
          <WifiOff size={32} style={{ color: "var(--destructive)" }} />
          <div style={{ fontSize: 16, fontWeight: 500 }}>Can't reach the server</div>
          <div className="cmp-empty-sub">
            {(leadsOverviewQ.error as Error)?.message || "Network unreachable"}
          </div>
          <button
            type="button"
            className="cmp-btn cmp-btn-default cmp-btn-sm"
            onClick={() => leadsOverviewQ.refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <LeadsToolbar
            query={query}
            onQueryChange={(q) => startTransition(() => setQuery(q))}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            view={view}
            onViewChange={(v) => startTransition(() => setView(v))}
            counts={toolbarCounts}
          />

          <Suspense fallback={<div className="cmp-empty">Loading view…</div>}>
            {view === "list" ? (
              <LeadsListView
                campaignId="overview"
                query={deferredQuery}
                statusFilter={statusFilter}
                onOpenLead={(id, cid) => setDrawerLead({ id, campaignId: cid || "overview" })}
              />
            ) : (
              <LeadsKanbanView
                campaignId="overview"
                query={deferredQuery}
                onOpenLead={(id, cid) => setDrawerLead({ id, campaignId: cid || "overview" })}
              />
            )}
          </Suspense>
        </>
      )}

      {/* Drawer */}
      {drawerLead && (
        <Suspense fallback={null}>
          <LeadDrawer
            open
            campaignId={drawerLead.campaignId}
            leadId={drawerLead.id}
            onClose={() => setDrawerLead(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
