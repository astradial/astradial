"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Globe, MessageSquare, Phone, Ticket, Mail, Clock, FileText } from "lucide-react";

const actionIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  http_request: Globe,
  send_whatsapp: MessageSquare,
  place_call: Phone,
  create_ticket: Ticket,
  send_email: Mail,
  delay: Clock,
  log: FileText,
  repeat_daily: Clock,
  action: Globe,
};

const actionColors: Record<string, string> = {
  http_request: "border-emerald-500",
  send_whatsapp: "border-green-500",
  place_call: "border-violet-500",
  create_ticket: "border-amber-500",
  send_email: "border-sky-500",
  delay: "border-orange-500",
  log: "border-neutral-400",
  repeat_daily: "border-purple-500",
  action: "border-neutral-400",
};

const iconBgColors: Record<string, string> = {
  http_request: "bg-emerald-500/10 text-emerald-500",
  send_whatsapp: "bg-green-500/10 text-green-500",
  place_call: "bg-violet-500/10 text-violet-500",
  create_ticket: "bg-amber-500/10 text-amber-500",
  send_email: "bg-sky-500/10 text-sky-500",
  delay: "bg-orange-500/10 text-orange-500",
  log: "bg-neutral-400/10 text-neutral-400",
  repeat_daily: "bg-purple-500/10 text-purple-500",
  action: "bg-neutral-400/10 text-neutral-400",
};

export function ActionNode({ data, type }: NodeProps) {
  const nodeType = String(type || "action");
  const Icon = actionIcons[nodeType] || Globe;
  const borderColor = actionColors[nodeType] || "border-neutral-400";
  const iconBg = iconBgColors[nodeType] || "bg-neutral-400/10 text-neutral-400";

  return (
    <div className={`rounded-lg border-2 ${borderColor} bg-card shadow-sm px-4 py-3 min-w-[180px]`}>
      <Handle type="target" position={Position.Top} className="!bg-foreground !w-3 !h-3 !border-2 !border-background" />
      <div className="flex items-center gap-2">
        <div className={`h-7 w-7 rounded-full ${iconBg} flex items-center justify-center`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-xs font-medium text-foreground">{String(data.label)}</div>
          <div className="text-[10px] text-muted-foreground capitalize">{nodeType.replace(/_/g, " ")}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-foreground !w-3 !h-3 !border-2 !border-background" />
    </div>
  );
}
