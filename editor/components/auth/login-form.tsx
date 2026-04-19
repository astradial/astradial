"use client";

import { useState } from "react";
import AstradialLogo from "@/components/icons/AstradialLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setAdminKey } from "@/lib/gateway/client";

interface LoginFormProps {
  onAdminAuthenticated: () => void;
  onRequireOrgSetup: (email: string) => void;
  onUserAuthenticated: (data: any) => void;
}

export function LoginForm({ onAdminAuthenticated, onRequireOrgSetup, onUserAuthenticated }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

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
        const d = await res.json();
        setSuccess(`Your organisation "${d.org_name}" is awaiting admin approval. You'll be able to log in once approved.`);
        setLoading(false);
        return;
      }

      if (res.status === 404) {
        onRequireOrgSetup(email);
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
      const data = {
        org_id: loginData.user.org_id,
        org_name: loginData.user.org_name,
        api_key: loginData.token,
        role: loginData.user.role,
      };
      localStorage.setItem("org_access", JSON.stringify(data));
      localStorage.setItem("user_role", loginData.user.role);
      localStorage.setItem("user_permissions", JSON.stringify(loginData.user.permissions));
      onUserAuthenticated(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

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
      onAdminAuthenticated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-foreground text-background p-10 bg-cover bg-center" style={{ backgroundImage: "url('/images/image.png')" }}>
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
      <div className="flex flex-1 items-center justify-center p-8 bg-background">
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
                <Input
                  id="password"
                  type="password"
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
