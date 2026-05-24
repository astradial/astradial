"use client";

import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Campaign } from "@/lib/campaigns/types";

import { CampaignStatusPill } from "./CampaignStatusPill";
import { MiniFunnel } from "./MiniFunnel";

interface Props {
  campaign: Campaign;
  templateName?: string | null;
  onOpen: () => void;
  onLaunch?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onDelete?: () => void;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

export function CampaignCard({
  campaign: c,
  templateName,
  onOpen,
  onLaunch,
  onPause,
  onResume,
  onDelete,
}: Props) {
  const total = c.stats?.total ?? 0;
  const showFunnel = c.status !== "draft" && c.status !== "scheduled";

  return (
    <div className="cmp-card" onClick={onOpen} role="button" tabIndex={0}>
      <div className="cmp-card-head">
        <div className="min-w-0">
          <h3 className="cmp-card-title truncate">{c.name}</h3>
          <div className="cmp-card-meta">
            {templateName || "—"} · {total.toLocaleString()} leads
          </div>
        </div>
        <CampaignStatusPill status={c.status} />
      </div>

      {showFunnel ? (
        <MiniFunnel
          total={total}
          funnel={{
            contacted: c.stats?.contacted ?? 0,
            engaged: c.stats?.engaged ?? 0,
            interested: c.stats?.interested ?? 0,
            qualified: c.stats?.qualified ?? 0,
          }}
        />
      ) : (
        <div className="text-[13px] text-muted-foreground py-2">
          {c.status === "draft"
            ? "Not started — finish setup to launch"
            : `Scheduled for ${c.start_at ? new Date(c.start_at).toLocaleString() : "—"}`}
        </div>
      )}

      <div className="cmp-card-foot">
        <span className="text-xs text-muted-foreground">Last activity {relTime(c.updatedAt)}</span>
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(c.status === "draft" || c.status === "scheduled") && onLaunch && (
                <DropdownMenuItem onClick={onLaunch}>Launch</DropdownMenuItem>
              )}
              {c.status === "running" && onPause && (
                <DropdownMenuItem onClick={onPause}>Pause</DropdownMenuItem>
              )}
              {c.status === "paused" && onResume && (
                <DropdownMenuItem onClick={onResume}>Resume</DropdownMenuItem>
              )}
              {c.status !== "running" && onDelete && (
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export function CampaignEmpty() {
  return (
    <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground col-span-full flex flex-col items-center gap-2">
      <Target className="h-6 w-6" />
      <div>No campaigns in this state.</div>
    </div>
  );
}
