"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { showToast } from "@/components/ui/Toast";
import { campaigns, CampaignsApiError } from "@/lib/campaigns/client";

interface CapEditModalProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  current: {
    max_concurrent_calls: number | null;
    max_sends_per_minute: number | null;
    avg_call_seconds: number;
  };
  onSaved: () => void;
}

export function CapEditModal({
  open,
  onClose,
  campaignId,
  current,
  onSaved,
}: CapEditModalProps) {
  const qc = useQueryClient();

  const [maxConcurrent, setMaxConcurrent] = useState<string>(
    current.max_concurrent_calls !== null ? String(current.max_concurrent_calls) : ""
  );
  const [maxSends, setMaxSends] = useState<string>(
    current.max_sends_per_minute !== null ? String(current.max_sends_per_minute) : ""
  );
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMaxConcurrent(
      current.max_concurrent_calls !== null ? String(current.max_concurrent_calls) : ""
    );
    setMaxSends(
      current.max_sends_per_minute !== null ? String(current.max_sends_per_minute) : ""
    );
    setConflictMsg(null);
  }, [open, current.max_concurrent_calls, current.max_sends_per_minute]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const saveMut = useMutation({
    mutationFn: () => {
      const data: {
        max_concurrent_calls?: number | null;
        max_sends_per_minute?: number | null;
      } = {};
      if (maxConcurrent !== "") {
        const v = parseInt(maxConcurrent, 10);
        if (!isNaN(v)) data.max_concurrent_calls = v;
      } else {
        data.max_concurrent_calls = null;
      }
      if (maxSends !== "") {
        const v = parseInt(maxSends, 10);
        if (!isNaN(v)) data.max_sends_per_minute = v;
      } else {
        data.max_sends_per_minute = null;
      }
      return campaigns.update(campaignId, data);
    },
    onSuccess: () => {
      showToast("Throughput caps updated", "success");
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "dashboard"] });
      onSaved();
      onClose();
    },
    onError: (e: unknown) => {
      if (e instanceof CampaignsApiError && e.status === 409) {
        setConflictMsg(e.body || e.message);
      } else {
        showToast((e as Error).message, "error");
      }
    },
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || !open) return null;

  const body = (
    <div className="cmp-modal-overlay" onClick={onClose}>
      <div
        className="cmp-modal"
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmp-modal-head">
          <div>
            <h2 className="cmp-modal-title">Edit throughput caps</h2>
            <p className="cmp-modal-sub">Adjust concurrency limits for this campaign</p>
          </div>
          <button
            type="button"
            className="cmp-icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="cmp-modal-body">
          <div className="flex flex-col gap-4">
            <div>
              <label className="cmp-label" htmlFor="cap-max-concurrent">
                Max concurrent calls
              </label>
              <input
                id="cap-max-concurrent"
                type="number"
                className="cmp-input"
                min={1}
                max={500}
                value={maxConcurrent}
                onChange={(e) => {
                  setMaxConcurrent(e.target.value);
                  setConflictMsg(null);
                }}
                placeholder="e.g. 10"
              />
            </div>
            <div>
              <label className="cmp-label" htmlFor="cap-max-sends">
                WhatsApp sends / minute{" "}
                <span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}>
                  (optional)
                </span>
              </label>
              <input
                id="cap-max-sends"
                type="number"
                className="cmp-input"
                min={1}
                max={10000}
                value={maxSends}
                onChange={(e) => {
                  setMaxSends(e.target.value);
                  setConflictMsg(null);
                }}
                placeholder="e.g. 60"
              />
            </div>
            {conflictMsg && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "oklch(0.97 0.02 27)",
                  border: "1px solid oklch(0.88 0.06 27)",
                  color: "oklch(0.45 0.15 27)",
                  fontSize: 13,
                }}
              >
                {conflictMsg}
              </div>
            )}
          </div>
        </div>

        <div className="cmp-modal-foot">
          <button
            type="button"
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            onClick={onClose}
            disabled={saveMut.isPending}
          >
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="cmp-btn cmp-btn-default cmp-btn-sm"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
