"use client";

import { Menu } from "lucide-react";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getAdminKey, orgs } from "@/lib/gateway/client";
import { getOrgToken, setApiKey, setOrgToken } from "@/lib/pbx/client";

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const pathname = usePathname();
  const [orgName, setOrgName] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function loadOrg() {
      const savedOrg = typeof window !== "undefined" ? localStorage.getItem("org_access") : null;
      if (savedOrg) {
        try {
          const parsed = JSON.parse(savedOrg);
          if (parsed.org_id === orgId && parsed.api_key) {
            setOrgName(parsed.org_name || orgId);
            setOrgToken(parsed.api_key);
            setReady(true);
            return;
          }
        } catch {}
      }

      if (!getAdminKey()) {
        setReady(true);
        return;
      }
      try {
        // Admin impersonation: mint a user-shaped JWT for the org owner so
        // the sidebar shows the real user's email and PBX calls run as that user.
        const impRes = await fetch(`/api/admin/impersonate/${orgId}`, { method: "POST" });
        if (impRes.ok) {
          const data = await impRes.json();
          setOrgName(data.user?.org_name || orgId);
          setOrgToken(data.token);
          const access = {
            org_id: data.user.org_id,
            org_name: data.user.org_name,
            api_key: data.token,
            role: data.user.role,
            email: data.user.email,
            name: data.user.name,
            user_id: data.user.id,
            impersonating: true,
          };
          if (typeof window !== "undefined") {
            localStorage.setItem("org_access", JSON.stringify(access));
            window.dispatchEvent(new Event("astradial:org-access-changed"));
          }
        } else {
          // Fall back to legacy admin-org-token (no user identity)
          const org = await orgs.get(orgId);
          setOrgName(org.name);
          const tokenRes = await fetch("/api/auth/admin-org-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ org_id: orgId }),
          });
          if (tokenRes.ok) {
            const { token } = await tokenRes.json();
            setOrgToken(token);
          }
        }
      } catch {
        setOrgName(orgId);
      }
      setReady(true);
    }
    loadOrg();
  }, [orgId]);

  // Note: the bot editor and workflow editor used to render outside this
  // layout (via `fixed inset-0`). We now render them inside the tab so the
  // sidebar + top header stay visible, matching the IVR builder UX. See
  // bots/[botId]/page.tsx and workflows/[workflowId]/page.tsx — both use
  // `h-full flex flex-col` instead of `fixed inset-0`.

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar orgId={orgId} orgName={orgName} variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
