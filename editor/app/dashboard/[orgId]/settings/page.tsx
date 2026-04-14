"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, RefreshCw, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { showToast } from "@/components/ui/Toast";
import { orgs as gwOrgs, setAdminKey, type Org } from "@/lib/gateway/client";
import { config as pbxConfig, orgs as pbxOrgs, type PbxOrg } from "@/lib/pbx/client";

export default function SettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<Org | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    // Try PBX API first (works with JWT), then gateway, then session fallback
    pbxOrgs.get(orgId)
      .then((o: PbxOrg) => setOrg({ id: o.id, name: o.name, is_active: o.status === "active", created_at: o.createdAt || "", updated_at: "" }))
      .catch(() => gwOrgs.get(orgId).then(setOrg).catch(() => {}));
  }, [orgId]);

  async function handleDeploy() {
    setDeploying(true);
    try {
      await pbxConfig.deploy();
      showToast("Configuration deployed to Asterisk", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Deploy failed", "error");
    } finally {
      setDeploying(false);
    }
  }

  async function handleReload() {
    setReloading(true);
    try {
      await pbxConfig.reload();
      showToast("Asterisk configuration reloaded", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Reload failed", "error");
    } finally {
      setReloading(false);
    }
  }

  function handleLogout() {
    setAdminKey("");
    if (typeof window !== "undefined") {
      localStorage.removeItem("gateway_admin_key");
      localStorage.removeItem("pbx_api_key");
      localStorage.removeItem("org_access");
    }
    router.push("/dashboard");
  }

  return (
    <div className="p-3 md:p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Organization settings and configuration</p>
      </div>

      {/* Org Info */}
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>Your organization details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {org ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{org.name}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Organization ID</span>
                <span className="font-mono text-xs">{org.id}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={org.is_active ? "default" : "destructive"}>{org.is_active ? "Active" : "Inactive"}</Badge>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{org.created_at ? new Date(org.created_at).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—"}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
        </CardContent>
      </Card>

      {/* Asterisk Config */}
      <Card>
        <CardHeader>
          <CardTitle>Asterisk Configuration</CardTitle>
          <CardDescription>Deploy and reload PBX configuration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleDeploy} disabled={deploying}>
              <Upload className="h-4 w-4 mr-1.5" />
              {deploying ? "Deploying..." : "Deploy Config"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleReload} disabled={reloading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${reloading ? "animate-spin" : ""}`} />
              {reloading ? "Reloading..." : "Reload Asterisk"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Deploy generates PJSIP and dialplan config files. Reload applies changes without dropping active calls.
          </p>
        </CardContent>
      </Card>

      {/* Logout */}
      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>Manage your admin session</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-1.5" />
            Logout
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
