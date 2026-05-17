"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Eye, EyeOff, MessageCircle, Send } from "lucide-react";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut } from "firebase/auth";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { showToast } from "@/components/ui/Toast";
import { getAdminKey, orgs, setAdminKey, type Org } from "@/lib/gateway/client";
import { setOrgToken, adminWhatsapp, type AdminWhatsappConfig, type Msg91Template } from "@/lib/pbx/client";
import { auth } from "@/lib/firebase/config";
import { USE_FIREBASE } from "@/lib/auth";
import { markAdminSessionStart } from "@/lib/auth/authStore";
import { OssLoginForm } from "@/components/auth/OssLoginForm";
import AstradialLogo from "@/components/icons/AstradialLogo";

interface OrgAccess {
  org_id: string;
  org_name: string;
  api_key: string;
  role: string;
  email?: string;
  name?: string;
  user_id?: string;
  impersonating?: boolean;
}

export default function DashboardPage() {
  // OSS local mode: skip the Firebase-based login UI entirely and render
  // the OSS api_key/api_secret form. The rest of this component is
  // Firebase-specific (admin login, user login, signup, org request)
  // and only renders when USE_FIREBASE is true.
  if (!USE_FIREBASE) {
    return <OssLoginForm />;
  }

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
  const [showPassword, setShowPassword] = useState(false);

  // Org request state
  const [showOrgRequest, setShowOrgRequest] = useState(false);
  const [orgRequestToken, setOrgRequestToken] = useState("");
  const [orgRequestEmail, setOrgRequestEmail] = useState("");
  const [orgReq, setOrgReq] = useState({ name: "", phone: "", address: "", industry: "", company_size: "", expected_users: "", description: "" });

  // Admin MSG91 WhatsApp config (Astradial-side, sends to customer orgs)
  const [waAdminOpen, setWaAdminOpen] = useState(false);
  const [waAdminCfg, setWaAdminCfg] = useState<AdminWhatsappConfig | null>(null);
  const [waAdminTemplates, setWaAdminTemplates] = useState<Msg91Template[]>([]);
  const [waAdminSaving, setWaAdminSaving] = useState(false);
  const [waAdminTesting, setWaAdminTesting] = useState(false);
  const [waTestPhone, setWaTestPhone] = useState("");
  const [waTestName, setWaTestName] = useState("Hari");
  const [waTestCount, setWaTestCount] = useState("3");

  // Check for saved sessions. If admin is also signed in, prefer the admin
  // org list view (so "Switch Organisation" actually lands here instead of
  // bouncing back into the impersonated dashboard).
  useEffect(() => {
    const saved = getAdminKey();
    if (saved) {
      setAuthenticated(true);
      return;
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

  async function handleEnterOrg(orgId: string, orgName: string) {
    setError("");
    try {
      const res = await fetch(`/api/admin/impersonate/${orgId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to enter org");
        return;
      }
      const access: OrgAccess = {
        org_id: data.user.org_id,
        org_name: data.user.org_name || orgName,
        api_key: data.token,
        role: data.user.role,
        email: data.user.email,
        name: data.user.name,
        user_id: data.user.id,
        impersonating: true,
      };
      localStorage.setItem("org_access", JSON.stringify(access));
      localStorage.setItem("user_role", data.user.role);
      localStorage.setItem("user_permissions", JSON.stringify(data.user.permissions || []));
      setOrgToken(data.token);
      window.location.href = `/dashboard/${orgId}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enter org");
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

  // Admin MSG91 WhatsApp config — opens the side panel and loads current
  // singleton config + the list of approved templates from MSG91.
  async function openWaAdminPanel() {
    setWaAdminOpen(true);
    try {
      const cfg = await adminWhatsapp.getConfig();
      setWaAdminCfg(cfg);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load WhatsApp config", "error");
    }
    try {
      const res = await adminWhatsapp.listTemplates();
      setWaAdminTemplates(res.templates);
    } catch (e) {
      // Don't block the panel — admin can still edit + save by typing the
      // template name manually if MSG91 is slow / down. Show a soft toast.
      showToast(e instanceof Error ? e.message : "Could not fetch MSG91 templates", "error");
    }
  }

  function patchWaAdminLocal(patch: Partial<AdminWhatsappConfig>) {
    setWaAdminCfg((c) => (c ? { ...c, ...patch } : c));
  }

  async function handleSaveWaAdmin() {
    if (!waAdminCfg) return;
    setWaAdminSaving(true);
    try {
      const saved = await adminWhatsapp.setConfig({
        integrated_number: waAdminCfg.integrated_number,
        namespace: waAdminCfg.namespace,
        selected_template_name: waAdminCfg.selected_template_name,
        template_language: waAdminCfg.template_language || "en",
      });
      setWaAdminCfg(saved);
      showToast("WhatsApp config saved", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setWaAdminSaving(false);
    }
  }

  async function handleWaAdminTestSend() {
    const phone = waTestPhone.trim();
    if (!/^\d{10,15}$/.test(phone)) {
      showToast("Phone must be E.164 without +, 10-15 digits (e.g. 919876543210)", "error");
      return;
    }
    setWaAdminTesting(true);
    try {
      const count = Number.parseInt(waTestCount, 10);
      const res = await adminWhatsapp.testSend({
        phone,
        sample_subscriber_name: waTestName || "Test",
        sample_count: Number.isFinite(count) ? count : 0,
      });
      if (res.ok) showToast("Test message queued by MSG91", "success");
      else showToast("MSG91 rejected the test send", "error");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Test send failed", "error");
    } finally {
      setWaAdminTesting(false);
    }
  }

  // Admin Firebase login
  async function handleAdminLogin() {
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, adminEmail, adminPassword);

      // Get gateway admin key from server
      const res = await fetch("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Not authorized as admin");
        setLoading(false);
        return;
      }

      const { admin_key } = await res.json();
      setAdminKey(admin_key);
      markAdminSessionStart();
      setAuthenticated(true);
      setError("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      if (msg.includes("invalid-credential") || msg.includes("wrong-password")) {
        setError("Invalid email or password");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  // Sign up — create Firebase account + send verification email
  async function handleOrgSignUp() {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      if (password.length < 6) { setError("Password must be at least 6 characters"); setLoading(false); return; }
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(cred.user);
      setSuccess("Account created! Check your email to verify, then sign in.");
      setIsSignUp(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign up failed";
      if (msg.includes("email-already-in-use")) setError("An account with this email already exists. Try signing in.");
      else if (msg.includes("weak-password")) setError("Password is too weak. Use at least 6 characters.");
      else if (msg.includes("invalid-email")) setError("Invalid email address.");
      else setError(msg);
    } finally { setLoading(false); }
  }

  // Sign in — Firebase auth → get ID token → call user-login for role JWT
  async function handleOrgLogin() {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Check email verification
      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user);
        setError("Please verify your email first. A new verification link has been sent.");
        setLoading(false);
        return;
      }

      // Get Firebase ID token
      const idToken = await cred.user.getIdToken();

      // Call user-login endpoint with Firebase token
      const res = await fetch("/api/pbx/auth/user-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firebase_token: idToken }),
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
        setOrgRequestToken(idToken);
        setOrgRequestEmail(cred.user.email || "");
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
        email: loginData.user.email,
        name: loginData.user.name,
        user_id: loginData.user.id,
      };
      localStorage.setItem("org_access", JSON.stringify(data));
      localStorage.setItem("user_role", loginData.user.role);
      localStorage.setItem("user_permissions", JSON.stringify(loginData.user.permissions));
      setOrgAuth(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      if (msg.includes("invalid-credential") || msg.includes("wrong-password")) {
        setError("Invalid email or password");
      } else if (msg.includes("user-not-found")) {
        setError("No account found with this email. Create an account first.");
        setIsSignUp(true);
      } else {
        setError(msg);
      }
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
          firebase_token: orgRequestToken,
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
              <Button variant="outline" size="sm" className="gap-1.5" onClick={openWaAdminPanel}>
                <MessageCircle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">WhatsApp</span>
              </Button>
              <Link href="/editor">
                <Button variant="outline" size="sm">Flow Editor</Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdminKey("");
                  if (typeof window !== "undefined") {
                    localStorage.removeItem("gateway_admin_key");
                    localStorage.removeItem("admin_key");
                    localStorage.removeItem("admin_session_start");
                    localStorage.removeItem("org_access");
                  }
                  signOut(auth).catch((err) => console.warn("[admin-logout] firebase signOut failed:", err?.code));
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
                  <button
                    type="button"
                    onClick={() => handleEnterOrg(org.id, org.name)}
                    className="flex-1 text-left"
                  >
                    <p className="text-sm font-medium">{org.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{org.id}</p>
                  </button>
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

        {/* Admin WhatsApp config panel — Astradial-side MSG91 used by the
            daily 6 PM IST missed-call alert scheduler. Browser sends its
            gateway_admin_key; the editor's /api/admin/whatsapp proxy
            swaps it for INTERNAL_API_KEY before calling PBX. */}
        <Sheet open={waAdminOpen} onOpenChange={setWaAdminOpen}>
          <SheetContent className="overflow-y-auto sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>WhatsApp (Astradial MSG91)</SheetTitle>
              <SheetDescription>
                Configure the MSG91 WhatsApp account used by the daily 18:00 IST scheduler to send
                missed-call alerts to subscribers across every org with alerts enabled.
              </SheetDescription>
            </SheetHeader>

            {!waAdminCfg ? (
              <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="space-y-5 mt-4">
                {/* Readiness summary */}
                <div className="rounded-md border p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Auth key (env)</span>
                    <span className={waAdminCfg.auth_key_present ? "text-green-600" : "text-destructive"}>
                      {waAdminCfg.auth_key_present ? "present" : "MSG91_ADMIN_AUTH_KEY missing in env"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ready to send</span>
                    <span className={waAdminCfg.is_ready_for_send ? "text-green-600" : "text-amber-600"}>
                      {waAdminCfg.is_ready_for_send ? "yes" : "complete the fields below"}
                    </span>
                  </div>
                </div>

                {/* Editable fields */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Integrated Number</Label>
                  <Input
                    value={waAdminCfg.integrated_number || ""}
                    onChange={(e) => patchWaAdminLocal({ integrated_number: e.target.value })}
                    placeholder="15558897024"
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Template Namespace</Label>
                  <Input
                    value={waAdminCfg.namespace || ""}
                    onChange={(e) => patchWaAdminLocal({ namespace: e.target.value })}
                    placeholder="ab7728b6_9e3c_4160_b51e_958e57f151e0"
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Template</Label>
                  {waAdminTemplates.length > 0 ? (
                    <Select
                      value={waAdminCfg.selected_template_name || ""}
                      onValueChange={(v) => patchWaAdminLocal({ selected_template_name: v })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose a template" /></SelectTrigger>
                      <SelectContent>
                        {waAdminTemplates.map((t) => (
                          <SelectItem key={t.name} value={t.name}>
                            {t.name} {t.language ? `(${t.language})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={waAdminCfg.selected_template_name || ""}
                      onChange={(e) => patchWaAdminLocal({ selected_template_name: e.target.value })}
                      placeholder="missed_calls_alert"
                      className="h-8 text-xs font-mono"
                    />
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {waAdminTemplates.length > 0
                      ? `${waAdminTemplates.length} approved template${waAdminTemplates.length === 1 ? "" : "s"} fetched from MSG91`
                      : "Couldn't fetch template list — type the template name manually"}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Language</Label>
                  <Input
                    value={waAdminCfg.template_language || "en"}
                    onChange={(e) => patchWaAdminLocal({ template_language: e.target.value })}
                    placeholder="en"
                    className="h-8 text-xs font-mono w-24"
                  />
                </div>

                <Button onClick={handleSaveWaAdmin} disabled={waAdminSaving} className="w-full">
                  {waAdminSaving ? "Saving…" : "Save Configuration"}
                </Button>

                <Separator />

                {/* Test Send */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Test Send</Label>
                  <p className="text-xs text-muted-foreground">
                    Fires the configured template to a single phone right now with sample variables.
                    Useful for verifying config without waiting for the 18:00 IST cron tick.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Phone (E.164 no +)</Label>
                      <Input
                        value={waTestPhone}
                        onChange={(e) => setWaTestPhone(e.target.value.replace(/\D/g, ""))}
                        placeholder="919876543210"
                        className="h-8 text-xs font-mono"
                        inputMode="numeric"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Sample Count</Label>
                      <Input
                        value={waTestCount}
                        onChange={(e) => setWaTestCount(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        placeholder="3"
                        className="h-8 text-xs"
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Sample Name</Label>
                    <Input
                      value={waTestName}
                      onChange={(e) => setWaTestName(e.target.value.slice(0, 120))}
                      placeholder="Hari"
                      className="h-8 text-xs"
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="w-full gap-1.5"
                    onClick={handleWaAdminTestSend}
                    disabled={waAdminTesting || !waAdminCfg.is_ready_for_send}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {waAdminTesting ? "Sending…" : "Send Test Message"}
                  </Button>
                  {!waAdminCfg.is_ready_for_send && (
                    <p className="text-[10px] text-amber-600">
                      Complete the config above first — test send requires integrated number, namespace, and template.
                    </p>
                  )}
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  // Login page
  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-foreground text-background p-10 bg-cover bg-center" style={{ backgroundImage: "url('/images/image.webp')" }}>
        <div className="flex items-center gap-2 drop-shadow-[0_0_13px_rgba(0,0,0,0.9)]">
          <div className="logo">
            <a href="/" className="logo-link">
              <div className="flex items-end">
                <span className="font-[600] text-[24px] tracking-[-1.2px] text-[white] whitespace-nowrap overflow-hidden">Astradial</span>
                <div className="ml-[6px] pb-[8px]">
                  <div className="w-[5px] h-[5px] bg-[white]"></div>
                </div>
              </div>
            </a>
          </div>
        </div>
        <blockquote className="space-y-2 drop-shadow-2xl">
          <p className="text-lg text-white">
            &ldquo;Astradial has transformed how we manage our hotel communications. The AI voice bots handle guest calls seamlessly.&rdquo;
          </p>
          <footer className="text-sm opacity-90 text-white font-medium">Operations Manager, Abint Palace</footer>
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
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="org">Organisation</TabsTrigger>
              <TabsTrigger value="admin">Admin</TabsTrigger>
            </TabsList>

            {/* Organisation Login — Firebase */}
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

            {/* Admin Login — Firebase */}
            <TabsContent value="admin" className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="admin-email">Email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  placeholder="admin@example.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-password">Password</Label>
                <div className="relative">
                  <Input
                    id="admin-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Enter password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdminLogin()}
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
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={handleAdminLogin} disabled={loading}>
                {loading ? "Signing in..." : "Sign In as Admin"}
              </Button>
            </TabsContent>
          </Tabs>

          <p className="px-8 text-center text-xs text-muted-foreground">
            By continuing, you agree to Astradial&apos;s Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}
