"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExternalLink, LogOut, RefreshCw, Upload } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CampaignSettingsPanel } from "@/components/campaigns/CampaignSettingsPanel";
import { showToast } from "@/components/ui/Toast";
import { auth as authProvider } from "@/lib/auth";
import { isImpersonatingAdmin, useAuthStore } from "@/lib/auth/authStore";
import { type Org, orgs as gwOrgs } from "@/lib/gateway/client";
import { config as pbxConfig, orgs as pbxOrgs, type PbxOrg } from "@/lib/pbx/client";

export default function SettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<Org | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [campaignQueryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, err: unknown) => {
              const status = (err as { status?: number } | null)?.status ?? 0;
              if (status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  useEffect(() => {
    // Try PBX API first (works with JWT), then gateway, then session fallback
    pbxOrgs
      .get(orgId)
      .then((o: PbxOrg) =>
        setOrg({
          id: o.id,
          name: o.name,
          is_active: o.status === "active",
          created_at: o.createdAt || "",
          updated_at: "",
        })
      )
      .catch(() =>
        gwOrgs
          .get(orgId)
          .then(setOrg)
          .catch(() => {})
      );
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
    if (typeof window === "undefined") {
      router.push("/dashboard");
      return;
    }
    if (isImpersonatingAdmin()) {
      localStorage.removeItem("pbx_org_token");
      localStorage.removeItem("pbx_org_token_exp");
      localStorage.removeItem("pbx_api_key");
      localStorage.removeItem("org_access");
      localStorage.removeItem("user_role");
      localStorage.removeItem("user_permissions");
      router.push("/dashboard");
      return;
    }
    useAuthStore.getState().logout();
    authProvider
      .signOut()
      .catch((err) => console.warn("[settings] signOut failed:", err?.code || err));
    router.push("/dashboard");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Breadcrumb Header */}
      <div className="cmp-breadcrumb">
        <span className="text-muted-foreground">App</span>
        <span className="cmp-breadcrumb-sep">/</span>
        <span className="cmp-breadcrumb-active">Settings</span>
        <div style={{ marginLeft: "auto" }}>
          <a
            className="cmp-btn cmp-btn-ghost cmp-btn-sm"
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <ExternalLink size={13} /> GitHub
          </a>
        </div>
      </div>

      <div className="cmp-page-pad scroll-area">
        <div className="cmp-page-actions-row">
          <div>
            <h1 className="cmp-page-heading">Settings</h1>
            <p className="cmp-page-subheading">Organization settings and configuration</p>
          </div>
        </div>

        <div className="cmp-settings-grid">
          {/* Organization Details Card */}
          <div className="cmp-card-static">
            <div className="cmp-card-static-header">
              <span className="cmp-card-static-title">Organization</span>
              <span className="cmp-card-static-description">Your organization details</span>
            </div>
            <div className="cmp-card-static-content">
              {org ? (
                <>
                  <div className="cmp-kv-row">
                    <span className="cmp-kv-label">Name</span>
                    <span className="cmp-kv-value">{org.name}</span>
                  </div>
                  <div className="cmp-kv-row">
                    <span className="cmp-kv-label">Organization ID</span>
                    <span className="cmp-kv-value cmp-mono text-13">{org.id}</span>
                  </div>
                  <div className="cmp-kv-row">
                    <span className="cmp-kv-label">Status</span>
                    <span
                      className="cmp-chip"
                      style={{
                        background: org.is_active ? "oklch(0.965 0.04 150)" : "var(--secondary)",
                        color: org.is_active ? "oklch(0.4 0.13 150)" : "var(--muted-foreground)",
                        fontWeight: 600,
                        border: "1px solid transparent",
                      }}
                    >
                      {org.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="cmp-kv-row">
                    <span className="cmp-kv-label">Created</span>
                    <span className="cmp-kv-value">
                      {org.created_at
                        ? new Date(org.created_at).toLocaleDateString("en-IN", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
            </div>
          </div>

          {/* Lead Fields Configurator Card */}
          <QueryClientProvider client={campaignQueryClient}>
            <CampaignSettingsPanel orgId={orgId} showBackLink={false} embedded />
          </QueryClientProvider>

          {/* Asterisk Configuration Card */}
          <div className="cmp-card-static">
            <div className="cmp-card-static-header">
              <span className="cmp-card-static-title">Asterisk Configuration</span>
              <span className="cmp-card-static-description">
                Deploy and reload PBX configuration
              </span>
            </div>
            <div className="cmp-card-static-content">
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="cmp-btn cmp-btn-ghost cmp-btn-sm"
                  style={{ border: "1px solid var(--border)" }}
                  onClick={handleDeploy}
                  disabled={deploying}
                >
                  <Upload size={14} style={{ marginRight: 6 }} /> Deploy Config
                </button>
                <button
                  className="cmp-btn cmp-btn-ghost cmp-btn-sm"
                  style={{ border: "1px solid var(--border)" }}
                  onClick={handleReload}
                  disabled={reloading}
                >
                  <RefreshCw
                    size={14}
                    className={reloading ? "animate-spin" : ""}
                    style={{ marginRight: 6 }}
                  />{" "}
                  Reload Asterisk
                </button>
              </div>
              <p className="text-13 fg-muted" style={{ marginTop: 12, marginBottom: 0 }}>
                Deploy generates PJSIP and dialplan config files. Reload applies changes without
                dropping active calls.
              </p>
            </div>
          </div>

          {/* Session Card */}
          <div className="cmp-card-static">
            <div className="cmp-card-static-header">
              <span className="cmp-card-static-title">Session</span>
              <span className="cmp-card-static-description">Manage your admin session</span>
            </div>
            <div className="cmp-card-static-content">
              <button
                className="cmp-btn cmp-btn-sm"
                style={{
                  background: "oklch(0.7 0.18 27)",
                  color: "white",
                  display: "inline-flex",
                  alignItems: "center",
                }}
                onClick={handleLogout}
              >
                <LogOut size={14} style={{ marginRight: 6 }} /> Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
