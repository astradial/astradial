"use client";

import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { getAdminKey } from "@/lib/gateway/client";
import { setOrgToken } from "@/lib/pbx/client";

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const pathname = usePathname();
  const [orgName, setOrgName] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function loadOrg() {
      // Check if we already have a valid token for this org
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

      // Admin impersonation — get JWT for this org
      if (getAdminKey()) {
        try {
          const tokenRes = await fetch("/api/auth/admin-org-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ org_id: orgId }),
          });
          if (tokenRes.ok) {
            const data = await tokenRes.json();
            const token = data.token;
            const name = data.org_name || orgId;
            setOrgName(name);
            setOrgToken(token);
            // Persist so child pages have auth immediately
            if (typeof window !== "undefined") {
              localStorage.setItem("org_access", JSON.stringify({
                org_id: orgId,
                org_name: name,
                api_key: token,
                role: "owner",
                email: "admin",
              }));
              localStorage.setItem("pbx_org_token", token);
              localStorage.setItem("user_role", "owner");
              localStorage.setItem("user_permissions", JSON.stringify([]));
            }
            setReady(true);
            return;
          }
        } catch {}
      }

      // No auth available
      if (typeof window !== "undefined") {
        window.location.href = "/dashboard";
      }
    }
    loadOrg();
  }, [orgId]);

  // Bot editor page gets full screen
  if (pathname.includes("/bots/") && pathname.split("/").length > 5) {
    return <>{children}</>;
  }

  // Block rendering until auth is ready — prevents child pages from making unauthenticated API calls
  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar orgId={orgId} variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
