"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, TrendingUp, TrendingDown, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { users as pbxUsers, calls as pbxCalls, type CallHistoryItem } from "@/lib/pbx/client";
import { OnboardingBanner } from "@/components/onboarding/OnboardingBanner";

const chartConfig = {
  inbound: { label: "Inbound", color: "hsl(221, 83%, 53%)" },
  outbound: { label: "Outbound", color: "hsl(221, 83%, 40%)" },
} satisfies ChartConfig;

export default function OverviewPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [activeCalls, setActiveCalls] = useState(0);
  const [recentLogs, setRecentLogs] = useState<CallHistoryItem[]>([]);
  const [openTickets, setOpenTickets] = useState<number | null>(null);
  const [chartData, setChartData] = useState<{ date: string; inbound: number; outbound: number }[]>([]);
  const [totals, setTotals] = useState({ total_calls: 0, inbound: 0, outbound: 0, answered: 0, missed: 0, avg_duration: 0 });

  useEffect(() => {
    pbxUsers.list().then((u) => setTotalUsers(u.length)).catch(() => {});
    pbxCalls.count().then((c) => setActiveCalls(c.count)).catch(() => {});
    pbxCalls.stats().then((s) => {
      setChartData(s.weekly.map((w) => ({
        date: format(new Date(w.date + "T00:00:00"), "MMM d"),
        inbound: w.inbound,
        outbound: w.outbound,
      })));
      setTotals(s.totals);
    }).catch(() => {});
    pbxCalls.history({ limit: 10 }).then((r) => setRecentLogs(r.items)).catch(() => {});
  }, [orgId]);

  useEffect(() => { setOpenTickets(0); }, [orgId]);

  const totalCalls = totals.total_calls || chartData.reduce((sum, d) => sum + d.inbound + d.outbound, 0);
  const avgDuration = totals.avg_duration || 0;

  function formatDuration(secs: number) {
    if (!secs) return "0s";
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <OnboardingBanner />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Organization overview</p>
        </div>
        <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
          <Activity className="h-3 w-3 text-green-500" />
          Active calls: {activeCalls}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="@container/card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
            <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0.5 font-normal">
              <TrendingUp className="h-3 w-3" />
              +{totalCalls}
            </Badge>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-4xl font-bold tabular-nums">{totalCalls || "0"}</div>
            <div className="mt-3 flex items-center gap-1 text-sm font-medium">
              Trending up this week
              <TrendingUp className="h-4 w-4" />
            </div>
            <p className="text-xs text-muted-foreground">Total incoming and outgoing calls</p>
          </CardContent>
        </Card>
        <Card className="@container/card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0.5 font-normal">
              <Users className="h-3 w-3" />
              {totalUsers ?? 0}
            </Badge>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-4xl font-bold tabular-nums">{totalUsers ?? "0"}</div>
            <div className="mt-3 flex items-center gap-1 text-sm font-medium">
              {(totalUsers ?? 0)} registered extensions
              <TrendingUp className="h-4 w-4" />
            </div>
            <p className="text-xs text-muted-foreground">SIP endpoints configured</p>
          </CardContent>
        </Card>
        <Card className="@container/card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Open Tickets</CardTitle>
            <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0.5 font-normal">
              {(openTickets ?? 0) > 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
              {openTickets ?? 0}
            </Badge>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-4xl font-bold tabular-nums">{openTickets ?? "0"}</div>
            <div className="mt-3 flex items-center gap-1 text-sm font-medium">
              {(openTickets ?? 0) > 0 ? "Needs attention" : "All clear"}
              {(openTickets ?? 0) > 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
            </div>
            <p className="text-xs text-muted-foreground">Tickets awaiting resolution</p>
          </CardContent>
        </Card>
        <Card className="@container/card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0.5 font-normal">
              <TrendingUp className="h-3 w-3" />
              per call
            </Badge>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="text-4xl font-bold tabular-nums">{avgDuration > 0 ? formatDuration(avgDuration) : "0s"}</div>
            <div className="mt-3 flex items-center gap-1 text-sm font-medium">
              Steady call performance
              <TrendingUp className="h-4 w-4" />
            </div>
            <p className="text-xs text-muted-foreground">Across all answered calls</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Call Volume</CardTitle>
          <CardDescription>Inbound and outbound calls this week</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[250px] w-full">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} className="text-xs" />
              <ChartTooltip content={<ChartTooltipContent />} />
              <defs>
                <linearGradient id="fillInbound" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="fillOutbound" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(221, 83%, 40%)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="hsl(221, 83%, 40%)" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <Area dataKey="inbound" type="monotone" fill="url(#fillInbound)" stroke="hsl(221, 83%, 53%)" strokeWidth={2} />
              <Area dataKey="outbound" type="monotone" fill="url(#fillOutbound)" stroke="hsl(221, 83%, 40%)" strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Calls</CardTitle>
          <CardDescription>Latest call activity</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No recent calls</TableCell>
                </TableRow>
              ) : (
                recentLogs.slice(0, 10).map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm">{log.from_number || "---"}</TableCell>
                    <TableCell className="text-sm">{log.to_number || "---"}</TableCell>
                    <TableCell className="text-sm">{formatDuration(log.duration)}</TableCell>
                    <TableCell>
                      <Badge variant={log.status === "ANSWERED" ? "default" : "secondary"} className="text-xs uppercase">
                        {log.status || "---"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {log.started_at ? format(new Date(log.started_at), "MMM d, h:mm a") : "---"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
