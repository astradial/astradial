"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Volume2, CheckCircle2, AlertCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export interface GreetingNodeData extends Record<string, unknown> {
  language: string;
  voice: string;
  text: string;
  greetingFile: string | null;
}

export default function GreetingNode({ data, selected }: NodeProps) {
  const d = data as GreetingNodeData;
  const hasGreeting = !!d.greetingFile;
  return (
    <div
      className={`rounded-lg border-2 bg-white dark:bg-neutral-800 shadow-sm min-w-[240px] max-w-[280px] ${
        selected
          ? "border-blue-500"
          : "border-neutral-300 dark:border-neutral-600"
      }`}
    >
      <Handle type="target" position={Position.Left} className="bg-neutral-400!" />
      <div className="border-b border-neutral-200 dark:border-neutral-700 px-3 py-2 flex items-center gap-2">
        <Volume2 className="h-3.5 w-3.5 text-indigo-600" />
        <span className="text-xs font-semibold">Greeting</span>
        <div className="ml-auto">
          {hasGreeting ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
          )}
        </div>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {d.language}
          </Badge>
          <span className="text-[10px] text-muted-foreground font-mono truncate">
            {d.voice.replace(/^.*?-(?=Chirp3-HD|Chirp3|Wavenet|Neural2|Studio|Standard)/, "")}
          </span>
        </div>
        {d.text ? (
          <div className="text-xs text-muted-foreground line-clamp-3 leading-snug">
            {d.text}
          </div>
        ) : (
          <div className="text-xs italic text-muted-foreground">
            No greeting text yet
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="bg-neutral-400!"
      />
    </div>
  );
}
