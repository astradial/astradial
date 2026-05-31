"use client";

// Per UI.md §11.5. Server-paginated list (no client-side slice).
// `useQuery` keyed by filter object so navigating filters cancels stale
// fetches automatically (TanStack handles AbortController + dedupe).

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from "lucide-react";
import { memo, useState } from "react";

import { CampaignStatusPill } from "./CampaignStatusPill";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leads as leadsApi, type OverviewLeadsResponse } from "@/lib/campaigns/client";
import type { CampaignLead, LeadStatus, Paginated } from "@/lib/campaigns/types";

const numberFmt = new Intl.NumberFormat("en-US");

type SortKey = "name" | "status" | "lastTouch";
type SortDir = "asc" | "desc";
interface SortState {
  key: SortKey;
  dir: SortDir;
}

const PAGE_SIZES = [25, 50, 100, 200];
const DEFAULT_FIELDS = [
  { id: "name", label: "Name", sortable: true },
  { id: "phone", label: "Phone", sortable: false },
  { id: "country", label: "Country", sortable: false },
  { id: "status", label: "Status", sortable: true },
  { id: "lastTouch", label: "Last activity", sortable: false },
] as const;

interface Props {
  campaignId: string;
  query: string;             // already-debounced search query
  statusFilter: LeadStatus | "all";
  onOpenLead: (leadId: string, campaignId?: string) => void;
}

export function LeadsListView({ campaignId, query, statusFilter, onOpenLead }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });

  const fields = campaignId === "overview"
    ? [
        { id: "name", label: "Name", sortable: true },
        { id: "campaign", label: "Campaign", sortable: false },
        { id: "phone", label: "Phone", sortable: false },
        { id: "country", label: "Country", sortable: false },
        { id: "status", label: "Status", sortable: true },
        { id: "lastTouch", label: "Last activity", sortable: false },
      ]
    : DEFAULT_FIELDS;

  // Reset to page 1 when filter/sort/pageSize change.
  const filterKey = `${query}|${statusFilter}|${sort.key}:${sort.dir}|${pageSize}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const q = useQuery<Paginated<CampaignLead> | OverviewLeadsResponse>({
    queryKey: [
      "campaigns",
      campaignId,
      "leads",
      { status: statusFilter, q: query, sort: `${sort.key}:${sort.dir}`, page, pageSize },
    ],
    queryFn: ({ signal }) => {
      if (campaignId === "overview") {
        return leadsApi.overview(
          {
            status: statusFilter,
            q: query || undefined,
            sort: `${sort.key}:${sort.dir}`,
            page,
            limit: pageSize,
          },
          { signal }
        );
      }
      return leadsApi.list(
        campaignId,
        {
          status: statusFilter,
          q: query || undefined,
          sort: `${sort.key}:${sort.dir}`,
          page,
          limit: pageSize,
        },
        { signal }
      );
    },
    placeholderData: keepPreviousData, // keep last page rendered while fetching next
  });

  const rows = q.data?.data ?? [];
  const firstPage = q.data as any;
  const filtered = firstPage?.filtered ?? firstPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(filtered / pageSize));
  const startIdx = (page - 1) * pageSize;

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  return (
    <>
      <div className="cmp-data-table-wrap">
        <table className="cmp-data-table">
          <thead>
            <tr>
              {fields.map((f) =>
                f.sortable ? (
                  <th
                    key={f.id}
                    className="cmp-th-sort"
                    aria-sort={
                      sort.key === f.id ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                    }
                    onClick={() => toggleSort(f.id as SortKey)}
                  >
                    <span className="cmp-th-sort-row">
                      {f.label}
                      <span
                        className="cmp-th-sort-chev"
                        style={{ opacity: sort.key === f.id ? 1 : 0.25 }}
                      >
                        {sort.key === f.id && sort.dir === "asc" ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                      </span>
                    </span>
                  </th>
                ) : (
                  <th key={f.id}>{f.label}</th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {q.isPending &&
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={`skel-${i}`} aria-busy="true">
                  {fields.map((f) => (
                    <td key={f.id}>
                      <div className="cmp-skeleton-line" />
                    </td>
                  ))}
                </tr>
              ))}

            {!q.isPending && q.isError && (
              <tr>
                <td colSpan={fields.length}>
                  <div className="cmp-empty">
                    <Search />
                    <div className="cmp-empty-title">Couldn&apos;t load leads</div>
                    <button
                      className="cmp-btn cmp-btn-outline cmp-btn-sm"
                      onClick={() => q.refetch()}
                    >
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {!q.isPending && !q.isError && rows.length === 0 && (
              <tr>
                <td colSpan={fields.length}>
                  <div className="cmp-empty">
                    <Search />
                    <div className="cmp-empty-title">No leads match these filters</div>
                  </div>
                </td>
              </tr>
            )}

            {rows.map((l) => (
              <LeadRow
                key={l.id}
                lead={l}
                showCampaignColumn={campaignId === "overview"}
                onClick={onOpenLead}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="cmp-pagination-bar">
        <div className="text-[13px] text-muted-foreground">
          Showing{" "}
          <span className="font-medium text-foreground cmp-tabular">
            {filtered === 0 ? 0 : numberFmt.format(startIdx + 1)}–
            {numberFmt.format(Math.min(startIdx + pageSize, filtered))}
          </span>{" "}
          of{" "}
          <span className="font-medium text-foreground cmp-tabular">
            {numberFmt.format(filtered)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="text-xs text-muted-foreground">Rows</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => setPageSize(parseInt(value, 10))}
            >
              <SelectTrigger className="h-7 w-20 px-2 text-xs" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Rows</SelectLabel>
                  {PAGE_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              className="cmp-btn cmp-btn-outline cmp-btn-sm cmp-pagination-icon-btn"
              disabled={page === 1}
              onClick={() => setPage(1)}
              aria-label="First page"
            >
              «
            </button>
            <button
              className="cmp-btn cmp-btn-outline cmp-btn-sm cmp-pagination-icon-btn"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[13px] cmp-tabular" style={{ padding: "0 10px" }}>
              Page <span className="font-medium">{page}</span> of{" "}
              {numberFmt.format(totalPages)}
            </span>
            <button
              className="cmp-btn cmp-btn-outline cmp-btn-sm cmp-pagination-icon-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
            <button
              className="cmp-btn cmp-btn-outline cmp-btn-sm cmp-pagination-icon-btn"
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
              aria-label="Last page"
            >
              »
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

interface RowProps {
  lead: CampaignLead & { campaign_name?: string | null; campaign_id?: string };
  showCampaignColumn?: boolean;
  onClick: (id: string, campaignId?: string) => void;
}

const LeadRow = memo(
  function LeadRow({ lead, showCampaignColumn, onClick }: RowProps) {
    return (
      <tr onClick={() => onClick(lead.id, lead.campaign_id)}>
        <td>
          <div className="font-medium">{lead.name}</div>
        </td>
        {showCampaignColumn && (
          <td className="text-[13px] text-muted-foreground">
            {lead.campaign_name || "No campaign"}
          </td>
        )}
        <td className="cmp-mono text-[13px]">{lead.phone}</td>
        <td className="text-[13px]">{lead.country || "Unknown"}</td>
        <td>
          <CampaignStatusPill status={lead.status} />
        </td>
        <td className="text-[13px] text-muted-foreground">
          {lead.last_touch_at ? new Date(lead.last_touch_at).toLocaleString() : "No activity"}
        </td>
      </tr>
    );
  },
  (prev, next) =>
    prev.lead.id === next.lead.id &&
    prev.lead.status === next.lead.status &&
    prev.lead.name === next.lead.name &&
    prev.lead.last_touch_at === next.lead.last_touch_at &&
    prev.showCampaignColumn === next.showCampaignColumn &&
    prev.onClick === next.onClick
);
