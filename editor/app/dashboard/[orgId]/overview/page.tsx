"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconLayoutColumns,
  IconPlus,
  IconTrendingUp,
} from "@tabler/icons-react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { format } from "date-fns";
import { Activity, TrendingDown, TrendingUp, Users } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { toast } from "sonner";

import { OnboardingBanner } from "@/components/onboarding/OnboardingBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { type CallHistoryItem, calls as pbxCalls, users as pbxUsers } from "@/lib/pbx/client";
import { subscribeToOpenTicketCount } from "@/lib/tickets/api";
import { cn } from "@/lib/utils";

const chartConfig = {
  inbound: { label: "Inbound", color: "hsl(221, 83%, 53%)" },
  outbound: { label: "Outbound", color: "hsl(221, 83%, 40%)" },
} satisfies ChartConfig;

function formatDuration(secs: number) {
  if (!secs) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function TableCellViewer({ item }: { item: CallHistoryItem }) {
  const isMobile = useIsMobile();

  return (
    <Drawer direction={isMobile ? "bottom" : "right"}>
      <DrawerTrigger asChild>
        <Button variant="link" className="w-fit px-0 text-left text-foreground">
          {item.from_number || "---"}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle>
            {item.from_number || "---"} → {item.to_number || "---"}
          </DrawerTitle>
          <DrawerDescription>Call details and activity over the last 6 months</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
          {!isMobile && (
            <>
              <div className="grid gap-2">
                <div className="flex gap-2 leading-none font-medium">
                  Steady call performance <IconTrendingUp className="size-4" />
                </div>
                <div className="text-muted-foreground">
                  Viewing a summary of this call. Fields below are editable for visual parity with
                  the product spec and are not persisted in this view.
                </div>
              </div>
              <Separator />
            </>
          )}
          <form className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Label htmlFor="from">From</Label>
              <Input id="from" defaultValue={item.from_number || ""} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <Label htmlFor="to">To</Label>
                <Input id="to" defaultValue={item.to_number || ""} />
              </div>
              <div className="flex flex-col gap-3">
                <Label htmlFor="direction">Direction</Label>
                <Select defaultValue={item.direction}>
                  <SelectTrigger id="direction" className="w-full">
                    <SelectValue placeholder="Select direction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inbound">Inbound</SelectItem>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <Label htmlFor="duration">Duration</Label>
                <Input id="duration" defaultValue={formatDuration(item.duration)} />
              </div>
              <div className="flex flex-col gap-3">
                <Label htmlFor="status">Status</Label>
                <Select defaultValue={item.disposition}>
                  <SelectTrigger id="status" className="w-full">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ANSWERED">Answered</SelectItem>
                    <SelectItem value="NO ANSWER">No Answer</SelectItem>
                    <SelectItem value="BUSY">Busy</SelectItem>
                    <SelectItem value="FAILED">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label htmlFor="started_at">Started At</Label>
              <Input
                id="started_at"
                defaultValue={
                  item.started_at ? format(new Date(item.started_at), "MMM d, h:mm a") : ""
                }
              />
            </div>
          </form>
        </div>
        <DrawerFooter>
          <Button>Submit</Button>
          <DrawerClose asChild>
            <Button variant="outline">Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

const columns: ColumnDef<CallHistoryItem>[] = [
  {
    id: "select",
    header: ({ table }: any) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value: boolean) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }: any) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value: boolean) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "to_number",
    header: "To",
    cell: ({ row }: any) => (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        {row.original.to_number || "---"}
      </Badge>
    ),
  },
  {
    accessorKey: "from_number",
    header: "From",
    // cell: ({ row }: any) => <TableCellViewer item={row.original} />,
    enableHiding: false,
  },
  {
    accessorKey: "duration",
    header: () => <div className="min-w-20 text-left pr-6">Duration</div>,
    cell: ({ row }: any) => (
      <div className="min-w-20 text-left text-sm pr-6">{formatDuration(row.original.duration)}</div>
    ),
  },
  {
    accessorKey: "disposition",
    header: "Status",
    cell: ({ row }: any) => {
      const isAnswered = row.original.disposition === "ANSWERED";
      return (
        <Badge variant={isAnswered ? "default" : "secondary"} className="text-xs uppercase">
          {row.original.disposition || "---"}
        </Badge>
      );
    },
  },
  {
    accessorKey: "started_at",
    header: () => <div className="text-right">Time</div>,
    cell: ({ row }: any) => (
      <div className="text-right text-sm text-muted-foreground">
        {row.original.started_at
          ? format(new Date(row.original.started_at), "MMM d, h:mm a")
          : "---"}
      </div>
    ),
  },
];

function RecentCallsTable({ data: initialData }: { data: CallHistoryItem[] }) {
  const [data, setData] = React.useState(() => initialData);
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 });

  React.useEffect(() => {
    setData(initialData);
  }, [initialData]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, rowSelection, columnFilters, pagination },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  return (
    <Tabs
      defaultValue="outline"
      className="w-full flex-col justify-start gap-6 rounded-xl text-card-foreground mt-6"
    >
      <div className="flex items-center justify-between px-4 lg:px-6">
        <TabsList className="data-[slot=badge]:size-5 data-[slot=badge]:rounded-full data-[slot=badge]:bg-muted-foreground/30 data-[slot=badge]:px-1 @4xl/main:flex">
          <TabsTrigger value="outline">Recent Calls</TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <IconLayoutColumns className="size-4" />
                <span className="hidden lg:inline">Customize Columns</span>
                <span className="lg:hidden">Columns</span>
                <IconChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {table
                .getAllColumns()
                .filter(
                  (column: any) => typeof column.accessorFn !== "undefined" && column.getCanHide()
                )
                .map((column: any) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value: boolean) => column.toggleVisibility(!!value)}
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm">
            <IconPlus className="size-4" />
            <span className="hidden lg:inline">Add Section</span>
          </Button>
        </div>
      </div>
      <TabsContent value="outline" className="relative flex flex-col gap-4 overflow-auto mt-4">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
              {table.getHeaderGroups().map((headerGroup: any) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header: any) => (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row: any) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                    {row.getVisibleCells().map((cell: any) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Rows per page
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger className="w-20" id="rows-per-page">
                  <SelectValue placeholder={table.getState().pagination.pageSize} />
                </SelectTrigger>
                <SelectContent side="top">
                  {[10, 20, 30, 40, 50].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to first page</span>
                <IconChevronsLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>
                <IconChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>
                <IconChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to last page</span>
                <IconChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="past-performance" className="flex flex-col px-4 lg:px-6">
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground">
          Past Performance Area
        </div>
      </TabsContent>
      <TabsContent value="key-personnel" className="flex flex-col px-4 lg:px-6">
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground">
          Key Personnel Area
        </div>
      </TabsContent>
      <TabsContent value="focus-documents" className="flex flex-col px-4 lg:px-6">
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground">
          Focus Documents Area
        </div>
      </TabsContent>
    </Tabs>
  );
}

// ------ Main Page ------

export default function OverviewPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [activeCalls, setActiveCalls] = useState(0);
  const [recentLogs, setRecentLogs] = useState<CallHistoryItem[]>([]);
  const [openTickets, setOpenTickets] = useState<number | null>(null);
  const [chartData, setChartData] = useState<{ date: string; inbound: number; outbound: number }[]>(
    []
  );
  const [totals, setTotals] = useState({
    total_calls: 0,
    inbound: 0,
    outbound: 0,
    answered: 0,
    missed: 0,
    avg_duration: 0,
  });
  const [timeRange, setTimeRange] = useState("90d");
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) {
      setTimeRange("7d");
    }
  }, [isMobile]);

  // Fetch stats from PBX API
  useEffect(() => {
    pbxUsers
      .list()
      .then((u) => setTotalUsers(u.length))
      .catch(() => {});
    pbxCalls
      .count()
      .then((c) => setActiveCalls(c.count))
      .catch(() => {});

    pbxCalls
      .stats()
      .then((s) => {
        if (s?.totals) setTotals(s.totals);
        if (Array.isArray(s?.weekly) && s.weekly.length > 0) {
          setChartData(
            s.weekly.map((w) => ({
              date: w.date + "T00:00:00",
              inbound: w.inbound,
              outbound: w.outbound,
            }))
          );
        }
      })
      .catch((e) => {
        console.error("[overview] /calls/stats failed:", e);
      });

    // Recent calls for the table (last 10)
    pbxCalls
      .history({ limit: 10 })
      .then((r) => setRecentLogs(r.items))
      .catch((e) => {
        console.error("[overview] /calls history (table) failed:", e);
      });

    // Wider history to back the chart when /calls/stats is empty/unavailable.
    // Aggregates calls per day + direction so the chart always matches the
    // data we know is reachable via the history endpoint.
    pbxCalls
      .history({ limit: 500 })
      .then((r) => {
        const buckets = new Map<string, { inbound: number; outbound: number }>();
        for (const item of r.items) {
          if (!item.started_at) continue;
          const d = new Date(item.started_at);
          if (Number.isNaN(d.getTime())) continue;
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const bucket = buckets.get(key) ?? { inbound: 0, outbound: 0 };
          if (item.direction === "outbound") bucket.outbound += 1;
          else if (item.direction === "inbound") bucket.inbound += 1;
          else continue;
          buckets.set(key, bucket);
        }
        const aggregated = Array.from(buckets.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({
            date: date + "T00:00:00",
            inbound: v.inbound,
            outbound: v.outbound,
          }));
        setChartData((prev) => (prev.length > 0 ? prev : aggregated));
      })
      .catch((e) => {
        console.error("[overview] /calls history (chart) failed:", e);
      });
  }, [orgId]);

  // Live open-ticket count from MariaDB (Phase B+). Refetches via
  // SSE on every ticket write so the "Open Tickets" card stays in
  // sync with the sidebar badge and the tickets page.
  useEffect(() => {
    if (!orgId) return;
    return subscribeToOpenTicketCount(orgId, setOpenTickets);
  }, [orgId]);

  // Compute stats
  const totalCalls =
    totals.total_calls || chartData.reduce((sum, d) => sum + d.inbound + d.outbound, 0);
  const avgDuration = totals.avg_duration || 0;

  // Build a continuous day range for the selected time window so the X-axis
  // always spans the full period (otherwise 7d/30d/90d look identical when
  // all activity is concentrated in a few recent days).
  const filteredChartData = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const byDate = new Map<string, { inbound: number; outbound: number }>();
    for (const d of chartData) {
      const dt = new Date(d.date);
      if (Number.isNaN(dt.getTime())) continue;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      byDate.set(key, { inbound: d.inbound, outbound: d.outbound });
    }

    const out: { date: string; inbound: number; outbound: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const v = byDate.get(key) ?? { inbound: 0, outbound: 0 };
      out.push({ date: key + "T00:00:00", inbound: v.inbound, outbound: v.outbound });
    }
    return out;
  }, [chartData, timeRange]);

  return (
    <div className="p-3 md:p-6 space-y-6">
      <OnboardingBanner />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Organization overview</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="@container/card relative">
          <CardHeader>
            <CardDescription>Total Calls</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {totalCalls || "0"}
            </CardTitle>
            <div className="absolute right-6 top-6">
              <Badge variant="outline">
                <TrendingUp className="mr-1 h-3 w-3" />+{totalCalls}
              </Badge>
            </div>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Trending up this week <TrendingUp className="size-4" />
            </div>
            <div className="text-muted-foreground">Total incoming and outgoing calls</div>
          </CardFooter>
        </Card>

        <Card className="@container/card relative" data-slot="card">
          <CardHeader>
            <CardDescription>Active Users</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {totalUsers ?? "0"}
            </CardTitle>
            <div className="absolute right-6 top-6">
              <Badge variant="outline">
                <Users className="mr-1 h-3 w-3" />
                {totalUsers ?? 0}
              </Badge>
            </div>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {totalUsers ?? 0} registered extensions <TrendingUp className="size-4" />
            </div>
            <div className="text-muted-foreground">SIP endpoints configured</div>
          </CardFooter>
        </Card>

        <Card className="@container/card relative" data-slot="card">
          <CardHeader>
            <CardDescription>Open Tickets</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {openTickets ?? "0"}
            </CardTitle>
            <div className="absolute right-6 top-6">
              <Badge variant="outline">
                {(openTickets ?? 0) > 0 ? (
                  <TrendingDown className="mr-1 h-3 w-3" />
                ) : (
                  <TrendingUp className="mr-1 h-3 w-3" />
                )}
                {openTickets ?? 0}
              </Badge>
            </div>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {(openTickets ?? 0) > 0 ? "Needs attention" : "All clear"}
              {(openTickets ?? 0) > 0 ? (
                <TrendingDown className="size-4" />
              ) : (
                <TrendingUp className="size-4" />
              )}
            </div>
            <div className="text-muted-foreground">Tickets awaiting resolution</div>
          </CardFooter>
        </Card>

        <Card className="@container/card relative" data-slot="card">
          <CardHeader>
            <CardDescription>Avg Duration</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {avgDuration > 0 ? formatDuration(avgDuration) : "0s"}
            </CardTitle>
            <div className="absolute right-6 top-6">
              <Badge variant="outline">
                <TrendingUp className="mr-1 h-3 w-3" />
                per call
              </Badge>
            </div>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Steady call performance <TrendingUp className="size-4" />
            </div>
            <div className="text-muted-foreground">Across all answered calls</div>
          </CardFooter>
        </Card>
      </div>

      <Card className="@container/card">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-6">
          <div className="flex flex-col space-y-1.5">
            <CardTitle>Call Volume</CardTitle>
            <CardDescription>
              <span className="hidden @[540px]/card:block">Inbound and outbound calls</span>
              <span className="@[540px]/card:hidden">Call Volume</span>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={timeRange}
              onValueChange={(v) => v && setTimeRange(v)}
              variant="outline"
              className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
            >
              <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
              <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
              <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
            </ToggleGroup>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger
                className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden size-sm"
                aria-label="Select a value"
              >
                <SelectValue placeholder="Last 3 months" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="90d" className="rounded-lg">
                  Last 3 months
                </SelectItem>
                <SelectItem value="30d" className="rounded-lg">
                  Last 30 days
                </SelectItem>
                <SelectItem value="7d" className="rounded-lg">
                  Last 7 days
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
            <AreaChart data={filteredChartData}>
              <defs>
                <linearGradient id="fillInbound" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillOutbound" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(221, 83%, 40%)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="hsl(221, 83%, 40%)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                className="text-xs"
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                }}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      return new Date(value).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      });
                    }}
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="outbound"
                type="monotone"
                fill="url(#fillOutbound)"
                stroke="hsl(221, 83%, 40%)"
                stackId="a"
              />
              <Area
                dataKey="inbound"
                type="monotone"
                fill="url(#fillInbound)"
                stroke="hsl(221, 83%, 53%)"
                stackId="a"
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <RecentCallsTable data={recentLogs} />
    </div>
  );
}
