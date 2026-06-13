"use client";

import { Plus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CampaignCard, CampaignEmpty } from "@/components/campaigns/CampaignCard";
import { CreateCampaignDialog } from "@/components/campaigns/CreateCampaignDialog";
import { showToast } from "@/components/ui/Toast";
import { campaigns, templates } from "@/lib/campaigns/client";
import type { Campaign, CampaignStatus, CampaignTemplate } from "@/lib/campaigns/types";

type Filter = "all" | CampaignStatus;

const FILTER_TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "scheduled", label: "Scheduled" },
  { id: "paused", label: "Paused" },
  { id: "draft", label: "Drafts" },
  { id: "completed", label: "Completed" },
];

export default function CampaignsListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [data, setData] = useState<Campaign[]>([]);
  const [templateById, setTemplateById] = useState<Record<string, CampaignTemplate>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [c, t] = await Promise.all([
        campaigns.list({ limit: 100 }),
        templates.list({ limit: 100 }),
      ]);
      setData(c.data);
      setTemplateById(Object.fromEntries(t.data.map((tpl) => [tpl.id, tpl])));
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
    setLoading(false);
  }

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: data.length };
    for (const s of ["running", "scheduled", "paused", "draft", "completed"]) {
      out[s] = data.filter((c) => c.status === s).length;
    }
    return out;
  }, [data]);

  const filtered = useMemo(
    () => data.filter((c) => filter === "all" || c.status === filter),
    [data, filter]
  );

  async function withAction(fn: () => Promise<unknown>, success: string) {
    try {
      await fn();
      showToast(success, "success");
      load();
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
  }

  return (
    <div className="cmp-page-pad">
      <div className="cmp-page-actions-row">
        <div>
          <h1 className="cmp-page-heading">Campaigns</h1>
          <p className="cmp-page-subheading">
            Bind leads to a workflow template and run outreach end-to-end
          </p>
        </div>
        <button
          type="button"
          className="cmp-btn cmp-btn-default cmp-btn-sm"
          onClick={() => setWizardOpen(true)}
        >
          <Plus size={14} /> Create campaign
        </button>
      </div>

      <div className="cmp-tabs">
        {FILTER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`cmp-tab ${filter === t.id ? "cmp-tab-active" : ""}`}
            onClick={() => setFilter(t.id)}
          >
            {t.label}
            <span className="cmp-tab-badge">{counts[t.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="cmp-card-grid">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={`skel-${i}`} className="cmp-skeleton-card" />
          ))}
        {!loading && filtered.length === 0 && <CampaignEmpty />}
        {!loading &&
          filtered.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              templateName={c.template_id ? templateById[c.template_id]?.name : null}
              onOpen={() => router.push(`/dashboard/${orgId}/campaigns/${c.id}`)}
              onLaunch={() => withAction(() => campaigns.launch(c.id), "Campaign launched")}
              onPause={() => withAction(() => campaigns.pause(c.id), "Paused")}
              onResume={() => withAction(() => campaigns.resume(c.id), "Resumed")}
              onDelete={() => {
                if (!confirm(`Delete campaign "${c.name}"? This cannot be undone.`)) return;
                withAction(() => campaigns.delete(c.id), "Deleted");
              }}
            />
          ))}
      </div>

      <CreateCampaignDialog open={wizardOpen} onOpenChange={setWizardOpen} onCreated={load} />
    </div>
  );
}
