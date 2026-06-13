// Exact reproduction of the design's StatusPill — labels + dot statuses
// match Astra Campaign-handoff/app/screens/raw-leads.jsx#StatusPill.

const LABELS: Record<string, string> = {
  raw: "Raw",
  contacted: "Contacted",
  engaged: "Engaged",
  interested: "Interested",
  qualified: "Qualified",
  disqualified: "Disqualified",
  dnc: "Do not contact",
  running: "Running",
  draft: "Draft",
  paused: "Paused",
  completed: "Completed",
  scheduled: "Scheduled",
  pending: "Pending",
  archived: "Archived",
  published: "Published",
};

const DOT_STATUSES = new Set(["contacted", "engaged", "interested", "qualified", "dnc", "running"]);

export function CampaignStatusPill({ status }: { status: string }) {
  return (
    <span className={`cmp-status-pill cmp-status-${status}`}>
      {DOT_STATUSES.has(status) ? <span className="cmp-status-pill-dot" /> : null}
      {LABELS[status] || status}
    </span>
  );
}
