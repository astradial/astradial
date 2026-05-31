"use client";

// Per UI.md §11.4. Search (debounced 300ms by parent via useDeferredValue),
// status filter dropdown and view switcher.

import { LayoutDashboard, List as ListIcon, Search } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LeadStatus } from "@/lib/campaigns/types";

type StatusFilter = LeadStatus | "all";
type View = "kanban" | "list";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (s: StatusFilter) => void;
  view: View;
  onViewChange: (v: View) => void;
  // Counts per status, used in dropdown labels.
  counts?: Partial<Record<LeadStatus | "all", number>>;
}

const numberFmt = new Intl.NumberFormat("en-US");

function label(s: LeadStatus | "all", counts: Props["counts"]): string {
  const n = counts?.[s];
  const nLabel = typeof n === "number" ? ` (${numberFmt.format(n)})` : "";
  switch (s) {
    case "all": return `All statuses${nLabel}`;
    case "qualified": return `Qualified${nLabel}`;
    case "interested": return `Interested${nLabel}`;
    case "engaged": return `Engaged${nLabel}`;
    case "contacted": return `Contacted${nLabel}`;
    case "disqualified": return `Disqualified${nLabel}`;
    case "dnc": return `Do not contact${nLabel}`;
    case "raw": return `Raw${nLabel}`;
  }
}

const STATUS_ORDER: StatusFilter[] = [
  "all", "qualified", "interested", "engaged", "contacted", "disqualified", "dnc", "raw",
];

export function LeadsToolbar({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  view,
  onViewChange,
  counts,
}: Props) {
  return (
    <div className="cmp-leads-toolbar">
      <div className="cmp-leads-toolbar-left">
        <div className="cmp-search-wrap">
          <Search />
          <input
            type="search"
            className="cmp-input cmp-search-input"
            placeholder="Search by name, business, phone…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search leads"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilterChange(value as StatusFilter)}
        >
          <SelectTrigger
            className="h-9 w-auto min-w-[180px] text-[13.5px]"
            aria-label="Filter by status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Status</SelectLabel>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {label(s, counts)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="cmp-view-switcher" role="tablist" aria-label="View">
        <button
          type="button"
          role="tab"
          aria-selected={view === "kanban"}
          className={view === "kanban" ? "cmp-active" : ""}
          onClick={() => onViewChange("kanban")}
        >
          <LayoutDashboard size={14} /> Kanban
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "list"}
          className={view === "list" ? "cmp-active" : ""}
          onClick={() => onViewChange("list")}
        >
          <ListIcon size={14} /> List
        </button>
      </div>
    </div>
  );
}
