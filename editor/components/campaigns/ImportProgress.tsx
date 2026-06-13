"use client";

/*
 * ImportProgress
 *
 * Polling progress UI for the async CSV import flow. Rendered inside the
 * create-campaign dialog (and ad-hoc import flows) after submitting an
 * import job. Polls GET /campaigns/:id/imports/:jobId every 2s via the
 * `imports.get` client wrapper, renders queued/running/completed/failed/
 * cancelled states with counter chips and an optional errors list, and
 * fires onComplete / onFailed exactly once when a terminal state is hit.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Loader2, X, XCircle } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";

import { showToast } from "@/components/ui/Toast";
import { imports } from "@/lib/campaigns/client";
import type { CampaignImportJob } from "@/lib/campaigns/types";

const numberFmt = new Intl.NumberFormat("en-US");

interface ImportProgressProps {
  campaignId: string;
  jobId: string;
  onComplete?: (job: CampaignImportJob) => void;
  onFailed?: (job: CampaignImportJob) => void;
  hideErrorsList?: boolean;
}

function formatBytes(bytes: number | null): string | null {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function ImportProgress(props: ImportProgressProps): JSX.Element {
  const { campaignId, jobId, onComplete, onFailed, hideErrorsList = false } = props;

  // Ref guards against firing terminal callbacks more than once — React Query
  // will keep returning the same terminal row on remount/refocus and we must
  // not re-invoke the parent's onComplete (which typically advances UI state).
  const firedRef = useRef<boolean>(false);
  const [showErrors, setShowErrors] = useState<boolean>(false);

  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["campaigns", campaignId, "imports", jobId],
    queryFn: ({ signal }) => imports.get(campaignId, jobId, { signal }),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "queued" || s === "running" ? 2000 : false;
    },
    refetchIntervalInBackground: false,
  });

  // Cancel PATCHes status='cancelled'. The worker re-reads the row at
  // its next batch boundary (~1000 rows) and exits cleanly; already-
  // inserted rows stay. Invalidate so the next poll picks up the new
  // status immediately rather than waiting for the 2s tick.
  const cancelMut = useMutation({
    mutationFn: () => imports.cancel(campaignId, jobId),
    onSuccess: () => {
      showToast("Cancel signalled — worker stops at the next batch", "info");
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "imports", jobId] });
    },
    onError: (e: Error) => showToast(e.message, "error"),
  });

  function handleCancel() {
    if (!window.confirm("Cancel this import? Already-inserted rows stay.")) return;
    cancelMut.mutate();
  }

  const data = q.data;
  const status = data?.status;

  useEffect(() => {
    if (!data || firedRef.current) return;
    if (status === "completed") {
      firedRef.current = true;
      onComplete?.(data);
    } else if (status === "failed" || status === "cancelled") {
      firedRef.current = true;
      onFailed?.(data);
    }
  }, [status, data, onComplete, onFailed]);

  useEffect(() => {
    if (q.error) showToast((q.error as Error).message, "error");
  }, [q.error]);

  if (!data) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: 24,
        }}
      >
        <Loader2 size={24} className="animate-spin" />
        <span className="text-[13px] text-muted-foreground">Queued…</span>
      </div>
    );
  }

  const filename = data.original_filename ?? "leads.csv";
  const sizeLabel = formatBytes(data.file_size_bytes);
  const total = data.total_rows;
  const pct = total && total > 0 ? Math.min(100, Math.round((data.processed / total) * 100)) : 0;
  const hasErrors = (data.errors?.length ?? 0) > 0;

  const counters = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <span className="cmp-chip">Inserted {numberFmt.format(data.inserted)}</span>
      <span className="cmp-chip">Updated {numberFmt.format(data.updated)}</span>
      <span className="cmp-chip">Skipped {numberFmt.format(data.skipped)}</span>
      <span className="cmp-chip">Errors {numberFmt.format(data.error_count)}</span>
    </div>
  );

  const errorsList =
    !hideErrorsList && hasErrors ? (
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="cmp-btn cmp-btn-ghost cmp-btn-sm"
          onClick={() => setShowErrors((v) => !v)}
          aria-expanded={showErrors}
        >
          {showErrors ? "Hide" : "View"} {numberFmt.format(data.errors!.length)} error
          {data.errors!.length === 1 ? "" : "s"}
        </button>
        {showErrors && (
          <ul
            style={{
              marginTop: 8,
              maxHeight: 180,
              overflowY: "auto",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 12px",
              listStyle: "none",
              fontSize: 12,
            }}
          >
            {data.errors!.map((e, i) => (
              <li key={`${e.row}-${i}`} className="text-[13px]" style={{ padding: "4px 0" }}>
                <span className="cmp-mono text-muted-foreground">row {e.row}:</span> {e.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    ) : null;

  const fileHeader = (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
      <span
        className="font-medium text-[13px]"
        title={filename}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {filename}
      </span>
      {sizeLabel && <span className="text-[13px] text-muted-foreground">{sizeLabel}</span>}
    </div>
  );

  const cancelBtn = (
    <button
      type="button"
      className="cmp-btn cmp-btn-ghost cmp-btn-sm"
      onClick={handleCancel}
      disabled={cancelMut.isPending}
      aria-label="Cancel import"
      title="Cancel import"
    >
      <X size={14} /> {cancelMut.isPending ? "Cancelling…" : "Cancel"}
    </button>
  );

  if (status === "queued") {
    return (
      <div className="cmp-pick-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Loader2 size={20} className="animate-spin" />
          {fileHeader}
          {cancelBtn}
        </div>
        <span className="text-[13px] text-muted-foreground">Queued…</span>
      </div>
    );
  }

  if (status === "running") {
    return (
      <div className="cmp-pick-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Loader2 size={20} className="animate-spin" />
          {fileHeader}
          {cancelBtn}
        </div>
        {total != null ? (
          <>
            <div
              style={{
                width: "100%",
                height: 8,
                background: "var(--muted)",
                borderRadius: 4,
                overflow: "hidden",
              }}
              role="progressbar"
              aria-valuenow={data.processed}
              aria-valuemin={0}
              aria-valuemax={total}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: 8,
                  background: "var(--primary)",
                  transition: "width 200ms linear",
                }}
              />
            </div>
            <span className="text-[13px] text-muted-foreground">
              {numberFmt.format(data.processed)} / {numberFmt.format(total)} rows · {pct}%
            </span>
          </>
        ) : (
          <span className="text-[13px] text-muted-foreground">Processing…</span>
        )}
        {counters}
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="cmp-pick-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="cmp-icon-tile cmp-icon-tile-success">
            <CheckCircle size={18} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span className="font-medium text-[13px]">Import completed</span>
            <span
              className="text-[13px] text-muted-foreground"
              title={filename}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {filename}
            </span>
          </div>
        </div>
        {counters}
        {errorsList}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="cmp-pick-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <XCircle size={20} color="var(--destructive)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span className="font-medium text-[13px]">Import failed</span>
            <span
              className="text-[13px] text-muted-foreground"
              title={filename}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {filename}
            </span>
          </div>
        </div>
        {data.last_error && (
          <div
            className="text-[13px]"
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
              color: "var(--destructive)",
              border: "1px solid color-mix(in srgb, var(--destructive) 25%, transparent)",
            }}
          >
            {data.last_error}
          </div>
        )}
        {counters}
        {errorsList}
      </div>
    );
  }

  if (status === "cancelled") {
    return (
      <div className="cmp-pick-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <AlertTriangle size={20} color="var(--warning, #d97706)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span className="font-medium text-[13px]">Import cancelled</span>
            <span
              className="text-[13px] text-muted-foreground"
              title={filename}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {filename}
            </span>
          </div>
        </div>
        {counters}
      </div>
    );
  }

  return <div />;
}
