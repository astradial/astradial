"use client";

import { format } from "date-fns";
import { BadgeCheck, FileText, Key, MessageSquare, Phone, RefreshCw } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  const [selectedTemplate, setSelectedTemplate] = useState<Msg91Template | null>(null);

  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [logDate, setLogDate] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    msg91
      .getConfig()
      .then(setConfig)
      .catch(() => {});
  }, []);

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
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function loadNumbers() {
    setLoadingNumbers(true);
    try {
      const data = await msg91.getNumbers(orgId);
      setNumbers(data);
      if (data.length > 0 && !selectedNumber) {
        setSelectedNumber(
          String((data[0] as Record<string, unknown>).integrated_number || data[0].number || "")
        );
      }
    } catch {
      showToast("Failed to fetch numbers", "error");
    } finally {
      setLoadingNumbers(false);
    }
  }

  async function loadTemplates() {
    if (!selectedNumber) {
      showToast("Select a phone number first", "error");
      return;
    }
    setLoadingTemplates(true);
    try {
      setTemplates(await msg91.getTemplates(orgId, selectedNumber));
    } catch {
      showToast("Failed to fetch templates", "error");
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function loadLogs() {
    setLoadingLogs(true);
    try {
      const data = (await msg91.getLogs(orgId, logDate, logDate)) as Record<string, unknown>;
      setLogs(Array.isArray(data.data) ? data.data : []);
    } catch {
      showToast("Failed to fetch logs", "error");
    } finally {
      setLoadingLogs(false);
    }
  }

  function statusColor(status: string) {
    if (status === "read") return "bg-green-600 text-white";
    if (status === "delivered")
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    if (status === "sent")
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
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
            {config.configured ? (
              <BadgeCheck className="h-5 w-5 text-green-500" />
            ) : (
              <Key className="h-5 w-5 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">
                {config.configured ? "MSG91 Connected" : "MSG91 Not Configured"}
              </p>
              {config.configured && (
                <p className="text-xs text-muted-foreground font-mono">
                  Key: {config.authkey_masked}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              autoComplete="off"
              value={authkeyInput}
              onChange={(e) => setAuthkeyInput(e.target.value)}
              style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
              placeholder={config.configured ? "Enter new key to change" : "Enter MSG91 authkey"}
              className="h-8 text-xs w-60"
            />
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
            <TabsTrigger value="numbers" className="gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              Phone Numbers
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Message Logs
            </TabsTrigger>
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
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${loadingNumbers ? "animate-spin" : ""}`}
                  />
                  {loadingNumbers ? "Loading..." : "Fetch Numbers"}
                </Button>
              </CardHeader>
              <CardContent>
                {loadingNumbers ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="h-4 w-32 bg-muted/60 rounded animate-pulse" />
                        <div className="h-4 w-12 bg-muted/60 rounded animate-pulse" />
                      </div>
                    ))}
                  </div>
                ) : numbers.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    Click "Fetch Numbers" to load available WhatsApp numbers.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {numbers.map((n, i) => {
                      const num = String(
                        (n as Record<string, unknown>).integrated_number || n.number || "Unknown"
                      );
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-md border px-3 py-2"
                        >
                          <div className="flex items-center gap-3">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-mono">{num}</span>
                          </div>
                          <Badge variant="default" className="text-[10px]">
                            {String(n.quality_rating || n.status || "Active")}
                          </Badge>
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
              <Button
                size="sm"
                variant="outline"
                onClick={loadTemplates}
                disabled={loadingTemplates || !selectedNumber}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 mr-1.5 ${loadingTemplates ? "animate-spin" : ""}`}
                />
                {loadingTemplates ? "Loading..." : "Fetch Templates"}
              </Button>
            </div>
            <div className="border rounded-lg flex-1 min-h-0 overflow-y-auto mb-4">
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
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        {selectedNumber
                          ? "Click 'Fetch Templates' to load"
                          : "Select a number first (Phone Numbers tab)"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    templates.map((t, i) => {
                      const langs =
                        ((t as Record<string, unknown>).languages as Record<string, unknown>[]) ||
                        [];
                      const fl = langs[0] || {};
                      const vars = (fl.variables as string[]) || [];
                      return (
                        <TableRow
                          key={i}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedTemplate(t)}
                        >
                          <TableCell className="font-medium text-sm">
                            {String(t.name || "—")}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={String(fl.status) === "APPROVED" ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {String(fl.status || "—")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{String(fl.language || "—")}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {vars.length > 0 ? vars.join(", ") : "No variables"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <Sheet
              open={!!selectedTemplate}
              onOpenChange={(open) => !open && setSelectedTemplate(null)}
            >
              <SheetContent className="overflow-y-auto w-[400px] sm:w-[540px] max-w-full">
                <SheetHeader className="pb-4">
                  <SheetTitle className="text-xl">Template Details</SheetTitle>
                  <SheetDescription>WhatsApp template structure and properties.</SheetDescription>
                </SheetHeader>
                {selectedTemplate &&
                  (() => {
                    const langs =
                      ((selectedTemplate as Record<string, any>).languages as Record<
                        string,
                        any
                      >[]) || [];
                    const fl = langs[0] || {};
                    const vars = (fl.variables as string[]) || [];
                    const components = (fl.components as any[]) || [];

                    const headerComp = components.find((c) => c.type === "HEADER");
                    const bodyComp = components.find((c) => c.type === "BODY");
                    const footerComp = components.find((c) => c.type === "FOOTER");
                    const buttonsComp = components.find((c) => c.type === "BUTTONS");

                    return (
                      <div className="space-y-6">
                        <div className="space-y-2 border-t pt-4">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Properties
                          </h4>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                            <div>
                              <span className="text-muted-foreground text-xs block">
                                Template Name
                              </span>
                              <span className="font-medium">
                                {String(selectedTemplate.name || "—")}
                              </span>
                            </div>
                            {!!selectedTemplate.id && (
                              <div>
                                <span className="text-muted-foreground text-xs block">
                                  Template ID
                                </span>
                                <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                                  {String(selectedTemplate.id)}
                                </span>
                              </div>
                            )}
                            {!!selectedTemplate.category && (
                              <div className="mt-1">
                                <span className="text-muted-foreground text-xs block">
                                  Category
                                </span>
                                <Badge variant="outline" className="capitalize text-[10px]">
                                  {String(selectedTemplate.category)}
                                </Badge>
                              </div>
                            )}
                            <div>
                              <span className="text-muted-foreground text-xs block">Language</span>
                              <span className="capitalize">{String(fl.language || "—")}</span>
                            </div>
                            <div className="mt-1">
                              <span className="text-muted-foreground text-xs block">Status</span>
                              <Badge
                                variant={String(fl.status) === "APPROVED" ? "default" : "secondary"}
                                className="text-[10px]"
                              >
                                {String(fl.status || "—")}
                              </Badge>
                            </div>
                          </div>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            WhatsApp Preview
                          </h4>
                          <div
                            className="rounded-xl border p-4 min-h-[220px] flex flex-col justify-end relative shadow-inner overflow-hidden"
                            style={{
                              backgroundColor: "#efeae2",
                              backgroundImage:
                                "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')",
                              backgroundSize: "cover",
                              backgroundBlendMode: "overlay",
                            }}
                          >
                            {/* Chat speech bubble */}
                            <div className="bg-white dark:bg-zinc-800 text-black dark:text-white rounded-lg p-3 shadow-sm max-w-[85%] self-start relative text-sm space-y-1.5">
                              {headerComp && (
                                <div className="font-bold text-xs border-b border-zinc-100 dark:border-zinc-700 pb-1 text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                                  {headerComp.format === "TEXT" ? (
                                    <span>{headerComp.text}</span>
                                  ) : (
                                    <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                                      <FileText className="h-3 w-3" /> {headerComp.format} Header
                                    </span>
                                  )}
                                </div>
                              )}

                              {bodyComp && (
                                <div className="whitespace-pre-wrap leading-relaxed break-words">
                                  {bodyComp.text}
                                </div>
                              )}

                              {footerComp && (
                                <div className="text-[10px] text-zinc-400 dark:text-zinc-500 pt-0.5">
                                  {footerComp.text}
                                </div>
                              )}
                            </div>

                            {/* Render Buttons below bubble if present */}
                            {buttonsComp && Array.isArray(buttonsComp.buttons) && (
                              <div className="mt-2 space-y-1 max-w-[85%] self-start w-full">
                                {buttonsComp.buttons.map((btn: any, idx: number) => {
                                  let label = btn.text || "Button";
                                  if (btn.type === "PHONE_NUMBER") {
                                    label = `📞 ${label} (${btn.phone_number || ""})`;
                                  } else if (btn.type === "URL") {
                                    label = `🔗 ${label}`;
                                  }
                                  return (
                                    <div
                                      key={idx}
                                      className="bg-white dark:bg-zinc-800 text-[#00a884] dark:text-emerald-400 text-xs font-semibold py-2 px-3 rounded-lg text-center shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 hover:bg-zinc-50 dark:hover:bg-zinc-750 transition-colors cursor-pointer"
                                    >
                                      {label}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {vars.length > 0 && (
                          <>
                            <Separator />
                            <div className="space-y-2">
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Template Variables
                              </h4>
                              <div className="flex flex-wrap gap-1.5">
                                {vars.map((v) => (
                                  <code
                                    key={v}
                                    className="bg-muted text-xs font-mono px-2 py-0.5 rounded text-muted-foreground"
                                  >
                                    {"{{"}
                                    {v}
                                    {"}}"}
                                  </code>
                                ))}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-2">
                                These variables are resolved using lead custom fields at send time.
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
              </SheetContent>
            </Sheet>
          </TabsContent>

          {/* Message Logs */}
          <TabsContent value="logs" className="flex flex-col flex-1 min-h-0 mt-4">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <p className="text-sm text-muted-foreground">Delivery reports (max 3-day range)</p>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className="h-8 text-xs w-40"
                />
                <Button size="sm" variant="outline" onClick={loadLogs} disabled={loadingLogs}>
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${loadingLogs ? "animate-spin" : ""}`}
                  />
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
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        Select a date and click "Fetch Logs"
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((l, i) => {
                      const st = String(l.status || "—");
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-sm">
                            {String(l.customerNumber || "—")}
                          </TableCell>
                          <TableCell className="text-sm">{String(l.templateName || "—")}</TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor(st)}`}
                            >
                              {st}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {l.requestedAt
                              ? format(new Date(String(l.requestedAt)), "h:mm a")
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
