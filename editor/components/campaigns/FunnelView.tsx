"use client";

// 5-step funnel with live tick. Per UI.md §11.2.
// Bar fill colour is primary blue oklch(0.55 0.22 264) for all 5 steps
// (different from the campaign-card MiniFunnel which colours each step).

import { memo, useEffect, useState } from "react";

const numberFmt = new Intl.NumberFormat("en-US");

interface FunnelData {
  total: number;
  contacted: number;
  engaged: number;
  interested: number;
  qualified: number;
}

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100) || 0;
}

interface StepProps {
  label: string;
  value: number;
  sub: string;
  pctValue: number;
  showPct: boolean;
}

const FunnelStep = memo(function FunnelStep({ label, value, sub, pctValue, showPct }: StepProps) {
  return (
    <div className="cmp-funnel-step">
      <span className="cmp-funnel-step-label">{label}</span>
      <span className="cmp-funnel-step-value">{numberFmt.format(value)}</span>
      <div className="cmp-funnel-step-meta">
        <span className="cmp-funnel-step-sub">{sub}</span>
        {showPct && <span className="cmp-funnel-step-pct">{pctValue}%</span>}
      </div>
      <div className="cmp-funnel-step-bar">
        <div className="cmp-funnel-step-bar-fill" style={{ width: `${pctValue}%` }} />
      </div>
    </div>
  );
});

export function FunnelView({ data }: { data: FunnelData }) {
  const total = data.total || 1;
  const steps: StepProps[] = [
    { label: "Total", value: data.total, sub: "in campaign", pctValue: data.total > 0 ? 100 : 0, showPct: false },
    {
      label: "Contacted",
      value: data.contacted,
      sub: "first touch sent",
      pctValue: pct(data.contacted, total),
      showPct: true,
    },
    {
      label: "Engaged",
      value: data.engaged,
      sub: "replied or answered",
      pctValue: pct(data.engaged, total),
      showPct: true,
    },
    {
      label: "Interested",
      value: data.interested,
      sub: "matches some rules",
      pctValue: pct(data.interested, total),
      showPct: true,
    },
    {
      label: "Qualified",
      value: data.qualified,
      sub: "marked for handoff",
      pctValue: pct(data.qualified, total),
      showPct: true,
    },
  ];
  return (
    <div className="cmp-funnel">
      {steps.map((s) => (
        <FunnelStep key={s.label} {...s} />
      ))}
    </div>
  );
}

// Live-tick badge — shown next to the "Funnel" heading. Counts seconds
// since last refresh, resets when `tickKey` changes (passed by parent
// every time the dashboard query refetches).
export function FunnelLiveTag({ tickKey }: { tickKey: number }) {
  // Reset-on-key-change pattern. We deliberately reset seconds to 0 here
  // every time the parent's tickKey moves (i.e. dashboard refetch succeeded).
  // The rule lint disable is intentional — there is no derived-from-state
  // path that captures "newly-arrived data, restart the counter."
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeconds(0);
    const id = setInterval(() => setSeconds((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [tickKey]);
  return (
    <div className="cmp-funnel-livetag">
      <span className="text-xs text-muted-foreground">Updated</span>
      <span className="cmp-funnel-livetag-dot" />
      <span>live · {seconds}s ago</span>
    </div>
  );
}
