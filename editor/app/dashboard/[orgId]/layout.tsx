"use client";

import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Loader2 } from "lucide-react";

import { Sidebar } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { getAdminKey } from "@/lib/gateway/client";
import { setOrgToken } from "@/lib/pbx/client";

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const pathname = usePathname();
  const [orgName, setOrgName] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
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
      setOrgName(orgId);
      setReady(true);
    }
    loadOrg();
  }, [orgId]);

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

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
    <div className="flex h-screen bg-background">
      <div className="hidden lg:flex">
        <Sidebar orgId={orgId} orgName={orgName || "Loading..."} />
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <div className="lg:hidden flex items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-medium truncate">{orgName || "Loading..."}</span>
        </div>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-52">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar orgId={orgId} orgName={orgName || "Loading..."} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
