"use client";

import { Trash2 } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ActionJson } from "@/lib/schema/flow.schema";

interface ActionItemProps {
  action: ActionJson;
  index: number;
  onUpdate: (updates: Partial<ActionJson>) => void;
  onRemove: () => void;
}

export function ActionItem({ action, index, onUpdate, onRemove }: ActionItemProps) {
  const actionTypeId = useId();
  const actionHandlerId = useId();
  const actionTextId = useId();
  const actionUrlId = useId();
  const actionBodyId = useId();
  const actionAuthId = useId();

  return (
    <div className="flex flex-col gap-2 rounded border p-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 space-y-2">
          <label htmlFor={actionTypeId} className="sr-only">
            Action Type
          </label>
          <Select value={action.type} onValueChange={(v) => onUpdate({ type: v })}>
            <SelectTrigger id={actionTypeId} className="h-8 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="function">Function</SelectItem>
              <SelectItem value="end_conversation">End Conversation</SelectItem>
              <SelectItem value="tts_say">TTS Say</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {action.type === "function" && (
          <div className="w-32 space-y-2">
            <label htmlFor={actionHandlerId} className="sr-only">
              Handler
            </label>
            <Input
              id={actionHandlerId}
              className="h-8 text-xs w-32"
              value={action.handler ?? ""}
              onChange={(e) => onUpdate({ handler: e.target.value })}
              placeholder="Handler"
            />
          </div>
        )}
        {action.type === "tts_say" && (
          <div className="flex-1 space-y-2">
            <label htmlFor={actionTextId} className="sr-only">
              Text to say
            </label>
            <Input
              id={actionTextId}
              className="h-8 text-xs flex-1"
              value={action.text ?? ""}
              onChange={(e) => onUpdate({ text: e.target.value })}
              placeholder="Text to say"
            />
          </div>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8" onClick={onRemove}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove action</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {action.type === "webhook" && (
        <div className="space-y-2 pl-1">
          <div>
            <label htmlFor={actionUrlId} className="text-xs text-muted-foreground mb-1 block">
              URL
            </label>
            <Input
              id={actionUrlId}
              className="h-8 text-xs"
              value={action.url ?? ""}
              onChange={(e) => onUpdate({ url: e.target.value })}
              placeholder="http://localhost:3000/api/v1/calls/{call.channel_id}/transfer"
            />
          </div>
          <div>
            <label htmlFor={actionBodyId} className="text-xs text-muted-foreground mb-1 block">
              Body (JSON with template variables)
            </label>
            <Textarea
              id={actionBodyId}
              className="text-xs font-mono min-h-[80px]"
              value={typeof action.body === "object" ? JSON.stringify(action.body, null, 2) : (action.body ?? "")}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  onUpdate({ body: parsed });
                } catch {
                  // Allow invalid JSON while typing
                  onUpdate({ body: e.target.value as any });
                }
              }}
              placeholder={'{\n  "destination": "{state.queue_number}",\n  "destination_type": "queue"\n}'}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Templates: {"{call.channel_id}"}, {"{state.xxx}"}, {"{args.xxx}"}, {"{value_map.name.key}"}
            </p>
          </div>
          <div>
            <label htmlFor={actionAuthId} className="text-xs text-muted-foreground mb-1 block">
              Auth Mode
            </label>
            <Select value={action.auth ?? ""} onValueChange={(v) => onUpdate({ auth: v || undefined })}>
              <SelectTrigger id={actionAuthId} className="h-8 text-xs">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="internal">Internal (localhost AstraPBX)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
