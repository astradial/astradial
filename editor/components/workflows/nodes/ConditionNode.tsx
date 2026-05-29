"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export function ConditionNode({ data }: NodeProps) {
  return (
    <div className="rounded-lg border-2 border-yellow-500 bg-card shadow-sm px-4 py-3 min-w-[180px]">
      <Handle type="target" position={Position.Top} className="!bg-foreground !w-3 !h-3 !border-2 !border-background" />
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-yellow-500/10 flex items-center justify-center">
          <GitBranch className="h-4 w-4 text-yellow-500" />
        </div>
        <div>
          <div className="text-xs font-medium text-foreground">{String(data.label)}</div>
          <div className="text-[10px] text-muted-foreground">If/else branch</div>
        </div>
      </div>
      <div className="flex justify-between mt-2">
        <Handle type="source" position={Position.Bottom} id="true" className="!bg-green-500 !w-3 !h-3 !border-2 !border-background !left-[30%]" />
        <Handle type="source" position={Position.Bottom} id="false" className="!bg-red-500 !w-3 !h-3 !border-2 !border-background !left-[70%]" />
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-muted-foreground px-1">
        <span>True</span>
        <span>False</span>
      </div>
    </div>
  );
}
