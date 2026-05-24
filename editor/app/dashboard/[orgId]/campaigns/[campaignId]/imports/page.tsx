"use client";

// Per UI.md §11.x. Campaign CSV imports history page:
//   header + back-link + status filter tabs
//   card grid of import jobs (queued/running/completed/failed/cancelled)
//   live progress (3s poll) only while any row is queued/running
//   cancel action for in-flight jobs (PATCH status=cancelled)
//   pagination via Prev/Next at 25/page
// Polling stops automatically once no row is in-flight to avoid
// hammering the API on a static history view.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Loader2,
  MoreHorizontal,
  Upload,
  XCircle,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { showToast } from "@/components/ui/Toast";
import { imports } from "@/lib/campaigns/client";
import type { CampaignImportJob, ImportJobStatus } from "@/lib/campaigns/types";

const numberFmt = new Intl.NumberFormat("en-US");

type Filter = "all" | ImportJobStatus;

const FILTER_TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "queued", label: "Queued" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 25;

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusIcon({ status }: { status: ImportJobStatus }) {
  if (status === "queued" || status === "running") {
    return <Loader2 size={18} className="animate-spin" />;
  }
  if (status === "completed") return <CheckCircle size={18} />;
  if (status === "failed") return <XCircle size={18} />;
  if (status === "cancelled") return <AlertTriangle size={18} />;
  return <MoreHorizontal size={18} />;
}

export default function CampaignImportsPage() {
  const { orgId, campaignId } = useParams<{ orgId: string; campaignId: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  const listQ = useQuery({
    queryKey: ["campaigns", campaignId, "imports", { filter, page }],
    queryFn: ({ signal }) =>
      imports.list(
        campaignId,
        {
          page,
          limit: PAGE_SIZE,
          status: filter === "all" ? undefined : filter,
        },
        { signal }
      ),
    // Only poll while something is in-flight; mirrors the dashboard cadence.
    refetchInterval: (query) => {
      const rows = query.state.data?.data ?? [];
      const live = rows.some((r) => r.status === "queued" || r.status === "running");
      return live ? 3_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const cancelMut = useMutation({
    mutationFn: (jobId: string) => imports.cancel(campaignId, jobId),
    onSuccess: () => {
      showToast("Cancel signalled — worker stops at the next batch", "info");
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "imports"] });
    },
    onError: (e: Error) => showToast(e.message, "error"),
  });

  const rows = listQ.data?.data ?? [];
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: rows.length };
    for (const s of ["queued", "running", "completed", "failed", "cancelled"]) {
      out[s] = rows.filter((r) => r.status === s).length;
    }
    return out;
  }, [rows]);

  const totalPages = listQ.data?.pages ?? 1;

  function onCancel(job: CampaignImportJob) {
    if (!window.confirm("Cancel this import? Already-inserted rows stay.")) return;
    cancelMut.mutate(job.id);
  }

  return (
    <div className="cmp-page-pad">
      <div style={{ marginBottom: 8 }}>
        <button
          type="button"
          className="cmp-btn cmp-btn-ghost cmp-btn-sm"
          onClick={() => router.push(`/dashboard/${orgId}/campaigns/${campaignId}`)}
        >
          <ArrowLeft size={14} /> Back to campaign
        </button>
      </div>

      <h1 className="cmp-page-heading">Imports</h1>
      <p className="cmp-page-subheading">History of CSV uploads for this campaign</p>

      <div className="cmp-tabs">
        {FILTER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`cmp-tab ${filter === t.id ? "cmp-tab-active" : ""}`}
            onClick={() => {
              setFilter(t.id);
              setPage(1);
            }}
          >
            {t.label}
            <span className="cmp-tab-badge">{counts[t.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {listQ.isLoading && (
        <div className="text-[13px] text-muted-foreground p-6 text-center">Loading…</div>
      )}

      {!listQ.isLoading && rows.length === 0 && (
        <div className="text-[13px] text-muted-foreground p-6 border rounded-lg text-center">
          <Upload size={20} /> No imports yet. Use the &ldquo;Create campaign&rdquo; wizard
          or the import action on this page to upload a CSV.
        </div>
      )}

      <div className="cmp-card-grid">
        {rows.map((job) => {
          const inFlight = job.status === "queued" || job.status === "running";
          const pct =
            job.total_rows && job.total_rows > 0
              ? Math.min(100, Math.round((job.processed / job.total_rows) * 100))
              : 0;
          const tileClass =
            job.status === "completed" ? "cmp-icon-tile cmp-icon-tile-success" : "cmp-icon-tile";

          return (
            <div key={job.id} className="cmp-pick-card">
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div className={tileClass}>
                  <StatusIcon status={job.status} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="font-medium" style={{ wordBreak: "break-all" }}>
                    {job.original_filename || "(unnamed file)"}
                  </div>
                  <div className="text-[13px] text-muted-foreground">
                    {formatBytes(job.file_size_bytes)} · mode{" "}
                    <span className="cmp-mono">{job.mode}</span>
                  </div>
                </div>
              </div>

              {inFlight && (
                <div style={{ marginTop: 12 }}>
                  {job.total_rows ? (
                    <>
                      <div
                        style={{
                          height: 6,
                          background: "var(--muted, #eee)",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: "var(--primary, #4f46e5)",
                            transition: "width 200ms ease",
                          }}
                        />
                      </div>
                      <div className="text-[13px] text-muted-foreground" style={{ marginTop: 4 }}>
                        {numberFmt.format(job.processed)} / {numberFmt.format(job.total_rows)} rows
                        ({pct}%)
                      </div>
                    </>
                  ) : (
                    <div className="text-[13px] text-muted-foreground">Processing…</div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                <span className="cmp-chip">Inserted {numberFmt.format(job.inserted)}</span>
                <span className="cmp-chip">Updated {numberFmt.format(job.updated)}</span>
                <span className="cmp-chip">Skipped {numberFmt.format(job.skipped)}</span>
                <span className="cmp-chip">Errors {numberFmt.format(job.error_count)}</span>
              </div>

              <div className="text-[13px] text-muted-foreground" style={{ marginTop: 10 }}>
                {job.started_at && <>Started {new Date(job.started_at).toLocaleString()}</>}
                {job.started_at && job.finished_at && " · "}
                {job.finished_at && <>Finished {new Date(job.finished_at).toLocaleString()}</>}
                {!job.started_at && !job.finished_at && job.createdAt && (
                  <>Queued {new Date(job.createdAt).toLocaleString()}</>
                )}
              </div>

              {job.status === "failed" && job.last_error && (
                <div
                  className="text-[13px]"
                  style={{
                    marginTop: 10,
                    padding: 8,
                    borderRadius: 6,
                    background: "var(--destructive-bg, #fee2e2)",
                    color: "var(--destructive, #991b1b)",
                    wordBreak: "break-word",
                  }}
                >
                  {job.last_error}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: 12,
                }}
              >
                {inFlight ? (
                  <button
                    type="button"
                    className="cmp-btn cmp-btn-outline cmp-btn-sm"
                    onClick={() => onCancel(job)}
                    disabled={cancelMut.isPending}
                  >
                    Cancel
                  </button>
                ) : (
                  <button type="button" className="cmp-btn cmp-btn-ghost cmp-btn-sm" disabled>
                    View details
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

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
          <span className="text-[13px] text-muted-foreground" style={{ alignSelf: "center" }}>
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
