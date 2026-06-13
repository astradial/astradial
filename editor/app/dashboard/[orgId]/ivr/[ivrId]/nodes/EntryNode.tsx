"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export interface EntryNodeData extends Record<string, unknown> {
  name: string;
  extension: string;
  timeout: number;
  maxRetries: number;
  directDial: boolean;
}

export default function EntryNode({ data, selected }: NodeProps) {
  const d = data as EntryNodeData;
  return (
    <div
      className={`rounded-lg border-2 bg-white dark:bg-neutral-800 shadow-sm min-w-[200px] ${
        selected ? "border-blue-500" : "border-neutral-300 dark:border-neutral-600"
      }`}
    >
      <div className="border-b border-neutral-200 dark:border-neutral-700 px-3 py-2 flex items-center gap-2">
        <Phone className="h-3.5 w-3.5 text-emerald-600" />
        <span className="text-xs font-semibold">Entry</span>
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="text-sm font-medium truncate">{d.name || "Untitled"}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
            ext {d.extension}
          </Badge>
          <span>·</span>
          <span>{d.timeout}s timeout</span>
          <span>·</span>
          <span>{d.maxRetries} retries</span>
        </div>
        {d.directDial && <div className="text-[10px] text-muted-foreground">Direct dial ON</div>}
      </div>
      <Handle type="source" position={Position.Right} className="bg-neutral-400!" />
    </div>
  );
}
