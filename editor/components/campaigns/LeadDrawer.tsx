"use client";

// Per UI.md §11.7. Slide-in panel on the right. Status changer wires
// PATCH /campaigns/:id/leads/:leadId with optimistic rollback (§11.23.4).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronDown, Clock, Pause, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { CampaignStatusPill } from "./CampaignStatusPill";
import { TimelineItem } from "./TimelineItem";
import { showToast } from "@/components/ui/Toast";
import { leads as leadsApi } from "@/lib/campaigns/client";
import type { CampaignEvent, CampaignLead, LeadStatus } from "@/lib/campaigns/types";

const TranscriptModal = lazy(() =>
  import("./TranscriptModal").then((m) => ({ default: m.TranscriptModal }))
);

const STATUS_OPTIONS: { id: LeadStatus; label: string }[] = [
  { id: "raw", label: "Raw" },
  { id: "contacted", label: "Contacted" },
  { id: "engaged", label: "Engaged" },
  { id: "interested", label: "Interested" },
  { id: "qualified", label: "Qualified" },
  { id: "disqualified", label: "Disqualified" },
  { id: "dnc", label: "Do not contact" },
];

interface Props {
  open: boolean;
  campaignId: string;
  leadId: string | null;
  onClose: () => void;
}

export function LeadDrawer({ open, campaignId, leadId, onClose }: Props) {
  const qc = useQueryClient();
  const [transcriptOpen, setTranscriptOpen] = useState<{ eventId: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const leadQ = useQuery({
    queryKey: ["campaigns", campaignId, "leads", leadId],
    queryFn: ({ signal }) => leadsApi.get(campaignId, leadId as string, { signal }),
    enabled: open && !!leadId,
  });

  const timelineQ = useQuery({
    queryKey: ["campaigns", campaignId, "leads", leadId, "timeline"],
    queryFn: ({ signal }) =>
      leadsApi.timeline(campaignId, leadId as string, { limit: 50 }, { signal }),
    enabled: open && !!leadId,
  });

  const statusMut = useMutation({
    mutationFn: (status: LeadStatus) =>
      leadsApi.update(campaignId, leadId as string, { status }),
    onMutate: async (status) => {
      await qc.cancelQueries({ queryKey: ["campaigns", campaignId, "leads", leadId] });
      const prev = qc.getQueryData<CampaignLead>(["campaigns", campaignId, "leads", leadId]);
      if (prev) {
        qc.setQueryData<CampaignLead>(["campaigns", campaignId, "leads", leadId], {
          ...prev,
          status,
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(["campaigns", campaignId, "leads", leadId], ctx.prev);
      }
      showToast("Status update failed", "error");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "kanban"] });
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "leads"] });
      qc.invalidateQueries({ queryKey: ["campaigns", campaignId, "dashboard"] });
    },
  });

  if (!open || typeof window === "undefined") return null;

  const lead = leadQ.data;
  const timeline = timelineQ.data?.data ?? [];

  // Wrap the "Open transcript" action so it captures the right eventId.
  function timelineAction(ev: CampaignEvent) {
    if (ev.kind !== "call_completed") return undefined;
    return (
      <button
        className="cmp-btn cmp-btn-outline cmp-btn-sm"
        onClick={() => setTranscriptOpen({ eventId: ev.id })}
      >
        Open transcript
      </button>
    );
  }

  return createPortal(
    <>
      <div className="cmp-drawer-overlay" onClick={onClose} />
      <div
        className="cmp-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmp-drawer-title"
      >
        <div className="cmp-drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="cmp-drawer-kicker">LEAD DETAIL</div>
            <div id="cmp-drawer-title" className="cmp-drawer-title">
              {leadQ.isPending ? "Loading…" : lead?.name || "—"}
            </div>
            <div className="cmp-drawer-sub">
              {lead?.business || "—"}
            </div>
          </div>
          <button className="cmp-toolbar-icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>

        <div className="cmp-drawer-body">
          {/* Status changer */}
          {lead && (
            <div className="cmp-status-changer-row">
              <div className="cmp-status-changer-col">
                <label className="cmp-status-changer-label">Status</label>
                <div className="cmp-status-changer">
                  <CampaignStatusPill status={lead.status} />
                  <select
                    className="cmp-status-select"
                    aria-label="Change lead status"
                    value={lead.status}
                    onChange={(e) => statusMut.mutate(e.target.value as LeadStatus)}
                    disabled={statusMut.isPending}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="cmp-status-select-chev" />
                </div>
              </div>
            </div>
          )}

          {/* Meta cards */}
          {lead && (
            <div className="cmp-drawer-meta">
              <div className="cmp-drawer-meta-card">
                <div className="cmp-drawer-meta-label">Phone</div>
                <div className="cmp-drawer-meta-value cmp-mono">{lead.phone}</div>
              </div>
              <div className="cmp-drawer-meta-card">
                <div className="cmp-drawer-meta-label">Source</div>
                <div className="cmp-drawer-meta-value">{lead.source}</div>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div>
            <h3 className="cmp-drawer-h3">Workflow timeline</h3>
            {timelineQ.isPending && (
              <div className="cmp-empty" style={{ padding: 16 }}>
                <div className="cmp-skeleton-line" style={{ width: 200 }} />
              </div>
            )}
            {timelineQ.isError && (
              <div className="cmp-empty" style={{ padding: 24 }}>
                <AlertCircle size={24} />
                <div className="cmp-empty-title">Couldn&apos;t load timeline</div>
                <button
                  className="cmp-btn cmp-btn-outline cmp-btn-sm"
                  onClick={() => timelineQ.refetch()}
                >
                  Retry
                </button>
              </div>
            )}
            {!timelineQ.isPending && !timelineQ.isError && timeline.length === 0 && (
              <div className="cmp-empty" style={{ padding: 24 }}>
                <Clock size={24} />
                <div className="cmp-empty-title">No activity yet</div>
                <div className="cmp-empty-sub">
                  The first WhatsApp will send when the campaign starts.
                </div>
              </div>
            )}
            {timeline.length > 0 && (
              <div className="cmp-timeline">
                {timeline.map((ev) => (
                  <TimelineItem key={ev.id} event={ev} action={timelineAction(ev)} />
                ))}
              </div>
            )}
          </div>

          {lead && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="cmp-btn cmp-btn-outline cmp-btn-sm"
                style={{ flex: 1 }}
                disabled
                title="Lead-level pause coming in PR 5"
              >
                <Pause size={14} /> Pause this run
              </button>
            </div>
          )}
        </div>
      </div>

      {transcriptOpen && lead && leadId && (
        <Suspense fallback={null}>
          <TranscriptModal
            open
            campaignId={campaignId}
            leadId={leadId}
            eventId={transcriptOpen.eventId}
            leadName={lead.name}
            onClose={() => setTranscriptOpen(null)}
          />
        </Suspense>
      )}
    </>,
    document.body
  );
}
