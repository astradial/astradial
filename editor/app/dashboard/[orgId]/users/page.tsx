"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Wifi,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { showToast } from "@/components/ui/Toast";
import { SipQrDialog } from "@/components/users/SipQrDialog";
import { didPool, type PoolDid } from "@/lib/did-pool/client";
import {
  config as pbxConfig,
  type PbxUser,
  type PbxUserRegistration,
  users,
} from "@/lib/pbx/client";

export default function UsersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [userList, setUserList] = useState<PbxUser[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [qrUser, setQrUser] = useState<PbxUser | null>(null);
  const [editUser, setEditUser] = useState<PbxUser | null>(null);

  // Search filter — matches against name/username/email/extension (case-insensitive)
  const [searchQuery, setSearchQuery] = useState("");
  // Sort by extension — direction toggles between asc, desc, and unsorted (null)
  const [sipSort, setSipSort] = useState<"asc" | "desc" | null>("asc");
  // Tracks which user's status toggle is in-flight (per-row spinner state).
  // Prevents double-click races and lets us optimistically update the UI
  // while the PUT completes.
  const [statusToggling, setStatusToggling] = useState<Record<string, boolean>>({});

  // Live PJSIP registration state per user, indexed by user_id. Populated
  // by polling /users/registrations every 30s — same cadence as Asterisk's
  // server-side cache TTL so we never make wasted calls.
  const [regByUserId, setRegByUserId] = useState<Record<string, PbxUserRegistration>>({});
  // Polling state for the staleness/health indicator near the page heading.
  //   asteriskUnreachable: backend couldn't query Asterisk on the last poll
  //     (red banner so operator doesn't trust stale dots during an outage)
  //   fetchedAt: epoch ms of the most recent SUCCESSFUL fetch
  //   refreshing: a force-refresh is currently in-flight (button spinner)
  //   firstLoadDone: distinguishes initial gray-loading state from later
  //     gray-loading (so we render differently)
  const [regHealth, setRegHealth] = useState<{
    asteriskUnreachable: boolean;
    fetchedAt: number | null;
    refreshing: boolean;
    firstLoadDone: boolean;
  }>({ asteriskUnreachable: false, fetchedAt: null, refreshing: false, firstLoadDone: false });

  // Wall-clock tick so the "Updated Xs ago" label re-renders without a
  // dedicated state update. Bumps every 5s.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, []);
  // Debounce timer for pbxConfig.deploy() + reload() so rapid sequential
  // toggles (e.g., end-of-shift bulk inactive flip) coalesce into ONE
  // Asterisk reload instead of N reloads. The PUT for each user is still
  // immediate; only the deploy is batched.
  const deployTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deployInFlight, setDeployInFlight] = useState(false);
  useEffect(() => {
    return () => {
      if (deployTimerRef.current) clearTimeout(deployTimerRef.current);
    };
  }, []);

  /**
   * Schedule (or reschedule) a deploy+reload. Debounces to 750ms after the
   * last call so a burst of toggles fires exactly one Asterisk reload.
   * Returns immediately — the actual deploy happens asynchronously.
   */
  function scheduleDeploy() {
    if (deployTimerRef.current) clearTimeout(deployTimerRef.current);
    deployTimerRef.current = setTimeout(async () => {
      deployTimerRef.current = null;
      setDeployInFlight(true);
      try {
        await pbxConfig.deploy();
        await pbxConfig.reload();
        showToast("Config deployed", "success");
      } catch (e) {
        showToast(
          `Config reload failed: ${e instanceof Error ? e.message : "unknown"}. Retry in Settings.`,
          "warning"
        );
      } finally {
        setDeployInFlight(false);
      }
    }, 750);
  }
  const [editForm, setEditForm] = useState({
    full_name: "",
    email: "",
    extension: "",
    password: "",
    role: "agent" as PbxUser["role"],
    routing_type: "sip" as "sip" | "ai_agent",
    routing_destination: "",
    phone_number: "",
    ring_target: "ext" as "ext" | "phone",
    outbound_did: "",
    // Failover routing — mutually exclusive choice between a SIP user
    // and a phone number. `failover_type` drives the radio toggle in
    // the dialog; only the corresponding value is sent on save (the
    // other is forced null) so the server never sees both set.
    // 'none' = no failover, server stores both as null.
    failover_type: "none" as "none" | "user" | "phone",
    failover_destination_user_id: "",
    // Phone form holds just the 10-digit Indian local number — we
    // prefix +91 at save time. Server stores +91XXXXXXXXXX.
    failover_phone_number: "",
    failover_timeout_seconds: "20",
  });

  function openEdit(user: PbxUser) {
    setEditUser(user);
    // Derive radio-toggle state from whichever stored field is set.
    // Server enforces mutual exclusion so at most one is non-null.
    // Phone form value: strip the +91 prefix for display since the UI
    // shows the prefix as a fixed addon next to the input.
    const phone = user.failover_phone_number || "";
    const phoneLocal = phone.replace(/^\+91/, "");
    let failoverType: "none" | "user" | "phone" = "none";
    if (user.failover_destination_user_id) failoverType = "user";
    else if (user.failover_phone_number) failoverType = "phone";
    setEditForm({
      full_name: user.full_name || "",
      email: user.email || "",
      extension: user.extension || "",
      password: "",
      role: user.role || "agent",
      routing_type: user.routing_type || "sip",
      routing_destination: user.routing_destination || "",
      phone_number: user.phone_number || "",
      ring_target: user.ring_target || "ext",
      outbound_did: user.outbound_did || "",
      failover_type: failoverType,
      failover_destination_user_id: user.failover_destination_user_id || "",
      failover_phone_number: phoneLocal,
      failover_timeout_seconds: String(user.failover_timeout_seconds ?? 20),
    });
  }

  async function handleEdit() {
    if (!editUser) return;
    // Coerce timeout to int and clamp to the same 5-120 range the API enforces,
    // so we surface a usable value even if the user typed something silly.
    const timeoutInt = Math.max(
      5,
      Math.min(120, Number.parseInt(editForm.failover_timeout_seconds, 10) || 20)
    );
    // Compute the failover payload from the radio-toggle state. Server
    // rejects both-set with 400, so always send EXACTLY one of (user_id,
    // phone_number) — the other is forced null. 'none' clears both.
    //
    // Validation: if the operator picked "user" or "phone" radio but
    // didn't actually pick a value, REJECT here with a toast rather
    // than silently downgrading to "no failover" — they expressed an
    // intent that we shouldn't drop on save (caught by UAT review).
    let failoverUserId: string | null = null;
    let failoverPhone: string | null = null;
    if (editForm.failover_type === "user") {
      if (!editForm.failover_destination_user_id) {
        showToast("Please pick a SIP user for failover, or choose 'No failover'.", "error");
        return;
      }
      failoverUserId = editForm.failover_destination_user_id;
    } else if (editForm.failover_type === "phone") {
      const digits = editForm.failover_phone_number.replace(/[^0-9]/g, "");
      if (!digits) {
        showToast("Please enter a failover phone number, or choose 'No failover'.", "error");
        return;
      }
      if (digits.length < 10) {
        showToast("Failover phone number must be 10 digits.", "error");
        return;
      }
      failoverPhone = `+91${digits.slice(-10)}`;
    }
    try {
      await users.update(editUser.id, {
        full_name: editForm.full_name,
        email: editForm.email,
        extension: editForm.extension,
        role: editForm.role,
        outbound_did: editForm.outbound_did || null,
        failover_destination_user_id: failoverUserId,
        failover_phone_number: failoverPhone,
        failover_timeout_seconds: timeoutInt,
        ...(editForm.password ? { password: editForm.password } : {}),
      });
      await users.updateRouting(editUser.id, {
        routing_type: editForm.routing_type,
        routing_destination: editForm.routing_destination || undefined,
        ring_target: editForm.ring_target,
        phone_number: editForm.phone_number || undefined,
      });
      showToast("User updated — deploying config...", "success");
      setEditUser(null);
      try {
        await pbxConfig.deploy();
        await pbxConfig.reload();
        showToast("Config deployed", "success");
      } catch {
        showToast("Updated but deploy failed", "error");
      }
      await loadUsers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update", "error");
    }
  }

  const [form, setForm] = useState({
    username: "",
    email: "",
    extension: "",
    full_name: "",
    password: "",
    role: "agent" as PbxUser["role"],
    routing_type: "sip" as "sip" | "ai_agent",
    routing_destination: "",
    phone_number: "",
    ring_target: "ext" as "ext" | "phone",
    outbound_did: "",
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const [orgDids, setOrgDids] = useState<PoolDid[]>([]);
  useEffect(() => {
    didPool
      .my()
      .then((r) => setOrgDids(r.assigned || []))
      .catch(() => {});
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      setUserList(await users.list());
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Derived list: apply search filter then sort. Client-side because the
   * users API returns the full org list (no server-side pagination today).
   * Memoized so we only recompute when inputs change.
   */
  const visibleUsers = useMemo(() => {
    let result = userList;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((u) => {
        const haystack = [
          u.full_name || "",
          u.username || "",
          u.email || "",
          u.extension || "",
          u.phone_number || "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    if (sipSort) {
      // Sort by extension. Tricky case: V7 has a mix of numeric (1001, 101,
      // 09) and string (potentially "Reception", "MD") extensions. A naive
      // "if both numeric, compare numerically; else string compare" makes
      // ONE non-numeric extension degrade the entire list's order — string
      // compare puts "1009" before "101" before "09" lexicographically.
      //
      // Solution: partition into numeric vs non-numeric, sort each partition
      // on its native scale, then concatenate. In ascending mode numerics
      // come first; descending reverses both partitions and their order.
      //
      // Strict numeric detection: `/^-?\d+$/` (no whitespace, no scientific
      // notation, no hex — those should be treated as strings).
      const NUMERIC_EXT_REGEX = /^-?\d+$/;
      const numeric: PbxUser[] = [];
      const nonNumeric: PbxUser[] = [];
      for (const u of result) {
        const ext = u.extension || "";
        (NUMERIC_EXT_REGEX.test(ext) ? numeric : nonNumeric).push(u);
      }
      numeric.sort((a, b) => Number(a.extension) - Number(b.extension));
      nonNumeric.sort((a, b) => (a.extension || "").localeCompare(b.extension || ""));
      result =
        sipSort === "asc"
          ? [...numeric, ...nonNumeric]
          : [...nonNumeric.reverse(), ...numeric.reverse()];
    }
    return result;
  }, [userList, searchQuery, sipSort]);

  // Reset to page 1 when the filter narrows the set (otherwise empty pages).
  useEffect(() => {
    setPage(1);
  }, [searchQuery, sipSort]);

  /**
   * Fetch registration state. Stable reference so it can be called from:
   *   - The 30s polling interval
   *   - The manual refresh button
   *   - The tab-visibilitychange listener (when the operator comes back
   *     to the tab after >60s and the data is stale)
   *
   * Sets `regHealth` so the UI can show a degraded banner when Asterisk
   * is unreachable. Silent network failures (request<T> reject) still
   * leave the previous state intact — better than wiping the screen.
   */
  const loadRegistrations = useMemo(
    () =>
      async (opts: { force?: boolean } = {}) => {
        try {
          if (opts.force) {
            setRegHealth((h) => ({ ...h, refreshing: true }));
          }
          const res = await users.registrations({ force: opts.force });
          const next: Record<string, PbxUserRegistration> = {};
          for (const r of res.registrations) next[r.user_id] = r;
          setRegByUserId(next);
          setRegHealth({
            asteriskUnreachable: res.asterisk_unreachable,
            fetchedAt: new Date(res.fetched_at).getTime(),
            refreshing: false,
            firstLoadDone: true,
          });
        } catch (err) {
          // Network/HTTP failure. Distinct from asterisk_unreachable=true
          // (which is a 200 response with a degraded body). Surface as the
          // same degraded banner — operator action is the same: investigate.
          console.warn("[users] registration poll failed:", err);
          setRegHealth((h) => ({
            ...h,
            asteriskUnreachable: true,
            refreshing: false,
            firstLoadDone: true,
          }));
        }
      },
    []
  );

  // Initial load + 30s polling. Server-side cache TTL matches the polling
  // interval so we never trigger an Asterisk shell call mid-cycle.
  useEffect(() => {
    let cancelled = false;
    const wrapped = async () => {
      if (!cancelled) await loadRegistrations();
    };
    wrapped();
    const interval = setInterval(wrapped, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadRegistrations]);

  // Refetch on tab visibility regain — if the user returned to the tab
  // after >60s away (browser sleep / switched apps), the displayed data
  // is stale. Force-refresh once to give them current state immediately
  // instead of waiting for the next polling cycle.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      const fetchedAt = regHealth.fetchedAt;
      if (!fetchedAt || Date.now() - fetchedAt > 60_000) {
        loadRegistrations({ force: true });
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadRegistrations, regHealth.fetchedAt]);

  function toggleSipSort() {
    // 3-state cycle: asc → desc → null (unsorted) → asc
    setSipSort((s) => (s === "asc" ? "desc" : s === "desc" ? null : "asc"));
  }

  /**
   * Toggle a user's active/inactive status. Status changes are operator-
   * gated — they require a dialplan regen so the inactive user no longer
   * receives calls (per the agreed semantic: inactive = "do not ring this
   * user"). We optimistically update the local list, fire PUT + deploy,
   * and revert if anything fails.
   */
  async function toggleUserStatus(user: PbxUser, nextActive: boolean) {
    if (statusToggling[user.id]) return; // race guard
    const nextStatus: PbxUser["status"] = nextActive ? "active" : "inactive";
    setStatusToggling((m) => ({ ...m, [user.id]: true }));
    // Optimistic UI: flip the local row immediately
    setUserList((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: nextStatus } : u)));
    try {
      await users.update(user.id, { status: nextStatus });
      showToast(`${user.full_name || user.username} → ${nextStatus}`, "success");
      // Coalesce multiple rapid toggles into ONE Asterisk reload. The PUT
      // itself committed already; the reload window is 750ms after the
      // last toggle.
      scheduleDeploy();
    } catch (e) {
      // Revert optimistic update
      setUserList((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, status: user.status } : u))
      );
      showToast(e instanceof Error ? e.message : "Failed to update status", "error");
    } finally {
      setStatusToggling((m) => {
        const next = { ...m };
        delete next[user.id];
        return next;
      });
    }
  }

  async function handleCreate() {
    try {
      await users.create({
        username: form.username,
        email: form.email,
        extension: form.extension,
        full_name: form.full_name,
        password: form.password,
        role: form.role,
        routing_type: form.routing_type,
        routing_destination: form.routing_destination || undefined,
        phone_number: form.phone_number || undefined,
        ring_target: form.ring_target,
      });
      showToast("User created — deploying config...", "success");
      setCreateOpen(false);
      setForm({
        username: "",
        email: "",
        extension: "",
        full_name: "",
        password: "",
        role: "agent",
        routing_type: "sip",
        routing_destination: "",
        phone_number: "",
        ring_target: "ext",
        outbound_did: "",
      });
      // Auto-deploy Asterisk config so the new extension is immediately usable
      try {
        await pbxConfig.deploy();
        await pbxConfig.reload();
        showToast("Config deployed — extension ready", "success");
      } catch {
        showToast("User created but config deploy failed — deploy manually in Settings", "error");
      }
      await loadUsers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to create user", "error");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this user?")) return;
    try {
      await users.delete(id);
      showToast("User deleted", "success");
      await loadUsers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete", "error");
    }
  }

  const routingIcon = (u: PbxUser) =>
    u.routing_type === "ai_agent" ? (
      <Bot className="h-3.5 w-3.5" />
    ) : u.ring_target === "phone" ? (
      <Phone className="h-3.5 w-3.5" />
    ) : (
      <Wifi className="h-3.5 w-3.5" />
    );
  const routingLabel = (u: PbxUser) =>
    u.routing_type === "ai_agent" ? "AI Bot" : u.ring_target === "phone" ? "Phone" : "SIP";

  /**
   * Render a relative time like "Updated 12s ago". Caps at a reasonable
   * "an hour ago" granularity — beyond that the operator should look at
   * the absolute timestamp in the tooltip.
   */
  function formatAgo(epochMs: number): string {
    const secs = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
    if (secs < 5) return "just now";
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  return (
    <div className="p-3 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users & Extensions</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            Manage SIP users, extensions, and call routing
            {deployInFlight && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Deploying config…
              </span>
            )}
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create User</DialogTitle>
              <DialogDescription>Add a new extension to the organization</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Full Name</Label>
                  <Input
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Extension</Label>
                  <Input
                    value={form.extension}
                    onChange={(e) => setForm({ ...form, extension: e.target.value })}
                    placeholder="1001"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Username</Label>
                  <Input
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="johndoe"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="john@example.com"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      autoComplete="off"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="Min 6 chars"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select
                    value={form.role}
                    onValueChange={(v) => setForm({ ...form, role: v as PbxUser["role"] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="supervisor">Supervisor</SelectItem>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="space-y-1.5">
                <Label>Call Routing</Label>
                <Select
                  value={
                    form.routing_type === "ai_agent"
                      ? "ai_agent"
                      : form.ring_target === "phone"
                        ? "phone"
                        : "sip"
                  }
                  onValueChange={(v) => {
                    if (v === "ai_agent")
                      setForm({ ...form, routing_type: "ai_agent", ring_target: "ext" });
                    else if (v === "phone")
                      setForm({ ...form, routing_type: "sip", ring_target: "phone" });
                    else setForm({ ...form, routing_type: "sip", ring_target: "ext" });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sip">SIP / IP Phone</SelectItem>
                    <SelectItem value="ai_agent">AI Bot (WSS URL)</SelectItem>
                    <SelectItem value="phone">Phone Call (Mobile)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.routing_type === "ai_agent" && (
                <div className="space-y-1.5">
                  <Label>WebSocket URL</Label>
                  <Input
                    value={form.routing_destination}
                    onChange={(e) => setForm({ ...form, routing_destination: e.target.value })}
                    placeholder="ws://localhost:7860/ws/{org}/{bot}?key=..."
                    className="font-mono text-xs"
                  />
                </div>
              )}
              {form.ring_target === "phone" && form.routing_type !== "ai_agent" && (
                <div className="space-y-1.5">
                  <Label>Phone Number</Label>
                  <Input
                    value={form.phone_number}
                    onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                    placeholder="+919876543210"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search bar — client-side filter against name / username / email / extension / phone */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name, extension, email…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs shadow-none"
          />
        </div>
        {searchQuery && (
          <span className="text-xs text-muted-foreground">
            {visibleUsers.length} of {userList.length} matching
          </span>
        )}
        {/* Registration polling health indicator — pushed to the right.
            Shows "Updated Xs ago" + a force-refresh button. When Asterisk
            is unreachable, an amber pill explains the dots are unknown. */}
        <div className="ml-auto flex items-center gap-2 text-xs">
          {regHealth.asteriskUnreachable && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-50 px-2 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <AlertTriangle className="h-3 w-3" />
              Registration status unavailable — Asterisk unreachable
            </span>
          )}
          {regHealth.firstLoadDone && regHealth.fetchedAt && !regHealth.asteriskUnreachable && (
            <span
              className="text-muted-foreground"
              title={new Date(regHealth.fetchedAt).toLocaleString()}
            >
              Updated {formatAgo(regHealth.fetchedAt)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={regHealth.refreshing}
            onClick={() => loadRegistrations({ force: true })}
            aria-label="Refresh registration status"
            title="Refresh registration status (bypasses 30s cache)"
          >
            <RefreshCw className={`h-3 w-3 ${regHealth.refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="border border-border/50 rounded-xl bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col mt-2">
        <div className="overflow-auto flex-1 relative">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-md border-b">
              <TableRow className="border-b-border/50 hover:bg-transparent">
                <TableHead className="w-24">
                  {/* Clickable Ext header — toggles sort asc → desc → unsorted.
                    SIP user identity in this list IS the extension, so this
                    is the sort the operator actually wants. */}
                  <button
                    type="button"
                    onClick={toggleSipSort}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                    aria-label={`Sort by extension ${sipSort === "asc" ? "ascending" : sipSort === "desc" ? "descending" : "unsorted"}`}
                  >
                    Ext
                    {sipSort === "asc" && <ArrowUp className="h-3 w-3" />}
                    {sipSort === "desc" && <ArrowDown className="h-3 w-3" />}
                    {sipSort === null && <ArrowUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Routing</TableHead>
                <TableHead className="w-44">Registered IP</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={8} />
              ) : visibleUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {searchQuery ? `No users match "${searchQuery}"` : "No users yet"}
                  </TableCell>
                </TableRow>
              ) : (
                visibleUsers.slice((page - 1) * pageSize, page * pageSize).map((user) => {
                  const reg = regByUserId[user.id];
                  // Dot color reflects whether the phone is actually reachable:
                  //   green  = reachable (registered + qualify ok)
                  //   amber  = registered but qualify pending/failed (NAT issue)
                  //   red    = not in Asterisk's contact table at all
                  //   gray   = state unknown — either initial loading OR
                  //            Asterisk is unreachable (banner above explains)
                  const isUnknown = !reg || reg.status === "unknown";
                  const dotClass = isUnknown
                    ? "bg-gray-300"
                    : reg!.status === "reachable"
                      ? "bg-green-500"
                      : reg!.status === "nonqual"
                        ? "bg-amber-500"
                        : reg!.status === "unreachable"
                          ? "bg-amber-500"
                          : "bg-red-500";
                  const dotTitle = !reg
                    ? "Loading…"
                    : reg.status === "unknown"
                      ? "State unknown — Asterisk unreachable"
                      : reg.status === "reachable"
                        ? `Reachable${reg.rtt_ms != null ? ` (RTT ${Math.round(reg.rtt_ms)}ms)` : ""}`
                        : reg.status === "nonqual"
                          ? "Registered but qualify pending (check NAT keep-alive)"
                          : reg.status === "unreachable"
                            ? "Registered but unreachable (qualify failed)"
                            : "Not registered";
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-mono text-sm">{user.extension}</TableCell>
                      <TableCell className="font-medium">
                        {user.full_name || user.username}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          {routingIcon(user)}
                          {routingLabel(user)}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            title={dotTitle}
                            className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
                          />
                          {reg && reg.contact_ip ? (
                            <span className="font-mono text-foreground" title={dotTitle}>
                              {reg.contact_ip}
                            </span>
                          ) : (
                            <span className="text-muted-foreground" title={dotTitle}>
                              {!reg ? "—" : reg.status === "unknown" ? "unknown" : "unregistered"}
                            </span>
                          )}
                          <span className="sr-only">{dotTitle}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {/* Active/inactive toggle. Switching to inactive flags the
                      user as offline — combined with the upcoming failover
                      feature, calls to inactive users won't ring them.
                      Spinner shows during the PUT round-trip; the bulk
                      Asterisk reload is debounced separately. */}
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={user.status === "active"}
                            disabled={!!statusToggling[user.id]}
                            onCheckedChange={(checked) => toggleUserStatus(user, checked)}
                            aria-label={`Toggle ${user.full_name || user.username} ${user.status === "active" ? "inactive" : "active"}`}
                          />
                          {statusToggling[user.id] ? (
                            <Loader2
                              className="h-3 w-3 animate-spin text-muted-foreground"
                              aria-label="saving"
                            />
                          ) : (
                            <span
                              className={`text-xs ${user.status === "active" ? "text-foreground" : "text-muted-foreground"}`}
                            >
                              {user.status}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(user)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setQrUser(user)}>
                              <QrCode className="h-4 w-4 mr-2" />
                              SIP QR Code
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(user.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {visibleUsers.length > 10 && (
          <div className="border-t border-border/50 bg-muted/30 px-4 py-3 sticky bottom-0 z-10 flex items-center justify-between">
            <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, visibleUsers.length)}{" "}
              of {visibleUsers.length} entries
            </div>
            <div className="flex w-full items-center gap-8 lg:w-fit">
              <div className="hidden items-center gap-2 lg:flex">
                <Label className="text-sm font-medium">Rows per page</Label>
                <Select
                  value={`${pageSize}`}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue placeholder={pageSize} />
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
                Page {page} of {Math.ceil(visibleUsers.length / pageSize) || 1}
              </div>
              <div className="ml-auto flex items-center gap-2 lg:ml-0">
                <Button
                  variant="outline"
                  className="hidden h-8 w-8 p-0 lg:flex"
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                >
                  <span className="sr-only">Go to first page</span>
                  <ChevronsLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="size-8"
                  size="icon"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page <= 1}
                >
                  <span className="sr-only">Go to previous page</span>
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="size-8"
                  size="icon"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * pageSize >= visibleUsers.length}
                >
                  <span className="sr-only">Go to next page</span>
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="hidden size-8 lg:flex"
                  size="icon"
                  onClick={() => setPage(Math.ceil(visibleUsers.length / pageSize))}
                  disabled={page * pageSize >= visibleUsers.length}
                >
                  <span className="sr-only">Go to last page</span>
                  <ChevronsRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {qrUser && <SipQrDialog user={qrUser} onClose={() => setQrUser(null)} />}

      <Dialog
        open={!!editUser}
        onOpenChange={(open) => {
          if (!open) setEditUser(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User — {editUser?.extension}</DialogTitle>
            <DialogDescription>Update user settings and call routing</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input
                  value={editForm.full_name}
                  onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Extension</Label>
                <Input
                  value={editForm.extension}
                  onChange={(e) => setEditForm({ ...editForm, extension: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select
                  value={editForm.role}
                  onValueChange={(v) => setEditForm({ ...editForm, role: v as PbxUser["role"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>New Password (leave blank to keep)</Label>
              <Input
                type="text"
                autoComplete="off"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="Leave blank to keep current"
              />
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label>Call Routing</Label>
              <Select
                value={
                  editForm.routing_type === "ai_agent"
                    ? "ai_agent"
                    : editForm.ring_target === "phone"
                      ? "phone"
                      : "sip"
                }
                onValueChange={(v) => {
                  if (v === "ai_agent")
                    setEditForm({ ...editForm, routing_type: "ai_agent", ring_target: "ext" });
                  else if (v === "phone")
                    setEditForm({ ...editForm, routing_type: "sip", ring_target: "phone" });
                  else setEditForm({ ...editForm, routing_type: "sip", ring_target: "ext" });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sip">SIP / IP Phone</SelectItem>
                  <SelectItem value="ai_agent">AI Bot (WSS URL)</SelectItem>
                  <SelectItem value="phone">Phone Call (Mobile)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editForm.routing_type === "ai_agent" && (
              <div className="space-y-1.5">
                <Label>WebSocket URL</Label>
                <Input
                  value={editForm.routing_destination}
                  onChange={(e) =>
                    setEditForm({ ...editForm, routing_destination: e.target.value })
                  }
                  placeholder="ws://localhost:7860/ws/{org}/{bot}"
                  className="font-mono text-xs"
                />
              </div>
            )}
            {editForm.ring_target === "phone" && editForm.routing_type !== "ai_agent" && (
              <div className="space-y-1.5">
                <Label>Phone Number</Label>
                <Input
                  value={editForm.phone_number}
                  onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })}
                  placeholder="+919876543210"
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Outbound Caller ID</Label>
            <Select
              value={editForm.outbound_did || "default"}
              onValueChange={(v) =>
                setEditForm({ ...editForm, outbound_did: v === "default" ? "" : v })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Use org default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Use org default DID</SelectItem>
                {orgDids.map((d) => (
                  <SelectItem key={d.id} value={d.number}>
                    {d.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              DID this user presents on outbound calls.
            </p>
          </div>
          {/* Failover routing — single-hop. Hidden for AI-agent users
                because their dialplan branch ends with Goto(end), making
                failover labels unreachable. Behaviour update (2026-05-13):
                failover fires ONLY when the primary device is unreachable
                (unregistered / network down). Busy, declined, and "rang
                out, no pickup" all go straight to busy tone / announce.
                Inactive-user toggle still goes direct to failover.

                Operators can fail over to either a SIP user OR an
                external phone number; the radio toggle below is a
                mutual-exclusion gate so the saved payload sets exactly
                one field. */}
          {editForm.routing_type !== "ai_agent" && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>Failover Destination</Label>
                <div className="flex flex-col gap-1 text-sm">
                  {(["none", "user", "phone"] as const).map((opt) => (
                    <label key={opt} className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="failover_type"
                        checked={editForm.failover_type === opt}
                        onChange={() => setEditForm({ ...editForm, failover_type: opt })}
                      />
                      <span>
                        {opt === "none" && "No failover"}
                        {opt === "user" && "Ring another SIP user"}
                        {opt === "phone" && "Ring a phone number"}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Fires only when the primary device is <strong>unreachable</strong>
                  (unregistered / network down) or the user is toggled inactive. Busy and "no
                  pickup" don&apos;t trigger failover.
                </p>
              </div>

              {/* SIP-user picker — shown only when "user" radio is chosen.
                    Same dropdown logic as before: active same-org users,
                    excludes the user being edited, pins a currently-selected
                    inactive user so its value isn't silently cleared. */}
              {editForm.failover_type === "user" && (
                <div className="space-y-1.5">
                  <Label>Failover SIP User</Label>
                  <Select
                    value={editForm.failover_destination_user_id || "none"}
                    onValueChange={(v) =>
                      setEditForm({
                        ...editForm,
                        failover_destination_user_id: v === "none" ? "" : v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a SIP user" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Pick a SIP user</SelectItem>
                      {(() => {
                        const currentId = editForm.failover_destination_user_id;
                        const visible = userList.filter((u) => {
                          if (u.id === editUser?.id) return false;
                          if (u.status === "active") return true;
                          return u.id === currentId;
                        });
                        return visible.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.extension} — {u.full_name || u.username}
                            {u.status === "inactive" ? " (inactive)" : ""}
                          </SelectItem>
                        ));
                      })()}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Phone-number input — shown only when "phone" radio is chosen.
                    +91 prefix is shown as a fixed addon so operators know
                    we expect Indian numbers; the input accepts the local
                    10-digit form. */}
              {editForm.failover_type === "phone" && (
                <div className="space-y-1.5">
                  <Label>Failover Phone Number</Label>
                  <div className="flex">
                    <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">
                      +91
                    </span>
                    <Input
                      className="rounded-l-none"
                      inputMode="numeric"
                      maxLength={13}
                      value={editForm.failover_phone_number}
                      onChange={(e) => {
                        // Allow only digits and limit to 10 (last 10 wins)
                        const digits = e.target.value.replace(/[^0-9]/g, "").slice(-10);
                        setEditForm({ ...editForm, failover_phone_number: digits });
                      }}
                      placeholder="9876543210"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    10-digit Indian mobile / landline number. The PBX dials this via the outbound
                    trunk.
                  </p>
                </div>
              )}

              {editForm.failover_type !== "none" && (
                <div className="space-y-1.5">
                  <Label>Failover Ring Timeout (seconds)</Label>
                  <Input
                    type="number"
                    min={5}
                    max={120}
                    value={editForm.failover_timeout_seconds}
                    onChange={(e) =>
                      setEditForm({ ...editForm, failover_timeout_seconds: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    How long the failover destination rings. Range 5-120s.
                  </p>
                </div>
              )}
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>
              Cancel
            </Button>
            <Button onClick={handleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
