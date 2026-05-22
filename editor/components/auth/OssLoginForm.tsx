"use client";

/**
 * OSS Sign In screen.
 *
 * Mirrors astradial-platform's editor/app/dashboard/page.tsx login layout
 * (image panel + tabbed Organisation/Admin form, hill background,
 * testimonial) but uses local email/password endpoints instead of
 * Firebase auth. Rendered by editor/app/dashboard/page.tsx whenever
 * NEXT_PUBLIC_USE_FIREBASE != "true".
 *
 * Three endpoints back this UI (all in api/src/server.js):
 *   POST /api/v1/auth/signup               — Organisation tab, Create Account
 *   POST /api/v1/auth/login-password       — Organisation tab, Sign In
 *   POST /api/v1/auth/admin-login-password — Admin tab, Sign In
 *
 * Token shape returned by each is identical so the dashboard renderers
 * downstream don't need to know which path the user took.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { markAdminSessionStart } from "@/lib/auth/authStore";

interface AuthUser {
  id: string | null;
  email: string;
  name: string | null;
  org_id: string | null;
  org_name: string | null;
  role: string;
  permissions?: string[];
  impersonating?: boolean;
}

interface OrgSummary {
  id: string;
  name: string;
  context_prefix?: string;
  status?: string;
  is_active?: boolean;
  contact_info?: Record<string, string | null> | null;
}

function pbxUrl(): string {
  return process.env.NEXT_PUBLIC_PBX_URL || "";
}

function persistOrgSession(token: string, user: AuthUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem("pbx_org_token", token);
  if (user.org_id) {
    localStorage.setItem(
      "org_access",
      JSON.stringify({
        org_id: user.org_id,
        org_name: user.org_name || "",
        api_key: token,
        role: user.role,
        email: user.email,
        name: user.name,
        user_id: user.id,
        impersonating: user.impersonating || false,
        source: "oss-local",
      }),
    );
    localStorage.setItem("user_role", user.role);
    if (user.permissions) {
      localStorage.setItem("user_permissions", JSON.stringify(user.permissions));
    }
  }
}

function persistAdminSession(adminKey: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("gateway_admin_key", adminKey);
  localStorage.setItem("admin_key", adminKey);
  markAdminSessionStart();
}

function readAdminKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("gateway_admin_key") || localStorage.getItem("admin_key");
}

// /api/v1/admin/* endpoints verify a JWT with isAdmin:true.
// gateway_admin_key (== INTERNAL_API_KEY) is different — it gates the
// pipecat-flow gateway admin panel. Keep them distinct.
function readAdminJwt(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("admin_jwt");
}

export function OssLoginForm() {
  const router = useRouter();

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // UI state
  const [tab, setTab] = useState<"org" | "admin">("org");
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Admin org list state (rendered after admin sign-in)
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [orgList, setOrgList] = useState<OrgSummary[]>([]);
  const [orgLoadError, setOrgLoadError] = useState<string | null>(null);

  // Org-request flow: shown after signup or after login of a user with
  // no org yet. orgRequestToken is the short-lived onboarding JWT.
  const [showOrgRequest, setShowOrgRequest] = useState(false);
  const [orgRequestToken, setOrgRequestToken] = useState<string>("");
  const [orgRequestEmail, setOrgRequestEmail] = useState<string>("");
  const [orgReq, setOrgReq] = useState({
    name: "",
    phone: "",
    address: "",
    industry: "",
    company_size: "",
    expected_users: "",
    description: "",
  });

  // If admin key is in localStorage from a previous session, jump straight
  // to the org-list view.
  useEffect(() => {
    if (readAdminKey()) {
      setAdminAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (!adminAuthenticated) return;
    void loadOrgs();
  }, [adminAuthenticated]);

  async function loadOrgs() {
    setOrgLoadError(null);
    try {
      const jwt = readAdminJwt();
      if (!jwt) {
        // Admin key in localStorage but JWT missing — usually a stale
        // session from before the new login flow. Bounce them out so
        // they sign in again and get a fresh JWT.
        handleAdminLogout();
        return;
      }
      const r = await fetch(`${pbxUrl()}/api/v1/admin/organizations`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      const list = (await r.json()) as OrgSummary[];
      setOrgList(list);
    } catch (e) {
      setOrgLoadError(e instanceof Error ? e.message : "Failed to load organisations");
    }
  }

  async function handleOrgLogin() {
    setError(null);
    setSuccess(null);
    if (!email.trim() || !password) {
      setError("Email and password required.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${pbxUrl()}/api/v1/auth/login-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await r.json();

      if (r.status === 202 && data.pending_approval) {
        setSuccess(data.message || `Your organisation "${data.org_name}" is awaiting admin approval.`);
        setLoading(false);
        return;
      }
      if (!r.ok) {
        throw new Error(data.error || "Login failed");
      }
      if (data.requires_org_request) {
        setOrgRequestToken(data.token);
        setOrgRequestEmail(email.trim());
        setShowOrgRequest(true);
        setLoading(false);
        return;
      }
      if (!data.user?.org_id) {
        setError("This account isn't linked to an organisation yet.");
        setLoading(false);
        return;
      }
      persistOrgSession(data.token, data.user);
      router.push(`/dashboard/${data.user.org_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleOrgSignUp() {
    setError(null);
    setSuccess(null);
    if (!email.trim() || !password) {
      setError("Email and password required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${pbxUrl()}/api/v1/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim() || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error || "Sign up failed");
      }
      // Account created. Now collect organisation details so the admin
      // can approve. The signup response includes a short-lived
      // onboarding JWT that authenticates /auth/request-org.
      setOrgRequestToken(data.token);
      setOrgRequestEmail(email.trim());
      setShowOrgRequest(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleOrgRequest() {
    setError(null);
    setSuccess(null);
    if (!orgReq.name.trim()) { setError("Organisation name is required"); return; }
    if (!orgReq.phone.trim()) { setError("Phone number is required"); return; }
    if (!orgReq.industry) { setError("Please select your industry"); return; }
    setLoading(true);
    try {
      const r = await fetch(`${pbxUrl()}/api/v1/auth/request-org`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${orgRequestToken}`,
        },
        body: JSON.stringify({
          org_name: orgReq.name.trim(),
          contact_email: orgRequestEmail,
          contact_phone: orgReq.phone.trim(),
          industry: orgReq.industry,
          address: orgReq.address || undefined,
          company_size: orgReq.company_size || undefined,
          expected_users: orgReq.expected_users || undefined,
          description: orgReq.description || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error || "Request failed");
      }
      setSuccess(data.message || "Your organisation has been requested. An admin will approve it shortly.");
      // Drop them back to the sign-in view; they can come back once
      // approval lands.
      setShowOrgRequest(false);
      setIsSignUp(false);
      setPassword("");
      setOrgRequestToken("");
      setOrgReq({ name: "", phone: "", address: "", industry: "", company_size: "", expected_users: "", description: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminLogin() {
    setError(null);
    if (!adminEmail.trim() || !adminPassword) {
      setError("Email and password required.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${pbxUrl()}/api/v1/auth/admin-login-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail.trim(), password: adminPassword }),
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error || "Admin login failed");
      }
      persistAdminSession(data.admin_key || data.token);
      // Stash the JWT separately so the admin-org list call can use it
      if (typeof window !== "undefined") {
        localStorage.setItem("admin_jwt", data.token);
      }
      setAdminAuthenticated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Admin login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnterOrg(orgId: string) {
    setError(null);
    try {
      const jwt = readAdminJwt();
      if (!jwt) {
        handleAdminLogout();
        return;
      }
      const r = await fetch(`${pbxUrl()}/api/v1/admin/impersonate/${orgId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error || "Failed to enter organisation");
      }
      persistOrgSession(data.token, data.user);
      router.push(`/dashboard/${orgId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enter organisation");
    }
  }

  async function handleApproveOrg(orgId: string) {
    await adminMutate("POST", `/api/v1/admin/approve-org/${orgId}`, "Approve failed");
  }

  async function handleSuspendOrg(orgId: string, orgName: string) {
    if (!confirm(`Suspend "${orgName}"? Users in this org will be unable to log in until you reactivate.`)) return;
    await adminMutate("POST", `/api/v1/admin/orgs/${orgId}/suspend`, "Suspend failed");
  }

  async function handleReactivateOrg(orgId: string) {
    await adminMutate("POST", `/api/v1/admin/orgs/${orgId}/reactivate`, "Reactivate failed");
  }

  async function handleDeleteOrg(orgId: string, orgName: string) {
    const ok = confirm(
      `Permanently mark "${orgName}" as deleted? This hides the org from the admin list. Historical call records and tickets stay in the database. This action cannot be undone from the UI.`,
    );
    if (!ok) return;
    await adminMutate("DELETE", `/api/v1/admin/orgs/${orgId}`, "Delete failed");
  }

  // Shared admin-mutation runner: bearer auth, error handling, reload-orgs
  // on success. Keeps the approve/suspend/reactivate/delete handlers thin.
  async function adminMutate(method: "POST" | "DELETE", path: string, errLabel: string) {
    setOrgLoadError(null);
    try {
      const jwt = readAdminJwt();
      if (!jwt) {
        handleAdminLogout();
        return;
      }
      const r = await fetch(`${pbxUrl()}${path}`, {
        method,
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      await loadOrgs();
    } catch (e) {
      setOrgLoadError(e instanceof Error ? e.message : errLabel);
    }
  }

  function handleAdminLogout() {
    if (typeof window !== "undefined") {
      localStorage.removeItem("gateway_admin_key");
      localStorage.removeItem("admin_key");
      localStorage.removeItem("admin_session_start");
      localStorage.removeItem("admin_jwt");
      localStorage.removeItem("org_access");
    }
    setAdminAuthenticated(false);
    setOrgList([]);
    setAdminEmail("");
    setAdminPassword("");
  }

  // ────────────────────────────────────────────────────────────────────
  // Admin org-list view (after Admin tab sign-in)
  // ────────────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────────
  // Request-org view — shown after signup or after login-of-orphan-user.
  // ────────────────────────────────────────────────────────────────────
  if (showOrgRequest) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-lg space-y-6 p-8">
          <div className="text-center space-y-2">
            <div className="flex items-end justify-center gap-1">
              <span className="font-semibold text-2xl tracking-tight">Astradial</span>
              <div className="pb-2 w-1.5 h-1.5 bg-foreground" />
            </div>
            <h1 className="text-2xl font-semibold">Set Up Your Organisation</h1>
            <p className="text-sm text-muted-foreground">
              Tell us about your business to get started. An admin will review and approve.
            </p>
          </div>
          {error ? <p className="text-sm text-destructive text-center">{error}</p> : null}
          {success ? <p className="text-sm text-green-600 text-center">{success}</p> : null}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Organisation Name *</Label>
                <Input value={orgReq.name} onChange={(e) => setOrgReq({ ...orgReq, name: e.target.value })} placeholder="Acme Corp" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone *</Label>
                <Input value={orgReq.phone} onChange={(e) => setOrgReq({ ...orgReq, phone: e.target.value })} placeholder="+91 98765 43210" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={orgRequestEmail} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={orgReq.address} onChange={(e) => setOrgReq({ ...orgReq, address: e.target.value })} placeholder="City, State" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Industry *</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={orgReq.industry}
                  onChange={(e) => setOrgReq({ ...orgReq, industry: e.target.value })}
                >
                  <option value="">Select industry</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Hospitality">Hospitality</option>
                  <option value="Technology">Technology</option>
                  <option value="Real Estate">Real Estate</option>
                  <option value="Education">Education</option>
                  <option value="Financial Services">Financial Services</option>
                  <option value="Retail">Retail</option>
                  <option value="Manufacturing">Manufacturing</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Company Size</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={orgReq.company_size}
                  onChange={(e) => setOrgReq({ ...orgReq, company_size: e.target.value })}
                >
                  <option value="">Select size</option>
                  <option value="1-10">1-10 employees</option>
                  <option value="11-50">11-50 employees</option>
                  <option value="51-200">51-200 employees</option>
                  <option value="201-500">201-500 employees</option>
                  <option value="500+">500+ employees</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Expected Users <span className="text-muted-foreground">(how many people will use the phone system)</span></Label>
              <Input value={orgReq.expected_users} onChange={(e) => setOrgReq({ ...orgReq, expected_users: e.target.value })} placeholder="e.g. 5, 20, 50" />
            </div>
            <div className="space-y-1.5">
              <Label>Tell us what you need</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
                value={orgReq.description}
                onChange={(e) => setOrgReq({ ...orgReq, description: e.target.value })}
                placeholder="e.g. We need a phone system for our hotel front desk with 3 lines and call recording..."
              />
            </div>
            <Button className="w-full" onClick={handleOrgRequest} disabled={loading}>
              {loading ? "Submitting..." : "Submit Application"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setShowOrgRequest(false);
                setError(null);
                setSuccess(null);
              }}
            >
              Back to Sign In
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (adminAuthenticated) {
    const pendingOrgs = orgList.filter((o) => o.status === "pending");
    const activeOrgs = orgList.filter((o) => o.status === "active" || (o.status === undefined && o.is_active !== false));
    const suspendedOrgs = orgList.filter((o) => o.status === "suspended");

    return (
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <div className="flex items-end">
              <span className="font-semibold text-2xl tracking-tight">Astradial</span>
              <div className="ml-1.5 pb-2 w-1.5 h-1.5 bg-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <Link href="/editor">
                <Button variant="outline" size="sm">Flow Editor</Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleAdminLogout}>
                Logout
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">
          {orgLoadError ? (
            <p className="text-sm text-destructive mb-4">{orgLoadError}</p>
          ) : null}

          {pendingOrgs.length > 0 ? (
            <div className="mb-6">
              <h2 className="text-lg font-medium mb-2">
                Pending Approvals <Badge variant="secondary">{pendingOrgs.length}</Badge>
              </h2>
              <div className="space-y-2">
                {pendingOrgs.map((org) => {
                  const ci = org.contact_info || null;
                  return (
                    <div key={org.id} className="rounded-md border border-dashed px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{org.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{org.id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Pending</Badge>
                          <Link href={`/admin/organizations/${org.id}`}>
                            <Button variant="outline" size="sm">Edit</Button>
                          </Link>
                          <Button size="sm" onClick={() => handleApproveOrg(org.id)}>Approve</Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeleteOrg(org.id, org.name)}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                      {ci ? (
                        <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                          {ci.email ? <div><span className="font-medium text-foreground">Email:</span> {ci.email}</div> : null}
                          {ci.phone ? <div><span className="font-medium text-foreground">Phone:</span> {ci.phone}</div> : null}
                          {ci.industry ? <div><span className="font-medium text-foreground">Industry:</span> {ci.industry}</div> : null}
                          {ci.company_size ? <div><span className="font-medium text-foreground">Size:</span> {ci.company_size}</div> : null}
                          {ci.address ? <div><span className="font-medium text-foreground">Address:</span> {ci.address}</div> : null}
                          {ci.expected_users ? <div><span className="font-medium text-foreground">Users:</span> {ci.expected_users}</div> : null}
                          {ci.description ? <div className="col-span-4"><span className="font-medium text-foreground">Need:</span> {ci.description}</div> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Organisations</h2>
            <div className="flex items-center gap-2">
              <Link href="/admin/dids">
                <Button variant="outline" size="sm">DID Management</Button>
              </Link>
              <Link href="/admin/organizations/new">
                <Button size="sm">+ Create Organisation</Button>
              </Link>
            </div>
          </div>

          {activeOrgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No organisations yet. Click <strong>+ Create Organisation</strong>, or
              use the Organisation tab on the sign-in screen to self-serve.
            </p>
          ) : (
            <div className="space-y-1">
              {activeOrgs.map((org) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => handleEnterOrg(org.id)}
                    className="flex-1 text-left"
                  >
                    <p className="text-sm font-medium">{org.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{org.id}</p>
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge variant="default">Active</Badge>
                    <Link href={`/admin/organizations/${org.id}`}>
                      <Button variant="outline" size="sm">Edit</Button>
                    </Link>
                    <Button variant="outline" size="sm" onClick={() => handleEnterOrg(org.id)}>
                      Enter
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSuspendOrg(org.id, org.name)}
                    >
                      Suspend
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteOrg(org.id, org.name)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {suspendedOrgs.length > 0 ? (
            <div className="mt-8">
              <h2 className="text-lg font-medium mb-2">
                Suspended <Badge variant="secondary">{suspendedOrgs.length}</Badge>
              </h2>
              <div className="space-y-1">
                {suspendedOrgs.map((org) => (
                  <div
                    key={org.id}
                    className="flex items-center justify-between rounded-md border border-dashed px-4 py-3 opacity-75"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium">{org.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{org.id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Suspended</Badge>
                      <Button size="sm" onClick={() => handleReactivateOrg(org.id)}>
                        Reactivate
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteOrg(org.id, org.name)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </main>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Sign-in / sign-up form (default view)
  // ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen">
      {/* Left panel — hero image + testimonial. Hidden on mobile so the
          form gets the full width. */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-foreground text-background p-10 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/image.webp')" }}
      >
        <div className="flex items-center gap-2 drop-shadow-[0_0_13px_rgba(0,0,0,0.9)]">
          <a href="/" className="logo-link">
            <div className="flex items-end">
              <span className="font-semibold text-2xl tracking-tight text-white whitespace-nowrap">
                Astradial
              </span>
              <div className="ml-1.5 pb-2 w-1.5 h-1.5 bg-white" />
            </div>
          </a>
        </div>
        <blockquote className="space-y-2 drop-shadow-2xl">
          <p className="text-lg text-white">
            &ldquo;Astradial has transformed how we manage our hotel communications.
            The AI voice bots handle guest calls seamlessly.&rdquo;
          </p>
          <footer className="text-sm opacity-90 text-white font-medium">
            Operations Manager, Abint Palace
          </footer>
        </blockquote>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col space-y-2 text-center">
            <div className="lg:hidden flex items-end justify-center gap-1 mb-4">
              <span className="font-semibold text-2xl tracking-tight">Astradial</span>
              <div className="pb-2 w-1.5 h-1.5 bg-foreground" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {isSignUp ? "Create Account" : "Sign In"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isSignUp ? "Create your account to get started" : "Access your dashboard"}
            </p>
          </div>

          <Tabs value={tab} onValueChange={(v) => { setTab(v as "org" | "admin"); setError(null); setSuccess(null); }} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="org">Organisation</TabsTrigger>
              <TabsTrigger value="admin">Admin</TabsTrigger>
            </TabsList>

            {/* Organisation tab */}
            <TabsContent value="org" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (isSignUp ? handleOrgSignUp() : handleOrgLogin())}
                  autoComplete={isSignUp ? "email" : "username"}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                    placeholder={isSignUp ? "Create a password (min 6 chars)" : "Enter password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (isSignUp ? handleOrgSignUp() : handleOrgLogin())}
                    className="pr-10"
                    disabled={loading}
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
              {isSignUp ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name">Your name <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                      autoComplete="name"
                      disabled={loading}
                    />
                  </div>
                </>
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {success ? <p className="text-sm text-green-600 dark:text-green-400">{success}</p> : null}
              <Button
                className="w-full"
                onClick={isSignUp ? handleOrgSignUp : handleOrgLogin}
                disabled={loading}
              >
                {loading
                  ? isSignUp ? "Creating account..." : "Signing in..."
                  : isSignUp ? "Create Account" : "Sign In"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {isSignUp ? (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="underline hover:text-foreground"
                      onClick={() => { setIsSignUp(false); setError(null); setSuccess(null); }}
                    >
                      Sign In
                    </button>
                  </>
                ) : (
                  <>
                    Don&apos;t have an account?{" "}
                    <button
                      type="button"
                      className="underline hover:text-foreground"
                      onClick={() => { setIsSignUp(true); setError(null); setSuccess(null); }}
                    >
                      Create Account
                    </button>
                  </>
                )}
              </p>
            </TabsContent>

            {/* Admin tab */}
            <TabsContent value="admin" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="admin-email">Email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  placeholder="admin@astradial.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                  autoComplete="username"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-password">Password</Label>
                <div className="relative">
                  <Input
                    id="admin-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                    className="pr-10"
                    disabled={loading}
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
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button className="w-full" onClick={handleAdminLogin} disabled={loading}>
                {loading ? "Signing in..." : "Sign In as Admin"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Uses the <code>ADMIN_EMAIL</code> + <code>ADMIN_PASSWORD</code> set in the server <code>.env</code>.
              </p>
            </TabsContent>
          </Tabs>

          <p className="px-8 text-center text-xs text-muted-foreground">
            By continuing, you agree to Astradial&apos;s{" "}
            <Link href="/terms" className="underline hover:text-foreground">Terms of Service</Link>
            {" "}and{" "}
            <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
