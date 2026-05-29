"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Webhook, Clock, Zap } from "lucide-react";

const triggerIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  webhook: Webhook,
  scheduled: Clock,
  recurring: Clock,
  event: Zap,
};

export function TriggerNode({ data }: NodeProps) {
  const triggerType = (data as Record<string, unknown>).triggerType as string || "webhook";
  const Icon = triggerIcons[triggerType] || Webhook;

  return (
    <div className="rounded-lg border-2 border-blue-500 bg-card shadow-sm px-4 py-3 min-w-[180px]">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-blue-500/10 flex items-center justify-center">
          <Icon className="h-4 w-4 text-blue-500" />
        </div>
        <div>
          <div className="text-xs font-medium text-foreground">{String(data.label)}</div>
          <div className="text-[10px] text-muted-foreground capitalize">{triggerType} trigger</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500 !w-3 !h-3 !border-2 !border-background" />
    </div>
  );
}
