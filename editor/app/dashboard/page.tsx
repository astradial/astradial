"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAdminKey, orgs, setAdminKey, type Org } from "@/lib/gateway/client";
import { setOrgToken } from "@/lib/pbx/client";
import AstradialLogo from "@/components/icons/AstradialLogo";
import { PasswordInput } from "@/components/ui/password-input";


interface OrgAccess {
  org_id: string;
  org_name: string;
  api_key: string;
  role: string;
}

export default function DashboardPage() {
  // Admin login state
  const [authenticated, setAuthenticated] = useState(false);
  const [orgList, setOrgList] = useState<Org[]>([]);
  const [pendingOrgs, setPendingOrgs] = useState<Org[]>([]);

  // Shared login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgAuth, setOrgAuth] = useState<OrgAccess | null>(null);

  // Admin tab state
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  // Org request state
  const [showOrgRequest, setShowOrgRequest] = useState(false);
  const [orgRequestToken, setOrgRequestToken] = useState("");
  const [orgRequestEmail, setOrgRequestEmail] = useState("");
  const [orgReq, setOrgReq] = useState({ name: "", phone: "", address: "", industry: "", company_size: "", expected_users: "", description: "" });

  // Check for saved sessions
  useEffect(() => {
    const saved = getAdminKey();
    if (saved) {
      setAuthenticated(true);
    }
    const savedOrg = typeof window !== "undefined" ? localStorage.getItem("org_access") : null;
    if (savedOrg) {
      try {
        const parsed = JSON.parse(savedOrg) as OrgAccess;
        setOrgAuth(parsed);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadOrgs();
  }, [authenticated]);

  // Redirect if org login is active
  useEffect(() => {
    if (orgAuth) {
      setOrgToken(orgAuth.api_key); // api_key holds the JWT token
      window.location.href = `/dashboard/${orgAuth.org_id}`;
    }
  }, [orgAuth]);

  async function loadOrgs() {
    try {
      setLoading(true);
      const list = await orgs.list();
      setOrgList(list.filter((o: Org) => o.is_active));
      setPendingOrgs(list.filter((o: Org) => !o.is_active));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orgs");
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveOrg(orgId: string) {
    try {
      const key = getAdminKey();
      const res = await fetch(`/api/pbx/admin/approve-org/${orgId}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}` },
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || "Approve failed"); return; }
      loadOrgs();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  // Admin login — direct API call
  async function handleAdminLogin() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Not authorized as admin");
        setLoading(false);
        return;
      }

      const { admin_key } = await res.json();
      setAdminKey(admin_key);
      setAuthenticated(true);
      setError("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Sign up — direct API call
  async function handleOrgSignUp() {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      if (password.length < 6) { setError("Password must be at least 6 characters"); setLoading(false); return; }
      if (!email.trim()) { setError("Email is required"); setLoading(false); return; }
      const res = await fetch("/api/pbx/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: email.split("@")[0] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || data.detail || "Sign up failed");
        setLoading(false);
        return;
      }
      setSuccess(data.message || "Account created! You can now sign in.");
      setIsSignUp(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign up failed");
    } finally { setLoading(false); }
  }

  // Sign in — direct API call for role JWT
  async function handleOrgLogin() {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await fetch("/api/pbx/auth/user-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 202) {
        // Org exists but pending approval
        const d = await res.json();
        setSuccess(`Your organisation "${d.org_name}" is awaiting admin approval. You'll be able to log in once approved.`);
        setLoading(false);
        return;
      }

      if (res.status === 404) {
        // User has no org — show org request form
        setShowOrgRequest(true);
        setOrgRequestToken(""); // no token needed, API uses email
        setOrgRequestEmail(email);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Login failed" }));
        setError(errData.error || errData.detail || "Login failed");
        setLoading(false);
        return;
      }

      const loginData = await res.json();
      const data: OrgAccess = {
        org_id: loginData.user.org_id,
        org_name: loginData.user.org_name,
        api_key: loginData.token,
        role: loginData.user.role,
      };
      localStorage.setItem("org_access", JSON.stringify(data));
      localStorage.setItem("user_role", loginData.user.role);
      localStorage.setItem("user_permissions", JSON.stringify(loginData.user.permissions));
      setOrgAuth(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Submit org request
  async function handleOrgRequest() {
    if (!orgReq.name.trim()) { setError("Organisation name is required"); return; }
    if (!orgReq.phone.trim()) { setError("Phone number is required"); return; }
    if (!orgReq.industry) { setError("Please select your industry"); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/pbx/auth/request-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: orgRequestEmail,
          org_name: orgReq.name,
          contact_email: orgRequestEmail,
          contact_phone: orgReq.phone,
          industry: orgReq.industry,
          address: orgReq.address,
          company_size: orgReq.company_size,
          expected_users: orgReq.expected_users,
          description: orgReq.description,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Request failed"); setLoading(false); return; }
      setSuccess("Organisation requested! Admin will review and approve shortly. You'll be able to log in once approved.");
      setShowOrgRequest(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setLoading(false); }
  }

  // Org request form (shown after sign-in when no org exists)
  if (showOrgRequest) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-lg space-y-6 p-8">
          <div className="text-center space-y-2">
            <AstradialLogo height={32} color="currentColor" className="mx-auto" />
            <h1 className="text-2xl font-semibold">Set Up Your Organisation</h1>
            <p className="text-sm text-muted-foreground">Tell us about your business to get started</p>
          </div>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          {success && <p className="text-sm text-green-600 text-center">{success}</p>}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Organisation Name *</Label>
                <Input value={orgReq.name} onChange={e => setOrgReq({ ...orgReq, name: e.target.value })} placeholder="Acme Corp" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone *</Label>
                <Input value={orgReq.phone} onChange={e => setOrgReq({ ...orgReq, phone: e.target.value })} placeholder="+91 98765 43210" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={orgRequestEmail} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={orgReq.address} onChange={e => setOrgReq({ ...orgReq, address: e.target.value })} placeholder="City, State" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Industry *</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={orgReq.industry} onChange={e => setOrgReq({ ...orgReq, industry: e.target.value })}>
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
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={orgReq.company_size} onChange={e => setOrgReq({ ...orgReq, company_size: e.target.value })}>
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
              <Label>Expected Users (how many people will use the phone system)</Label>
              <Input value={orgReq.expected_users} onChange={e => setOrgReq({ ...orgReq, expected_users: e.target.value })} placeholder="e.g. 5, 20, 50" />
            </div>
            <div className="space-y-1.5">
              <Label>Tell us what you need</Label>
              <textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground" value={orgReq.description} onChange={e => setOrgReq({ ...orgReq, description: e.target.value })} placeholder="e.g. We need a phone system for our hotel front desk with 3 lines and call recording..." />
            </div>
            <Button className="w-full" onClick={handleOrgRequest} disabled={loading}>
              {loading ? "Submitting..." : "Submit Application"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => { setShowOrgRequest(false); setError(""); }}>Back to Sign In</Button>
          </div>
        </div>
      </div>
    );
  }

  // Org list view (admin)
  if (authenticated) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-2">
              <AstradialLogo height={18} color="currentColor" />
              <h1 className="text-lg font-semibold">Astradial</h1>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/editor">
                <Button variant="outline" size="sm">Flow Editor</Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdminKey("");
                  setAuthenticated(false);
                }}
              >
                Logout
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">
          {error && <p className="text-sm text-destructive mb-4">{error}</p>}
          {/* Pending Org Approvals */}
          {pendingOrgs.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-medium mb-2">Pending Approvals <Badge variant="secondary">{pendingOrgs.length}</Badge></h2>
              <div className="space-y-2">
                {pendingOrgs.map((org) => {
                  const ci = (org as unknown as Record<string, unknown>).contact_info as Record<string, string> | null;
                  return (
                    <div key={org.id} className="rounded-md border border-dashed px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{org.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{org.id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Pending</Badge>
                          <Link href={`/admin/organizations/${org.id}`}><Button variant="outline" size="sm">Edit</Button></Link>
                          <Button size="sm" onClick={() => handleApproveOrg(org.id)}>Approve</Button>
                        </div>
                      </div>
                      {ci && (
                        <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                          {ci.email && <div><span className="font-medium text-foreground">Email:</span> {ci.email}</div>}
                          {ci.phone && <div><span className="font-medium text-foreground">Phone:</span> {ci.phone}</div>}
                          {ci.industry && <div><span className="font-medium text-foreground">Industry:</span> {ci.industry}</div>}
                          {ci.company_size && <div><span className="font-medium text-foreground">Size:</span> {ci.company_size}</div>}
                          {ci.address && <div><span className="font-medium text-foreground">Address:</span> {ci.address}</div>}
                          {ci.expected_users && <div><span className="font-medium text-foreground">Users:</span> {ci.expected_users}</div>}
                          {ci.description && <div className="col-span-4"><span className="font-medium text-foreground">Need:</span> {ci.description}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Organizations</h2>
            <div className="flex items-center gap-2">
              <Link href="/admin/dids">
                <Button variant="outline" size="sm">DID Management</Button>
              </Link>
              <Link href="/admin/organizations/new">
                <Button size="sm">+ Create Organisation</Button>
              </Link>
            </div>
          </div>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : orgList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No organizations found.</p>
          ) : (
            <div className="space-y-1">
              {orgList.map((org) => (
                <div key={org.id} className="flex items-center justify-between rounded-md border px-4 py-3 hover:bg-muted/50 transition-colors">
                  <Link href={`/dashboard/${org.id}`} className="flex-1">
                    <p className="text-sm font-medium">{org.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{org.id}</p>
                  </Link>
                  <div className="flex items-center gap-2">
                    <Badge variant={org.is_active ? "default" : "secondary"}>
                      {org.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Link href={`/admin/organizations/${org.id}`}>
                      <Button variant="outline" size="sm">Edit</Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  // Login page
  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-foreground text-background p-10">
        <div className="flex items-center gap-2">
          <AstradialLogo height={20} color="currentColor" />
          <span className="text-lg font-semibold">Astradial</span>
        </div>
        <blockquote className="space-y-2">
          <p className="text-lg">
            &ldquo;Astradial has transformed how we manage our hotel communications. The AI voice bots handle guest calls seamlessly.&rdquo;
          </p>
          <footer className="text-sm opacity-80">Operations Manager, Abint Palace</footer>
        </blockquote>
      </div>

      {/* Right panel — login form */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col space-y-2 text-center">
            <div className="lg:hidden flex items-center justify-center gap-2 mb-4">
              <AstradialLogo height={24} color="currentColor" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{isSignUp ? "Create Account" : "Sign In"}</h1>
            <p className="text-sm text-muted-foreground">{isSignUp ? "Create your account to get started" : "Access your dashboard"}</p>
          </div>

          <Tabs defaultValue="org" className="w-full">
            {process.env.NEXT_PUBLIC_ASTRADIAL_MODE !== "cloud" && (
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="org">Organisation</TabsTrigger>
                <TabsTrigger value="admin">Admin</TabsTrigger>
              </TabsList>
            )}

            {/* Organisation Login */}
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  placeholder={isSignUp ? "Create a password (min 6 chars)" : "Enter password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (isSignUp ? handleOrgSignUp() : handleOrgLogin())}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}
              <Button className="w-full" onClick={isSignUp ? handleOrgSignUp : handleOrgLogin} disabled={loading}>
                {loading ? (isSignUp ? "Creating account..." : "Signing in...") : (isSignUp ? "Create Account" : "Sign In")}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {isSignUp ? (
                  <>Already have an account?{" "}<button type="button" className="underline hover:text-foreground" onClick={() => { setIsSignUp(false); setError(""); setSuccess(""); }}>Sign In</button></>
                ) : (
                  <>Don&apos;t have an account?{" "}<button type="button" className="underline hover:text-foreground" onClick={() => { setIsSignUp(true); setError(""); setSuccess(""); }}>Create Account</button></>
                )}
              </p>
            </TabsContent>

            {/* Admin Login — only shown in self-hosted mode */}
            {process.env.NEXT_PUBLIC_ASTRADIAL_MODE !== "cloud" && (
              <TabsContent value="admin" className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="admin-email">Email</Label>
                  <Input id="admin-email" type="email" placeholder="admin@example.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password">Password</Label>
                  <Input id="admin-password" type="password" placeholder="Enter password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()} />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button className="w-full" onClick={handleAdminLogin} disabled={loading}>
                  {loading ? "Signing in..." : "Sign In as Admin"}
                </Button>
              </TabsContent>
            )}
          </Tabs>

          <p className="px-8 text-center text-xs text-muted-foreground">
            By continuing, you agree to Astradial&apos;s Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
