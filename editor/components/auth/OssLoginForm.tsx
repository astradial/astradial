"use client";

/**
 * OSS local login form — used when NEXT_PUBLIC_USE_FIREBASE is not "true".
 *
 * Authenticates against the API's existing /api/v1/auth/login endpoint
 * (api_key + api_secret → JWT, bcrypt-verified server-side). No Firebase
 * project required.
 *
 * To onboard a fresh OSS deployment:
 *   1. Run setup.sh, which provisions a default org and prints its
 *      api_key + api_secret.
 *   2. Paste those into this form to log in.
 *   3. Save them somewhere — they unlock all subsequent admin access
 *      until you rotate them via the editor admin or API.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth as authProvider } from "@/lib/auth";
import { markAdminSessionStart } from "@/lib/auth/authStore";

export function OssLoginForm() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!apiKey.trim() || !apiSecret.trim()) {
      setError("Both fields required.");
      return;
    }
    setLoading(true);
    try {
      const result = await authProvider.signIn({
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
      });
      if (!result.token) {
        throw new Error("Auth succeeded but no token returned");
      }
      // Mirror the localStorage shape the editor's API clients expect.
      if (typeof window !== "undefined") {
        localStorage.setItem("pbx_org_token", result.token);
        if (result.user.orgId) {
          localStorage.setItem("pbx_api_key", apiKey.trim());
          localStorage.setItem(
            "org_access",
            JSON.stringify({
              org_id: result.user.orgId,
              org_name: result.user.orgName || "",
              role: result.user.role || "admin",
              source: "oss-local",
            })
          );
        }
        markAdminSessionStart();
      }
      // Redirect to the org dashboard
      if (result.user.orgId) {
        router.push(`/dashboard/${result.user.orgId}`);
      } else {
        router.push("/dashboard");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Astradial — OSS Login</CardTitle>
          <CardDescription>
            Sign in with your organisation&apos;s API key and secret. New to this instance? Run{" "}
            <code className="text-xs">setup.sh</code> to provision a default org and print its
            credentials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">API key</Label>
              <Input
                id="api-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="org_xxxxxxxxxxxxxxxx"
                autoComplete="username"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-secret">API secret</Label>
              <Input
                id="api-secret"
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="paste the secret you saved at org creation"
                autoComplete="current-password"
                disabled={loading}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Want Firebase / Google sign-in instead? Set <code>NEXT_PUBLIC_USE_FIREBASE=true</code>{" "}
              and provide the firebase env vars in <code>.env</code>.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
