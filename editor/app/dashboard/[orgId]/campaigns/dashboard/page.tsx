"use client";

// Campaign overview — isOverview="Live campaigns" view.
// Per UI.md §11.1 (overview mode) + §11.24.10 (empty state).
// Uses TanStack Query so cache shares with the per-campaign dashboard.

import { useQuery } from "@tanstack/react-query";
import { Plus, Zap } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import { CampaignCard } from "@/components/campaigns/CampaignCard";
import { campaigns, templates } from "@/lib/campaigns/client";
import type { Campaign, CampaignTemplate } from "@/lib/campaigns/types";

const LIVE_STATUSES: Campaign["status"][] = ["running", "scheduled", "paused"];

export default function CampaignsOverviewPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();

  const campaignsQ = useQuery({
    queryKey: ["campaigns", "list", { live: true }],
    queryFn: () => campaigns.list({ limit: 100 }),
    select: (res) => res.data.filter((c) => LIVE_STATUSES.includes(c.status)),
  });
  const templatesQ = useQuery({
    queryKey: ["campaign-templates", "list"],
    queryFn: () => templates.list({ limit: 100 }),
    select: (res) =>
      Object.fromEntries(res.data.map((t) => [t.id, t])) as Record<string, CampaignTemplate>,
  });

  const isLoading = campaignsQ.isPending || templatesQ.isPending;
  const live = campaignsQ.data ?? [];
  const templateById = templatesQ.data ?? {};

  return (
    <div className="cmp-page-pad">
      <div className="cmp-page-actions-row">
        <div>
          <h1 className="cmp-page-heading">Live campaigns</h1>
          <p className="cmp-page-subheading">Real-time view across all running campaigns</p>
        </div>
      </div>

      {isLoading && (
        <div className="cmp-card-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="cmp-skeleton-card" style={{ height: 160 }} />
          ))}
        </div>
      )}

      {!isLoading && live.length === 0 && (
        <div className="cmp-empty" style={{ padding: "80px 16px" }}>
          <Zap size={32} />
          <div className="cmp-empty-title" style={{ fontSize: 16 }}>
            No campaigns are live right now
          </div>
          <div className="cmp-empty-sub">
            Start a campaign from the Campaigns list, or pick a draft to schedule.
          </div>
          <div className="cmp-empty-actions">
            <button
              type="button"
              className="cmp-btn cmp-btn-default cmp-btn-sm"
              onClick={() => router.push(`/dashboard/${orgId}/campaigns`)}
            >
              <Plus size={14} /> Create campaign
            </button>
            <button
              type="button"
              className="cmp-btn cmp-btn-ghost cmp-btn-sm"
              onClick={() => router.push(`/dashboard/${orgId}/campaigns`)}
            >
              View all campaigns
            </button>
          </div>
        </div>
      )}

      {!isLoading && live.length > 0 && (
        <div className="cmp-card-grid">
          {live.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              templateName={c.template_id ? templateById[c.template_id]?.name : null}
              onOpen={() => router.push(`/dashboard/${orgId}/campaigns/${c.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
