"use client";

import { format } from "date-fns";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Clock,
  MoreHorizontal,
  Phone,
  Plus,
  ShoppingCart,
  X,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { showToast } from "@/components/ui/Toast";
import { didPool, type MyDidsResponse, type PoolDid } from "@/lib/did-pool/client";
import { dids, type Ivr, ivrs, type PbxQueue, type PbxUser, queues, users } from "@/lib/pbx/client";

/**
 * Searchable combobox for picking a destination from a long list.
 *
 * Replaces a plain `<Select>` when the option list could be 20+ entries —
 * shows the top entries by default, filters as the operator types. cmdk
 * (the upstream of our Command primitive) does the substring matching;
 * we just provide the searchable label.
 *
 * Defaults to limiting the visible options to 5 (configurable via
 * `maxVisibleByDefault`) before any typing happens — anything beyond
 * that is scrollable. Once the user types, cmdk takes over and filters
 * down to matching options without the cap.
 */
function SearchableCombobox({
  value,
  onChange,
  placeholder,
  emptyMessage,
  options,
  maxVisibleByDefault = 5,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  emptyMessage: string;
  options: { value: string; label: string; searchableText: string }[];
  maxVisibleByDefault?: number;
}) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  // The currently-selected option's display label (for the trigger button).
  // If `value` is set but doesn't match any option (stale selection after
  // upstream data changes — e.g., an extension that was deleted), show the
  // raw value as a fallback so the operator can still see what's currently
  // configured.
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value ?? "";

  // Build the visible-by-default list:
  // 1. If there's a current selection, ALWAYS include it at the top — even
  //    if it would otherwise be truncated. Otherwise the operator sees the
  //    list, can't find the current value, and assumes routing is broken.
  // 2. Fill remaining slots with the first N options, skipping duplicates.
  // 3. Once the user starts typing, cmdk's filter takes over and the cap
  //    doesn't apply.
  const visibleOptions = useMemo(() => {
    if (searchValue.trim() !== "") return options;
    const out: typeof options = [];
    const seen = new Set<string>();
    const selected = options.find((o) => o.value === value);
    if (selected) {
      out.push(selected);
      seen.add(selected.value);
    }
    for (const opt of options) {
      if (out.length >= maxVisibleByDefault) break;
      if (seen.has(opt.value)) continue;
      out.push(opt);
      seen.add(opt.value);
    }
    return out;
  }, [options, value, searchValue, maxVisibleByDefault]);
  const hiddenCount = options.length - visibleOptions.length;

  return (
    <Popover
      open={open}
      onOpenChange={(o: boolean) => {
        setOpen(o);
        if (!o) setSearchValue("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selectedLabel || <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search…" value={searchValue} onValueChange={setSearchValue} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {visibleOptions.map((opt) => (
                <CommandItem
                  key={opt.value}
                  // Suffix with opt.value to ensure cmdk treats each item as
                  // unique even if two options have identical searchableText
                  // (pathological but possible — e.g., two queues both named
                  // "100 Sales" if data was mis-keyed). cmdk uses `value`
                  // for both filter-target AND item identity; collision
                  // would silently dedupe.
                  value={`${opt.searchableText} ${opt.value}`}
                  onSelect={() => {
                    onChange(opt.value);
                    setOpen(false);
                    setSearchValue("");
                  }}
                >
                  {opt.label}
                  {opt.value === value && <Check className="ml-auto h-4 w-4" />}
                </CommandItem>
              ))}
              {hiddenCount > 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground border-t">
                  + {hiddenCount} more — type to filter
                </div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline destination picker for the DID routing dialog. Hoisted out of
 * `DidsPage` so its identity is stable across renders — if it were declared
 * inside the parent, every keystroke in the `external` / `ai_agent` text
 * inputs would recreate the component and remount the `<Input>`, dropping
 * focus after every character (QA bug: "IVR destination gets deselected").
 *
 * Takes the option lists as props rather than closing over parent state.
 */
function DestinationField({
  routingType,
  value,
  onChange,
  userList,
  queueList,
  ivrList,
}: {
  routingType: string;
  value: string;
  onChange: (v: string) => void;
  userList: PbxUser[];
  queueList: PbxQueue[];
  ivrList: Ivr[];
}) {
  if (routingType === "extension") {
    // Show active extensions PLUS the currently-routed one (even if it's
    // gone inactive after the DID was wired up). Without this, an inactive
    // user disappears from the dropdown silently and the operator can't
    // re-select them — only re-type from scratch.
    const opts = userList
      .filter((u) => u.status === "active" || u.extension === value)
      .map((u) => ({
        value: u.extension,
        label:
          u.status === "active"
            ? `${u.extension} — ${u.full_name || u.username}`
            : `${u.extension} — ${u.full_name || u.username} (inactive)`,
        searchableText: `${u.extension} ${u.full_name || ""} ${u.username || ""}`,
      }));
    return (
      <SearchableCombobox
        value={value}
        onChange={onChange}
        placeholder="Select extension"
        emptyMessage="No matching extension"
        options={opts}
      />
    );
  }
  if (routingType === "queue") {
    // Same "keep current selection visible" pattern as extensions above.
    const opts = queueList
      .filter((q) => q.status === "active" || q.number === value)
      .map((q) => ({
        value: q.number,
        label:
          q.status === "active" ? `${q.number} — ${q.name}` : `${q.number} — ${q.name} (inactive)`,
        searchableText: `${q.number} ${q.name}`,
      }));
    return (
      <SearchableCombobox
        value={value}
        onChange={onChange}
        placeholder="Select queue"
        emptyMessage="No matching queue"
        options={opts}
      />
    );
  }
  if (routingType === "ivr") {
    // IVR destination must be the IVR's UUID — dialplanGenerator.js looks it
    // up with `org.ivrs.find(i => i.id === did.routing_destination)`. A free
    // text extension like "7002" will not match and the call plays
    // `number-not-in-service`. Force a typed-search dropdown so operators
    // can't enter arbitrary text but can still find an IVR among many.
    // Keep currently-routed IVR visible even if inactive (same pattern).
    const opts = ivrList
      .filter((i) => i.status === "active" || i.id === value)
      .map((i) => ({
        value: i.id,
        label:
          i.status === "active"
            ? `${i.extension} — ${i.name}`
            : `${i.extension} — ${i.name} (inactive)`,
        searchableText: `${i.extension} ${i.name}`,
      }));
    return (
      <SearchableCombobox
        value={value}
        onChange={onChange}
        placeholder="Select IVR"
        emptyMessage="No matching IVR"
        options={opts}
      />
    );
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={
        routingType === "external"
          ? "+919876543210"
          : routingType === "ai_agent"
            ? "wss://bot.example.com"
            : "Destination"
      }
    />
  );
}

export default function DidsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [tab, setTab] = useState<"my" | "buy">("my");
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(10);
  const [assignedPage, setAssignedPage] = useState(1);
  const [assignedPageSize, setAssignedPageSize] = useState(10);
  const [buyPage, setBuyPage] = useState(1);
  const [buyPageSize, setBuyPageSize] = useState(10);
  const [loading, setLoading] = useState(true);

  // My numbers
  const [myData, setMyData] = useState<MyDidsResponse>({ assigned: [], pending: [] });
  const [userList, setUserList] = useState<PbxUser[]>([]);
  const [queueList, setQueueList] = useState<PbxQueue[]>([]);
  const [ivrList, setIvrList] = useState<Ivr[]>([]);

  // Available pool
  const [available, setAvailable] = useState<PoolDid[]>([]);
  const [requesting, setRequesting] = useState<string | null>(null);

  // Edit routing dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingDid, setEditingDid] = useState<PoolDid | null>(null);
  const [editForm, setEditForm] = useState({
    description: "",
    routing_type: "extension",
    routing_destination: "",
    status: "active",
  });

  useEffect(() => {
    loadAll();
  }, [orgId]);

  async function loadAll() {
    setLoading(true);
    try {
      const [my, avail, u, q, i] = await Promise.all([
        didPool.my(),
        didPool.available(),
        users.list(),
        queues.list(),
        ivrs.list().catch(() => [] as Ivr[]),
      ]);
      setMyData(my);
      setAvailable(avail);
      setUserList(u);
      setQueueList(q);
      setIvrList(i);
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
    setLoading(false);
  }

  async function handleRequest(id: string) {
    setRequesting(id);
    try {
      await didPool.request(id);
      showToast("Number requested — awaiting admin approval", "success");
      loadAll();
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
    setRequesting(null);
  }

  async function handleCancelRequest(id: string) {
    try {
      await didPool.cancelRequest(id);
      showToast("Request cancelled", "success");
      loadAll();
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
  }

  function openEdit(did: PoolDid) {
    setEditingDid(did);
    setEditForm({
      description: did.description || "",
      routing_type: did.routing_type || "extension",
      routing_destination: did.routing_destination || "",
      status: did.status || "active",
    });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!editingDid) return;
    try {
      await dids.update(editingDid.id, {
        description: editForm.description,
        routing_type: editForm.routing_type as
          | "extension"
          | "queue"
          | "ivr"
          | "ai_agent"
          | "intercom"
          | "external",
        routing_destination: editForm.routing_destination,
        status: editForm.status as "active" | "inactive",
      });
      showToast("Routing updated", "success");
      setEditOpen(false);
      loadAll();
    } catch (e: unknown) {
      showToast((e as Error).message, "error");
    }
  }

  function formatNumber(num: string) {
    const clean = num.replace(/[^0-9]/g, "");
    if (clean.length === 12 && clean.startsWith("91")) {
      return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
    }
    return num;
  }

  // Resolve IVR UUIDs to their human-readable extension/name for the
  // routing column. Other routing_types already store human values
  // (extension number, queue number, external dial string).
  function displayDestination(did: PoolDid) {
    if (!did.routing_destination) return "—";
    if (did.routing_type === "ivr") {
      const ivr = ivrList.find((i) => i.id === did.routing_destination);
      return ivr ? `${ivr.extension} — ${ivr.name}` : did.routing_destination;
    }
    return did.routing_destination;
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">DID Numbers</h1>
          <p className="text-sm text-muted-foreground">
            Manage your phone numbers and buy new ones
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Numbers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{myData.assigned.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{myData.pending.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Available to Buy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{available.length}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "my" | "buy")}>
        <TabsList>
          <TabsTrigger value="my">
            <Phone className="h-4 w-4 mr-1.5" /> My Numbers
            {myData.pending.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {myData.pending.length} pending
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="buy">
            <ShoppingCart className="h-4 w-4 mr-1.5" /> Buy a Number
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              {available.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── MY NUMBERS TAB ── */}
        <TabsContent value="my" className="space-y-4">
          {/* Pending requests */}
          {myData.pending.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Pending Approval
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-2">
                  <div className="overflow-auto flex-1 relative">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
                        <TableRow className="border-b-border/50 hover:bg-transparent">
                          <TableHead>Number</TableHead>
                          <TableHead>Region</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead>Requested</TableHead>
                          <TableHead className="w-20"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {myData.pending
                          .slice((pendingPage - 1) * pendingPageSize, pendingPage * pendingPageSize)
                          .map((d) => (
                            <TableRow key={d.id}>
                              <TableCell className="font-mono">{formatNumber(d.number)}</TableCell>
                              <TableCell>{d.region || "—"}</TableCell>
                              <TableCell>{d.provider || "—"}</TableCell>
                              <TableCell className="text-muted-foreground text-xs">
                                {d.requested_at
                                  ? format(new Date(d.requested_at), "dd MMM yyyy HH:mm")
                                  : "—"}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  onClick={() => handleCancelRequest(d.id)}
                                >
                                  Cancel
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                  {myData.pending.length > 10 && (
                    <div className="border-t border-border/50 bg-muted/30 px-4 py-3 sticky bottom-0 z-10 flex items-center justify-between">
                      <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                        Showing {(pendingPage - 1) * pendingPageSize + 1}–
                        {Math.min(pendingPage * pendingPageSize, myData.pending.length)} of{" "}
                        {myData.pending.length} entries
                      </div>
                      <div className="flex w-full items-center gap-8 lg:w-fit">
                        <div className="hidden items-center gap-2 lg:flex">
                          <Label className="text-sm font-medium">Rows per page</Label>
                          <Select
                            value={`${pendingPageSize}`}
                            onValueChange={(value) => {
                              setPendingPageSize(Number(value));
                              setPendingPage(1);
                            }}
                          >
                            <SelectTrigger className="w-20">
                              <SelectValue placeholder={pendingPageSize} />
                            </SelectTrigger>
                            <SelectContent side="top">
                              {[10, 20, 30, 40, 50].map((size) => (
                                <SelectItem key={size} value={`${size}`}>
                                  {size}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex w-fit items-center justify-center text-sm font-medium">
                          Page {pendingPage} of{" "}
                          {Math.ceil(myData.pending.length / pendingPageSize) || 1}
                        </div>
                        <div className="ml-auto flex items-center gap-2 lg:ml-0">
                          <Button
                            variant="outline"
                            className="hidden h-8 w-8 p-0 lg:flex"
                            onClick={() => setPendingPage(1)}
                            disabled={pendingPage <= 1}
                          >
                            <span className="sr-only">Go to first page</span>
                            <ChevronsLeft className="size-4" />
                          </Button>
                          <Button
                            variant="outline"
                            className="size-8"
                            size="icon"
                            onClick={() => setPendingPage((p) => p - 1)}
                            disabled={pendingPage <= 1}
                          >
                            <span className="sr-only">Go to previous page</span>
                            <ChevronLeft className="size-4" />
                          </Button>
                          <Button
                            variant="outline"
                            className="size-8"
                            size="icon"
                            onClick={() => setPendingPage((p) => p + 1)}
                            disabled={pendingPage * pendingPageSize >= myData.pending.length}
                          >
                            <span className="sr-only">Go to next page</span>
                            <ChevronRight className="size-4" />
                          </Button>
                          <Button
                            variant="outline"
                            className="hidden size-8 lg:flex"
                            size="icon"
                            onClick={() =>
                              setPendingPage(Math.ceil(myData.pending.length / pendingPageSize))
                            }
                            disabled={pendingPage * pendingPageSize >= myData.pending.length}
                          >
                            <span className="sr-only">Go to last page</span>
                            <ChevronsRight className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Assigned numbers */}
          <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-2">
            <div className="overflow-auto flex-1 relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
                  <TableRow className="border-b-border/50 hover:bg-transparent">
                    <TableHead>Number</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Routing</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : myData.assigned.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No numbers assigned. Go to "Buy a Number" to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    myData.assigned
                      .slice((assignedPage - 1) * assignedPageSize, assignedPage * assignedPageSize)
                      .map((did) => (
                        <TableRow key={did.id}>
                          <TableCell className="font-mono text-sm">
                            {formatNumber(did.number)}
                            {did.is_default && (
                              <Badge variant="default" className="ml-2 text-[10px] px-1.5 py-0">
                                Default
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{did.description || "—"}</TableCell>
                          <TableCell>
                            {did.routing_type ? (
                              <Badge variant="outline" className="text-xs capitalize">
                                {did.routing_type}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                Not configured
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm max-w-[200px] truncate">
                            {displayDestination(did)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={did.status === "active" ? "default" : "secondary"}
                              className="text-xs"
                            >
                              {did.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEdit(did)}>
                                  Configure Routing
                                </DropdownMenuItem>
                                {!did.is_default && (
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      try {
                                        await didPool.setDefault(did.id);
                                        showToast(
                                          `${did.number} set as default caller ID`,
                                          "success"
                                        );
                                        loadAll();
                                      } catch (e) {
                                        showToast((e as Error).message, "error");
                                      }
                                    }}
                                  >
                                    Set as Default Caller ID
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </div>
            {myData.assigned.length > 10 && (
              <div className="border-t border-border/50 bg-muted/30 px-4 py-3 sticky bottom-0 z-10 flex items-center justify-between">
                <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                  Showing {(assignedPage - 1) * assignedPageSize + 1}–
                  {Math.min(assignedPage * assignedPageSize, myData.assigned.length)} of{" "}
                  {myData.assigned.length} entries
                </div>
                <div className="flex w-full items-center gap-8 lg:w-fit">
                  <div className="hidden items-center gap-2 lg:flex">
                    <Label className="text-sm font-medium">Rows per page</Label>
                    <Select
                      value={`${assignedPageSize}`}
                      onValueChange={(value) => {
                        setAssignedPageSize(Number(value));
                        setAssignedPage(1);
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue placeholder={assignedPageSize} />
                      </SelectTrigger>
                      <SelectContent side="top">
                        {[10, 20, 30, 40, 50].map((size) => (
                          <SelectItem key={size} value={`${size}`}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex w-fit items-center justify-center text-sm font-medium">
                    Page {assignedPage} of{" "}
                    {Math.ceil(myData.assigned.length / assignedPageSize) || 1}
                  </div>
                  <div className="ml-auto flex items-center gap-2 lg:ml-0">
                    <Button
                      variant="outline"
                      className="hidden h-8 w-8 p-0 lg:flex"
                      onClick={() => setAssignedPage(1)}
                      disabled={assignedPage <= 1}
                    >
                      <span className="sr-only">Go to first page</span>
                      <ChevronsLeft className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="size-8"
                      size="icon"
                      onClick={() => setAssignedPage((p) => p - 1)}
                      disabled={assignedPage <= 1}
                    >
                      <span className="sr-only">Go to previous page</span>
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="size-8"
                      size="icon"
                      onClick={() => setAssignedPage((p) => p + 1)}
                      disabled={assignedPage * assignedPageSize >= myData.assigned.length}
                    >
                      <span className="sr-only">Go to next page</span>
                      <ChevronRight className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="hidden size-8 lg:flex"
                      size="icon"
                      onClick={() =>
                        setAssignedPage(Math.ceil(myData.assigned.length / assignedPageSize))
                      }
                      disabled={assignedPage * assignedPageSize >= myData.assigned.length}
                    >
                      <span className="sr-only">Go to last page</span>
                      <ChevronsRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── BUY A NUMBER TAB ── */}
        <TabsContent value="buy">
          <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-2">
            <div className="overflow-auto flex-1 relative">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
                  <TableRow className="border-b-border/50 hover:bg-transparent">
                    <TableHead>Number</TableHead>
                    <TableHead>Price/mo</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="w-28"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : available.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No numbers available right now
                      </TableCell>
                    </TableRow>
                  ) : (
                    (() => {
                      const lowestPrice = Math.min(
                        ...available
                          .filter((d) => d.monthly_price)
                          .map((d) => Number(d.monthly_price))
                      );
                      return available
                        .slice((buyPage - 1) * buyPageSize, buyPage * buyPageSize)
                        .map((did) => {
                          const isLowest = Number(did.monthly_price) === lowestPrice;
                          return (
                            <TableRow key={did.id} className={isLowest ? "bg-primary/5" : ""}>
                              <TableCell className="font-mono text-sm font-medium">
                                {formatNumber(did.number)}
                              </TableCell>
                              <TableCell className={isLowest ? "font-semibold" : ""}>
                                {did.monthly_price
                                  ? `₹${Number(did.monthly_price).toLocaleString()}/mo`
                                  : "—"}
                                {isLowest && (
                                  <Badge variant="default" className="ml-2 text-[10px]">
                                    Best Value
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>{did.region || "—"}</TableCell>
                              <TableCell>{did.provider || "—"}</TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  disabled={requesting === did.id}
                                  onClick={() => handleRequest(did.id)}
                                >
                                  {requesting === did.id ? "Requesting..." : "Request"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        });
                    })()
                  )}
                </TableBody>
              </Table>
            </div>
            {available.length > 10 && (
              <div className="border-t border-border/50 bg-muted/30 px-4 py-3 sticky bottom-0 z-10 flex items-center justify-between">
                <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                  Showing {(buyPage - 1) * buyPageSize + 1}–
                  {Math.min(buyPage * buyPageSize, available.length)} of {available.length} entries
                </div>
                <div className="flex w-full items-center gap-8 lg:w-fit">
                  <div className="hidden items-center gap-2 lg:flex">
                    <Label className="text-sm font-medium">Rows per page</Label>
                    <Select
                      value={`${buyPageSize}`}
                      onValueChange={(value) => {
                        setBuyPageSize(Number(value));
                        setBuyPage(1);
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue placeholder={buyPageSize} />
                      </SelectTrigger>
                      <SelectContent side="top">
                        {[10, 20, 30, 40, 50].map((size) => (
                          <SelectItem key={size} value={`${size}`}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex w-fit items-center justify-center text-sm font-medium">
                    Page {buyPage} of {Math.ceil(available.length / buyPageSize) || 1}
                  </div>
                  <div className="ml-auto flex items-center gap-2 lg:ml-0">
                    <Button
                      variant="outline"
                      className="hidden h-8 w-8 p-0 lg:flex"
                      onClick={() => setBuyPage(1)}
                      disabled={buyPage <= 1}
                    >
                      <span className="sr-only">Go to first page</span>
                      <ChevronsLeft className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="size-8"
                      size="icon"
                      onClick={() => setBuyPage((p) => p - 1)}
                      disabled={buyPage <= 1}
                    >
                      <span className="sr-only">Go to previous page</span>
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="size-8"
                      size="icon"
                      onClick={() => setBuyPage((p) => p + 1)}
                      disabled={buyPage * buyPageSize >= available.length}
                    >
                      <span className="sr-only">Go to next page</span>
                      <ChevronRight className="size-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="hidden size-8 lg:flex"
                      size="icon"
                      onClick={() => setBuyPage(Math.ceil(available.length / buyPageSize))}
                      disabled={buyPage * buyPageSize >= available.length}
                    >
                      <span className="sr-only">Go to last page</span>
                      <ChevronsRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Routing Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Configure — {editingDid ? formatNumber(editingDid.number) : ""}
            </DialogTitle>
            <DialogDescription>Set up how calls to this number are routed</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Main reception line"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Routing Type</Label>
              <Select
                value={editForm.routing_type}
                onValueChange={(v) =>
                  setEditForm({ ...editForm, routing_type: v, routing_destination: "" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="extension">Extension</SelectItem>
                  <SelectItem value="queue">Queue</SelectItem>
                  <SelectItem value="external">External Number</SelectItem>
                  <SelectItem value="ai_agent">AI Agent (WSS)</SelectItem>
                  <SelectItem value="ivr">IVR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Destination</Label>
              <DestinationField
                routingType={editForm.routing_type}
                value={editForm.routing_destination}
                onChange={(v) => setEditForm({ ...editForm, routing_destination: v })}
                userList={userList}
                queueList={queueList}
                ivrList={ivrList}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(v) => setEditForm({ ...editForm, status: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={!editForm.routing_destination}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
