"use client";

// Per UI.md §11.9. Portal-mounted, modal-lg sizing, 2-column transcript.
// Handles "not ready yet" (HTTP 202) per §11.24.9.

import { useQuery } from "@tanstack/react-query";
import { Check, Download, FileText, Flag, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { leads } from "@/lib/campaigns/client";
import type { TranscriptMessage } from "@/lib/campaigns/types";

interface Props {
  open: boolean;
  campaignId: string;
  leadId: string;
  eventId: string;
  leadName: string;
  onClose: () => void;
}

function getRecordingUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  const candidates = [
    payload.recordingUrl,
    payload.recording_url,
    payload.recordingPath,
    payload.recording_path,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof found === "string" ? found : null;
}

export function TranscriptModal({ open, campaignId, leadId, eventId, leadName, onClose }: Props) {
  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const q = useQuery({
    queryKey: ["campaigns", campaignId, "leads", leadId, "transcript", eventId],
    queryFn: ({ signal }) => leads.transcript(campaignId, leadId, eventId, { signal }),
    enabled: open,
    staleTime: 60_000,
  });

  if (!open || typeof window === "undefined") return null;

  const data = q.data;
  const ready = data?.ready === true;
  const recordingUrl = ready ? getRecordingUrl(data) : null;
  // Per USER_REQUEST: show the bot and user transcript table like reference UI has, but show only the user transcript now
  const agentMsgs: TranscriptMessage[] = [];
  const customerMsgs: TranscriptMessage[] = ready
    ? (data?.messages ?? []).filter((m) => m.speaker === "customer")
    : [];

  return createPortal(
    <div
      className="cmp-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 80 }}
    >
      <div className="cmp-modal cmp-modal-lg" onClick={(e) => e.stopPropagation()} role="document">
        <div className="cmp-modal-head">
          <div>
            <h2 className="cmp-modal-title">Call transcript · {leadName}</h2>
            {ready && data?.qualificationLine ? (
              <p className="cmp-modal-sub">
                {data.durationLabel ? `Duration ${data.durationLabel} · ` : ""}
                {data.direction || "outbound"} · qualification: {data.qualificationLine}
              </p>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {recordingUrl ? (
              <a
                className="cmp-btn cmp-btn-outline cmp-btn-sm"
                href={recordingUrl}
                download
                target="_blank"
                rel="noreferrer"
              >
                <Download size={14} /> Recording
              </a>
            ) : ready ? (
              <button
                className="cmp-btn cmp-btn-outline cmp-btn-sm"
                disabled
                title="No recording is available for this call"
              >
                <Download size={14} /> Recording unavailable
              </button>
            ) : null}
            <button className="cmp-toolbar-icon-btn" onClick={onClose} aria-label="Close">
              <X />
            </button>
          </div>
        </div>

        <div className="cmp-modal-body">
          {q.isPending && (
            <div className="cmp-empty" style={{ padding: 48 }}>
              <div className="cmp-skeleton-line" style={{ width: 240, height: 16 }} />
            </div>
          )}

          {q.isError && (
            <div className="cmp-empty" style={{ padding: 48 }}>
              <FileText size={28} />
              <div className="cmp-empty-title">Couldn&apos;t load transcript</div>
              <button className="cmp-btn cmp-btn-outline cmp-btn-sm" onClick={() => q.refetch()}>
                Try again
              </button>
            </div>
          )}

          {!q.isPending && !q.isError && !ready && (
            <div className="cmp-empty" style={{ padding: 48 }}>
              <FileText size={32} />
              <div className="cmp-empty-title">Transcript not ready yet</div>
              <div className="cmp-empty-sub">
                Processing typically completes within 30 seconds of call end.
              </div>
              <button className="cmp-btn cmp-btn-outline cmp-btn-sm" onClick={() => q.refetch()}>
                Check again
              </button>
            </div>
          )}

          {ready && (
            <>
              {data?.signals?.length ? (
                <div className="cmp-transcript-signals">
                  {data.signals.map((s) => (
                    <span key={s} className="cmp-transcript-signal">
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="cmp-transcript-wrap">
                <div className="cmp-transcript-col">
                  <div className="cmp-transcript-col-head">Bot / agent</div>
                  {agentMsgs.length > 0 ? (
                    agentMsgs.map((m, i) => (
                      <div key={i} className="cmp-tx-msg">
                        <div className="cmp-tx-time">{m.t}</div>
                        <div>{m.text}</div>
                      </div>
                    ))
                  ) : (
                    <div className="cmp-empty-sub">No bot transcript found.</div>
                  )}
                </div>
                <div className="cmp-transcript-col">
                  <div className="cmp-transcript-col-head">User / customer · {leadName}</div>
                  {customerMsgs.length > 0 ? (
                    customerMsgs.map((m, i) => (
                      <div key={i} className="cmp-tx-msg">
                        <div className="cmp-tx-time">{m.t}</div>
                        <div>
                          {m.text}
                          {m.signal && <span className="cmp-tx-signal">{m.signal}</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="cmp-empty-sub">No user transcript found.</div>
                  )}
                </div>
              </div>

              {data?.summary && (
                <>
                  <div className="cmp-transcript-summary-kicker">Call summary</div>
                  <div className="cmp-transcript-summary">{data.summary}</div>
                </>
              )}
            </>
          )}
        </div>

        <div className="cmp-modal-foot">
          <button className="cmp-btn cmp-btn-ghost cmp-btn-sm" onClick={onClose}>
            Close
          </button>
          {ready && (
            <>
              <button className="cmp-btn cmp-btn-outline cmp-btn-sm">
                <Flag size={14} /> Mark for review
              </button>
              <button className="cmp-btn cmp-btn-default cmp-btn-sm">
                <Check size={14} /> Mark interested
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
