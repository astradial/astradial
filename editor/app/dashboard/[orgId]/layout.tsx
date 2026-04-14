"use client";

import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";

import { Sidebar } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { orgs, getAdminKey } from "@/lib/gateway/client";
import { setApiKey, setOrgToken, getOrgToken } from "@/lib/pbx/client";

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const pathname = usePathname();
  const [orgName, setOrgName] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    async function loadOrg() {
      const savedOrg = typeof window !== "undefined" ? localStorage.getItem("org_access") : null;
      if (savedOrg) {
        try {
          const parsed = JSON.parse(savedOrg);
          if (parsed.org_id === orgId && parsed.api_key) {
            setOrgName(parsed.org_name || orgId);
            setOrgToken(parsed.api_key);
            return;
          }
        } catch {}
      }

      if (!getAdminKey()) return;
      try {
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
      } catch {
        setOrgName(orgId);
      }
    }
    loadOrg();
  }, [orgId]);

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Bot editor page gets full screen
  if (pathname.includes("/bots/") && pathname.split("/").length > 5) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar orgId={orgId} orgName={orgName || "Loading..."} />
      </div>

      {/* Mobile/tablet header + sheet */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="lg:hidden flex items-center gap-2 border-b px-3 py-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-medium truncate">{orgName || "Loading..."}</span>
        </div>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {/* Mobile sidebar sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-52">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar orgId={orgId} orgName={orgName || "Loading..."} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
