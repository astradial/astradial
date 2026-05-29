"use client";

// Per UI.md §11.11. Org-scoped approvals queue:
//   header + back-link to /campaigns
//   status tabs (pending | approved | rejected) with count badges
//   list of approval cards (lead, channel/node, SLA, draft, reasoning, context, actions)
//   approve/reject mutations with optimistic removal from the current list
//   pagination via Prev/Next at 20/page

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CampaignStatusPill } from "@/components/campaigns/CampaignStatusPill";
import { showToast } from "@/components/ui/Toast";
import { approvals } from "@/lib/campaigns/client";
import type { ApprovalStatus, CampaignApproval, Paginated } from "@/lib/campaigns/types";

const PAGE_SIZE = 20;

const TABS: { id: ApprovalStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

const numberFmt = new Intl.NumberFormat("en-US");

function formatSla(slaAt: string | null, now: number): { label: string; urgent: boolean } {
  if (!slaAt) return { label: "—", urgent: false };
  const target = new Date(slaAt).getTime();
  if (Number.isNaN(target)) return { label: "—", urgent: false };
  const diffMs = target - now;
  if (diffMs <= 0) return { label: "Overdue", urgent: true };
  const totalMin = Math.floor(diffMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return { label, urgent: diffMs < 60 * 60_000 };
}

function emptyHeading(status: ApprovalStatus): { title: string; sub: string } {
  if (status === "pending") {
    return {
      title: "No approvals waiting",
      sub: "All caught up — new approvals will appear here as campaigns reach human-approval steps.",
    };
  }
  if (status === "approved") {
    return {
      title: "No approved approvals yet",
      sub: "Once you approve a draft, it shows up here.",
    };
  }
  return {
    title: "No rejected approvals yet",
    sub: "Drafts you reject will be listed here for audit.",
  };
}

function contextEntries(ctx: CampaignApproval["context"]): string[] {
  if (!ctx) return [];
  // The shape isn't strictly typed — backend may store an object or array.
  if (Array.isArray(ctx)) {
    return (ctx as unknown[]).map((v) => String(v));
  }
  return Object.entries(ctx).map(([k, v]) => {
    if (v == null || v === "") return k;
    return `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`;
  });
}

function leadDisplayName(a: CampaignApproval): string {
  const ctx = a.context;
  if (ctx && !Array.isArray(ctx)) {
    const obj = ctx as Record<string, unknown>;
    for (const key of ["lead_name", "leadName", "name"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return `Lead ${a.campaign_lead_id.slice(0, 8)}`;
}

function leadBusiness(a: CampaignApproval): string | null {
  const ctx = a.context;
  if (ctx && !Array.isArray(ctx)) {
    const obj = ctx as Record<string, unknown>;
    for (const key of ["business", "lead_business", "company"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return null;
}

function nodeLabel(a: CampaignApproval): string {
  return a.node_id ?? "—";
}

function SkeletonCard() {
  return <div className="cmp-skeleton-card" style={{ height: 180, marginBottom: 12 }} />;
}

interface ApprovalCardProps {
  approval: CampaignApproval;
  now: number;
  onDecide: (id: string, decision: "approved" | "rejected") => void;
  busy: boolean;
}

function ApprovalCard({ approval, now, onDecide, busy }: ApprovalCardProps) {
  const sla = formatSla(approval.sla_at, now);
  const chips = contextEntries(approval.context);
  const name = leadDisplayName(approval);
  const business = leadBusiness(approval);
  const isPending = approval.status === "pending";

  return (
    <div className="cmp-approval-card">
      <div className="cmp-approval-head">
        <div className="cmp-approval-meta">
          <CampaignStatusPill status={approval.status} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
          {business && (
            <span className="text-[12px] text-muted-foreground">· {business}</span>
          )}
        </div>
        <span
          className={`cmp-sla-countdown${sla.urgent ? " cmp-sla-urgent" : ""}`}
        >
          <Clock size={12} /> SLA {sla.label}
        </span>
      </div>

      <div className="text-[12px] text-muted-foreground">
        {approval.channel === "whatsapp" ? "WhatsApp" : "Phone call"} ·{" "}
        {nodeLabel(approval)}
      </div>

      {approval.draft && <div className="cmp-draft-bubble">{approval.draft}</div>}

      {approval.reasoning && approval.reasoning.trim() && (
        <details>
          <summary className="text-[12px]" style={{ fontWeight: 500, cursor: "pointer" }}>
            Reasoning
          </summary>
          <div className="cmp-ai-reasoning" style={{ marginTop: 6 }}>
            {approval.reasoning}
          </div>
        </details>
      )}

      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c, i) => (
            <span key={i} className="cmp-chip cmp-chip-outline">
              {c}
            </span>
          ))}
        </div>
      )}

      {isPending && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            onClick={() => onDecide(approval.id, "rejected")}
            disabled={busy}
          >
            Reject
          </button>
          <button
            type="button"
            className="cmp-btn cmp-btn-default cmp-btn-sm"
            onClick={() => onDecide(approval.id, "approved")}
            disabled={busy}
          >
            Approve
          </button>
        </div>
      )}
    </div>
  );
}

export default function CampaignApprovalsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const qc = useQueryClient();

  const [status, setStatus] = useState<ApprovalStatus>("pending");
  const [page, setPage] = useState(1);

  // Tick once a minute so SLA countdowns stay accurate without re-fetching.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const listQ = useQuery({
    queryKey: ["approvals", { status, page }],
    queryFn: () => approvals.list({ status, page, limit: PAGE_SIZE }),
  });

  // Fetch pending count for header even when viewing other tabs.
  const pendingCountQ = useQuery({
    queryKey: ["approvals", "count", "pending"],
    queryFn: () => approvals.list({ status: "pending", page: 1, limit: 1 }),
  });

  const decideMut = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: "approved" | "rejected";
    }) => approvals.decide(id, decision),
    onMutate: async ({ id }) => {
      const key = ["approvals", { status, page }] as const;
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Paginated<CampaignApproval>>(key);
      if (prev) {
        // Optimistically drop the row from the current list — the server
        // will move it to a different status bucket, so it vanishes here.
        qc.setQueryData<Paginated<CampaignApproval>>(key, {
          ...prev,
          data: prev.data.filter((a) => a.id !== id),
          total: Math.max(0, prev.total - 1),
        });
      }
      return { prev, key };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      showToast(err.message || "Failed to record decision", "error");
    },
    onSuccess: (_data, vars) => {
      showToast(
        vars.decision === "approved" ? "Approved" : "Rejected",
        "success"
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });

  const rows = listQ.data?.data ?? [];
  const totalForTab = listQ.data?.total ?? 0;
  const totalPages = listQ.data?.pages ?? 1;
  const totalPending = pendingCountQ.data?.total ?? (status === "pending" ? totalForTab : 0);

  const tabCounts = useMemo(() => {
    const out: Record<ApprovalStatus, number> = {
      pending: totalPending,
      approved: 0,
      rejected: 0,
      expired: 0,
    };
    out[status] = totalForTab;
    return out;
  }, [status, totalForTab, totalPending]);

  const empty = emptyHeading(status);

  return (
    <div className="cmp-page-pad">
      <div style={{ marginBottom: 8 }}>
        <Link
          href={`/dashboard/${orgId}/campaigns`}
          className="cmp-btn cmp-btn-ghost cmp-btn-sm"
        >
          <ArrowLeft size={14} /> All campaigns
        </Link>
      </div>

      <h1 className="cmp-page-heading">Approvals</h1>
      <p className="cmp-page-subheading">
        {numberFmt.format(totalPending)} pending
      </p>

      <div className="cmp-tabs" style={{ marginTop: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`cmp-tab ${status === t.id ? "cmp-tab-active" : ""}`}
            onClick={() => {
              setStatus(t.id);
              setPage(1);
            }}
          >
            {t.label}
            <span className="cmp-tab-badge">
              {numberFmt.format(tabCounts[t.id] ?? 0)}
            </span>
          </button>
        ))}
      </div>

      {listQ.isLoading && (
        <div>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!listQ.isLoading && rows.length === 0 && (
        <div className="cmp-empty-state-large">
          <CheckCircle2 size={36} style={{ color: "oklch(0.55 0.16 150)" }} />
          <div className="cmp-empty-state-large-title">{empty.title}</div>
          <div className="cmp-empty-state-large-sub">{empty.sub}</div>
        </div>
      )}

      {!listQ.isLoading && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              now={now}
              onDecide={(id, decision) => decideMut.mutate({ id, decision })}
              busy={decideMut.isPending}
            />
          ))}
        </div>
      )}

      {rows.length > 0 && totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Prev
          </button>
          <span
            className="text-[13px] text-muted-foreground"
            style={{ alignSelf: "center" }}
          >
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
