"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import AstradialLogo from "@/components/icons/AstradialLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { orgs, PbxOrg } from "@/lib/pbx/client";
import { getAdminKey, setAdminKey } from "@/lib/gateway/client";

export function AdminOrgList({ onLogout }: { onLogout: () => void }) {
  const [orgList, setOrgList] = useState<PbxOrg[]>([]);
  const [pendingOrgs, setPendingOrgs] = useState<PbxOrg[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadOrgs();
  }, []);

  async function loadOrgs() {
    try {
      setLoading(true);
      const key = getAdminKey();
      const res = await fetch("/api/gateway/admin/orgs", {
        headers: { Authorization: `Bearer ${key}` }
      });
      if (!res.ok) throw new Error("Failed to load orgs");
      const list = await res.json();
      
      // Because /api/gateway maps property to "is_active", we can scan it correctly
      setOrgList(list.filter((o: any) => o.is_active));
      setPendingOrgs(list.filter((o: any) => !o.is_active));
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

  return (
    <div className="min-h-screen bg-background w-full">
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
                onLogout();
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
                const ci = org.contact_info as Record<string, string> | null;
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
                  <Badge variant={(org.status === "active" || (org as any).is_active) ? "default" : "secondary"}>
                    {(org.status === "active" || (org as any).is_active) ? "Active" : "Inactive"}
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
