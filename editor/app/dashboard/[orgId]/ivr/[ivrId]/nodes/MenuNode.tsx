"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  PhoneCall,
  Users,
  ListOrdered,
  Voicemail,
  PhoneOff,
  Sparkles,
  ArrowRight,
  RotateCcw,
  AlertCircle,
} from "lucide-react";

import type { IvrActionType } from "@/lib/pbx/client";

export interface MenuNodeData extends Record<string, unknown> {
  digit: string;
  action_type: IvrActionType;
  destinationLabel: string;
  description: string;
  isValid: boolean;
}

const ACTION_META: Record<
  IvrActionType,
  { label: string; icon: typeof PhoneCall; color: string }
> = {
  extension: { label: "Extension", icon: PhoneCall, color: "text-blue-600" },
  queue: { label: "Queue", icon: ListOrdered, color: "text-purple-600" },
  ivr: { label: "IVR", icon: ArrowRight, color: "text-amber-600" },
  ai_agent: { label: "AI Agent", icon: Sparkles, color: "text-pink-600" },
  voicemail: { label: "Voicemail", icon: Voicemail, color: "text-slate-600" },
  callback: { label: "Callback", icon: RotateCcw, color: "text-teal-600" },
  hangup: { label: "Hang up", icon: PhoneOff, color: "text-red-600" },
};

export default function MenuNode({ data, selected }: NodeProps) {
  const d = data as MenuNodeData;
  const meta = ACTION_META[d.action_type] ?? ACTION_META.extension;
  const Icon = meta.icon;
  return (
    <div
      className={`rounded-lg border-2 bg-white dark:bg-neutral-800 shadow-sm min-w-[220px] ${
        selected
          ? "border-blue-500"
          : d.isValid
            ? "border-neutral-300 dark:border-neutral-600"
            : "border-amber-400"
      }`}
    >
      <Handle type="target" position={Position.Left} className="bg-neutral-400!" />
      <div className="border-b border-neutral-200 dark:border-neutral-700 px-3 py-2 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-neutral-100 dark:bg-neutral-700 text-sm font-mono font-semibold">
          {d.digit}
        </div>
        <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
        <span className="text-xs font-semibold">{meta.label}</span>
        {!d.isValid && (
          <AlertCircle
            className="h-3.5 w-3.5 text-amber-500 ml-auto"
            aria-label="destination required"
          />
        )}
      </div>
      <div className="px-3 py-2">
        <div className="text-sm truncate">
          {d.destinationLabel || (
            <span className="italic text-muted-foreground">
              Pick a destination
            </span>
          )}
        </div>
        {d.description && (
          <div className="text-[10px] text-muted-foreground truncate mt-1">
            {d.description}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="bg-neutral-400!" />
    </div>
  );
}
