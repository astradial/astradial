"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { BadgeCheck, Key, Phone, FileText, MessageSquare, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showToast } from "@/components/ui/Toast";
import { msg91, type Msg91Config, type Msg91Number, type Msg91Template } from "@/lib/msg91/client";

export default function WhatsAppPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [config, setConfig] = useState<Msg91Config>({ configured: false, authkey_masked: "" });
  const [authkeyInput, setAuthkeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  const [numbers, setNumbers] = useState<Msg91Number[]>([]);
  const [templates, setTemplates] = useState<Msg91Template[]>([]);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [selectedNumber, setSelectedNumber] = useState("");

  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [logDate, setLogDate] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => { msg91.getConfig().then(setConfig).catch(() => {}); }, []);

  useEffect(() => {
    if (config.configured && numbers.length === 0) loadNumbers();
  }, [config.configured]);

  async function handleSaveKey() {
    if (!authkeyInput) return;
    setSaving(true);
    try {
      const result = await msg91.setConfig(authkeyInput);
      setConfig(result);
      setAuthkeyInput("");
      showToast("MSG91 API key saved", "success");
    } catch (e) { showToast(e instanceof Error ? e.message : "Failed", "error"); }
    finally { setSaving(false); }
  }

  async function loadNumbers() {
    setLoadingNumbers(true);
    try {
      const data = await msg91.getNumbers(orgId);
      setNumbers(data);
      if (data.length > 0 && !selectedNumber) {
        setSelectedNumber(String((data[0] as Record<string, unknown>).integrated_number || data[0].number || ""));
      }
    } catch { showToast("Failed to fetch numbers", "error"); }
    finally { setLoadingNumbers(false); }
  }

  async function loadTemplates() {
    if (!selectedNumber) { showToast("Select a phone number first", "error"); return; }
    setLoadingTemplates(true);
    try { setTemplates(await msg91.getTemplates(orgId, selectedNumber)); }
    catch { showToast("Failed to fetch templates", "error"); }
    finally { setLoadingTemplates(false); }
  }

  async function loadLogs() {
    setLoadingLogs(true);
    try {
      const data = await msg91.getLogs(orgId, logDate, logDate) as Record<string, unknown>;
      setLogs(Array.isArray(data.data) ? data.data : []);
    } catch { showToast("Failed to fetch logs", "error"); }
    finally { setLoadingLogs(false); }
  }

  function statusColor(status: string) {
    if (status === "read") return "bg-green-600 text-white";
    if (status === "delivered") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    if (status === "sent") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    if (status === "failed") return "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  }

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header */}
      <div className="p-6 pb-3 shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">MSG91 WhatsApp integration</p>

        {/* API Key Config */}
        <div className="flex items-center justify-between mt-4 rounded-lg border px-4 py-3">
          <div className="flex items-center gap-3">
            {config.configured ? <BadgeCheck className="h-5 w-5 text-green-500" /> : <Key className="h-5 w-5 text-muted-foreground" />}
            <div>
              <p className="text-sm font-medium">{config.configured ? "MSG91 Connected" : "MSG91 Not Configured"}</p>
              {config.configured && <p className="text-xs text-muted-foreground font-mono">Key: {config.authkey_masked}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input type="text" autoComplete="off" value={authkeyInput} onChange={(e) => setAuthkeyInput(e.target.value)}
              style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
              placeholder={config.configured ? "Enter new key to change" : "Enter MSG91 authkey"} className="h-8 text-xs w-60" />
            <Button size="sm" onClick={handleSaveKey} disabled={!authkeyInput || saving}>
              {saving ? "Saving..." : config.configured ? "Update" : "Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs — fill remaining space */}
      {config.configured && (
        <Tabs defaultValue="numbers" className="flex flex-col flex-1 min-h-0 px-6 pb-4">
          <TabsList className="w-auto shrink-0 self-start">
            <TabsTrigger value="numbers" className="gap-1.5"><Phone className="h-3.5 w-3.5" />Phone Numbers</TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5"><FileText className="h-3.5 w-3.5" />Templates</TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5"><MessageSquare className="h-3.5 w-3.5" />Message Logs</TabsTrigger>
          </TabsList>

          {/* Phone Numbers */}
          <TabsContent value="numbers" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-lg">Phone Numbers</CardTitle>
                  <CardDescription>WhatsApp sender numbers from MSG91</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={loadNumbers} disabled={loadingNumbers}>
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingNumbers ? "animate-spin" : ""}`} />
                  {loadingNumbers ? "Loading..." : "Fetch Numbers"}
                </Button>
              </CardHeader>
              <CardContent>
                {loadingNumbers ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="h-4 w-32 bg-muted/60 rounded animate-pulse" />
                        <div className="h-4 w-12 bg-muted/60 rounded animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : numbers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">Click "Fetch Numbers" to load available WhatsApp numbers.</p>
                ) : (
                  <div className="space-y-2">
                    {numbers.map((n, i) => {
                      const num = String((n as Record<string, unknown>).integrated_number || n.number || "Unknown");
                      return (
                        <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2">
                          <div className="flex items-center gap-3">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-mono">{num}</span>
                          </div>
                          <Badge variant="default" className="text-[10px]">{String(n.quality_rating || n.status || "Active")}</Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Templates */}
          <TabsContent value="templates" className="flex flex-col flex-1 min-h-0 mt-4">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <p className="text-sm text-muted-foreground">Templates for {selectedNumber || "—"}</p>
              <Button size="sm" variant="outline" onClick={loadTemplates} disabled={loadingTemplates || !selectedNumber}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingTemplates ? "animate-spin" : ""}`} />
                {loadingTemplates ? "Loading..." : "Fetch Templates"}
              </Button>
            </div>
            <div className="border rounded-lg flex-1 min-h-0 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10 shadow-[0_1px_0_0] shadow-border">
                  <TableRow>
                    <TableHead className="w-[30%]">Name</TableHead>
                    <TableHead className="w-[15%]">Status</TableHead>
                    <TableHead className="w-[15%]">Language</TableHead>
                    <TableHead className="w-[40%]">Components</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingTemplates ? (
                    <TableSkeleton cols={4} />
                  ) : templates.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      {selectedNumber ? "Click 'Fetch Templates' to load" : "Select a number first (Phone Numbers tab)"}
                    </TableCell></TableRow>
                  ) : templates.map((t, i) => {
                    const langs = (t as Record<string, unknown>).languages as Record<string, unknown>[] || [];
                    const fl = langs[0] || {};
                    const vars = (fl.variables as string[]) || [];
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-medium text-sm">{String(t.name || "—")}</TableCell>
                        <TableCell><Badge variant={String(fl.status) === "APPROVED" ? "default" : "secondary"} className="text-[10px]">{String(fl.status || "—")}</Badge></TableCell>
                        <TableCell className="text-xs">{String(fl.language || "—")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{vars.length > 0 ? vars.join(", ") : "No variables"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Message Logs */}
          <TabsContent value="logs" className="flex flex-col flex-1 min-h-0 mt-4">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <p className="text-sm text-muted-foreground">Delivery reports (max 3-day range)</p>
              <div className="flex items-center gap-2">
                <Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} className="h-8 text-xs w-40" />
                <Button size="sm" variant="outline" onClick={loadLogs} disabled={loadingLogs}>
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingLogs ? "animate-spin" : ""}`} />
                  {loadingLogs ? "Loading..." : "Fetch Logs"}
                </Button>
              </div>
            </div>
            <div className="border rounded-lg flex-1 min-h-0 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10 shadow-[0_1px_0_0] shadow-border">
                  <TableRow>
                    <TableHead className="w-[30%]">Customer Number</TableHead>
                    <TableHead className="w-[25%]">Template Name</TableHead>
                    <TableHead className="w-[20%]">Status</TableHead>
                    <TableHead className="w-[25%] text-right">Requested At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingLogs ? (
                    <TableSkeleton cols={4} />
                  ) : logs.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Select a date and click "Fetch Logs"</TableCell></TableRow>
                  ) : logs.map((l, i) => {
                    const st = String(l.status || "—");
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-sm">{String(l.customerNumber || "—")}</TableCell>
                        <TableCell className="text-sm">{String(l.templateName || "—")}</TableCell>
                        <TableCell><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor(st)}`}>{st}</span></TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{l.requestedAt ? format(new Date(String(l.requestedAt)), "h:mm a") : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
