"use client";

// Per UI.md §11.8. Renders one row inside .cmp-timeline.
// Variant classes: cmp-tl-icon-success | -primary | -warning | -info.

import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  MessageCircle,
  Pause,
  Phone,
  PhoneCall,
  PhoneIncoming,
  Play,
  XCircle,
} from "lucide-react";
import { memo, type ReactNode } from "react";

import type { CampaignEvent, EventKind } from "@/lib/campaigns/types";

type Variant = "" | "success" | "primary" | "warning" | "info";

interface IconDef {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  variant: Variant;
}

// Per UI.md §11.8 icon table — every EventKind must map.
const KIND_ICON: Record<EventKind, IconDef> = {
  enrolled:           { Icon: Play,         variant: "primary" },
  whatsapp_sent:      { Icon: MessageCircle, variant: "" },
  whatsapp_delivered: { Icon: MessageCircle, variant: "" },
  whatsapp_replied:   { Icon: MessageCircle, variant: "primary" },
  call_started:       { Icon: PhoneCall,     variant: "info" },
  call_completed:     { Icon: PhoneCall,     variant: "info" },
  call_failed:        { Icon: XCircle,       variant: "warning" },
  call_interested:    { Icon: PhoneIncoming, variant: "success" },
  call_engaged:       { Icon: PhoneIncoming, variant: "primary" },
  status_changed:     { Icon: Clock,        variant: "" },
  qualified:          { Icon: CheckCircle2, variant: "success" },
  disqualified:       { Icon: XCircle,      variant: "warning" },
  halted:             { Icon: Pause,        variant: "warning" },
  approval_created:   { Icon: AlertCircle,  variant: "warning" },
  approval_decided:   { Icon: Check,        variant: "success" },
};

function eventTitle(kind: EventKind): string {
  switch (kind) {
    case "enrolled": return "Lead entered campaign";
    case "whatsapp_sent": return "WhatsApp sent";
    case "whatsapp_delivered": return "WhatsApp delivered";
    case "whatsapp_replied": return "Replied";
    case "call_started": return "Call started";
    case "call_completed": return "Call completed";
    case "call_failed": return "Call failed";
    case "call_interested": return "Interested (call)";
    case "call_engaged": return "Engaged (call)";
    case "status_changed": return "Status changed";
    case "qualified": return "Qualified by rules";
    case "disqualified": return "Disqualified";
    case "halted": return "Workflow halted";
    case "approval_created": return "Approval requested";
    case "approval_decided": return "Approval decided";
    default: return kind;
  }
}

function eventDetail(ev: CampaignEvent): { detail?: string; quote?: boolean } {
  const p = (ev.payload || {}) as Record<string, unknown>;
  if (ev.kind === "whatsapp_sent") {
    const template = p.template_name ? String(p.template_name) : "—";
    const direction = p.direction ? String(p.direction) : "outbound";
    const status = p.send_status ? String(p.send_status) : "sent";
    const detailText = typeof p.detail === "string" ? p.detail : "";

    const dirDisplay = direction.charAt(0).toUpperCase() + direction.slice(1);
    const statusDisplay = status.charAt(0).toUpperCase() + status.slice(1);

    const parts = [];
    parts.push(`Template: ${template}`);
    parts.push(dirDisplay);
    parts.push(`Status: ${statusDisplay}`);
    if (detailText) {
      parts.push(detailText);
    }
    return { detail: parts.join(" · ") };
  }
  if (ev.kind === "whatsapp_replied" && typeof p.text === "string") {
    return { detail: `"${p.text}"`, quote: true };
  }
  if (ev.kind === "call_completed" && typeof p.duration_label === "string") {
    return { detail: `${p.duration_label} · ${p.direction || "outbound"}` };
  }
  if ((ev.kind === "call_interested" || ev.kind === "call_engaged") && typeof p.transcript === "string") {
    const preview = p.transcript.length > 120 ? p.transcript.slice(0, 120) + "…" : p.transcript;
    return { detail: `"${preview}"`, quote: true };
  }
  if (typeof p.detail === "string") return { detail: p.detail };
  return {};
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

interface Props {
  event: CampaignEvent;
  action?: ReactNode;
}

export const TimelineItem = memo(
  function TimelineItem({ event, action }: Props) {
    const def = KIND_ICON[event.kind] || { Icon: Clock, variant: "" as Variant };
    const { Icon, variant } = def;
    const { detail, quote } = eventDetail(event);
    const iconCls = variant ? `cmp-tl-icon cmp-tl-icon-${variant}` : "cmp-tl-icon";
    return (
      <div className="cmp-tl-item">
        <span className={iconCls}>
          <Icon size={11} />
        </span>
        <div className="cmp-tl-body">
          <div className="cmp-tl-head">
            <span className="cmp-tl-title">{eventTitle(event.kind)}</span>
            <span className="cmp-tl-time">{relTime(event.createdAt)}</span>
          </div>
          {detail &&
            (quote ? (
              <div className="cmp-tl-quote">{detail}</div>
            ) : (
              <div className="cmp-tl-detail">{detail}</div>
            ))}
          {action && <div style={{ marginTop: 8 }}>{action}</div>}
        </div>
      </div>
    );
  },
  (prev, next) => prev.event.id === next.event.id && prev.action === next.action
);
