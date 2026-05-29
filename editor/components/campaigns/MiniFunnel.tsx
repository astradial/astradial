// 4-step funnel rendered inside each CampaignCard.
// Matches Astra Campaign-handoff/app/screens/campaigns.jsx#CampaignCard.

export interface FunnelStats {
  contacted: number;
  engaged: number;
  interested: number;
  qualified: number;
}

interface Props {
  total: number;
  funnel: FunnelStats;
}

function Step({
  label,
  value,
  pct,
  first,
}: {
  label: string;
  value: number;
  pct: number;
  first?: boolean;
}) {
  return (
    <div className="cmp-mini-funnel-step">
      <div className="cmp-mini-funnel-label">{label}</div>
      <div className="cmp-mini-funnel-val">{value}</div>
      <div className="cmp-funnel-step-bar">
        <div
          className={`cmp-funnel-step-bar-fill ${first ? "cmp-funnel-first" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function MiniFunnel({ total, funnel }: Props) {
  const denom = total || 1;
  const pct = (n: number) => Math.round((n / denom) * 100) || 0;

  return (
    <div className="cmp-mini-funnel">
      <Step label="Contacted" value={funnel.contacted} pct={pct(funnel.contacted)} first />
      <Step label="Engaged" value={funnel.engaged} pct={pct(funnel.engaged)} />
      <Step label="Interested" value={funnel.interested} pct={pct(funnel.interested)} />
      <Step label="Qualified" value={funnel.qualified} pct={pct(funnel.qualified)} />
    </div>
  );
}
