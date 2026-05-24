"use client";

import {
  Activity,
  CheckSquare,
  ChevronRight,
  Settings as SettingsIcon,
  Target,
  Workflow,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { subscribeToApprovalsCount } from "@/lib/campaigns/client";

const CHILDREN = [
  { id: "dashboard", label: "Dashboard", url: "/campaigns/dashboard", icon: Activity },
  { id: "campaigns", label: "Campaigns", url: "/campaigns", icon: Target },
  { id: "studio", label: "Studio", url: "/campaigns/studio", icon: Workflow },
  { id: "approvals", label: "Approvals", url: "/campaigns/approvals", icon: CheckSquare },
  { id: "settings", label: "Settings", url: "/campaigns/settings", icon: SettingsIcon },
] as const;

const COUNT_FMT = new Intl.NumberFormat("en-US");

export function CampaignsTree({ orgId }: { orgId: string }) {
  const basePath = `/dashboard/${orgId}`;
  const pathname = usePathname();
  const [approvalsCount, setApprovalsCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    const unsub = subscribeToApprovalsCount(
      (n) => setApprovalsCount(n),
      () => { /* swallow stream errors — badge just stays at last known value */ }
    );
    return unsub;
  }, []);

  function isChildActive(url: string): boolean {
    const full = basePath + url;
    return pathname === full || pathname.startsWith(full + "/");
  }

  // /campaigns is the ambiguous parent path. It is "active" only when no
  // deeper child route matched — Dashboard, Studio, Raw Leads, Approvals,
  // Settings all share the /campaigns/ prefix.
  const activeChild = CHILDREN.find((c) => {
    const full = basePath + c.url;
    if (c.id === "campaigns") {
      if (pathname === full) return true;
      const deeper = pathname.startsWith(basePath + "/campaigns/");
      if (!deeper) return false;
      for (const other of CHILDREN) {
        if (other.id === "campaigns") continue;
        if (pathname.startsWith(basePath + other.url)) return false;
      }
      return true;
    }
    return isChildActive(c.url);
  });

  const hasActive = !!activeChild;
  const [open, setOpen] = React.useState(hasActive);
  React.useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <div className="px-2 py-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`cmp-nav-parent ${open ? "cmp-nav-open" : ""} ${hasActive ? "cmp-nav-has-active" : ""}`}
      >
        <Zap />
        <span className="cmp-nav-label">Campaigns</span>
        <span className="cmp-nav-new-pill">NEW</span>
        <ChevronRight className="cmp-nav-chev" />
      </button>
      {open && (
        <div className="cmp-nav-children">
          {CHILDREN.map((c) => {
            const Icon = c.icon;
            const active = c.id === activeChild?.id;
            const showBadge = c.id === "approvals" && approvalsCount != null && approvalsCount > 0;
            return (
              <Link
                key={c.id}
                href={basePath + c.url}
                className={`cmp-nav-child ${active ? "cmp-nav-child-active" : ""}`}
              >
                <Icon />
                <span className="cmp-nav-label">{c.label}</span>
                {showBadge && (
                  <span className="cmp-nav-badge" aria-label={`${approvalsCount} pending approvals`}>
                    {COUNT_FMT.format(approvalsCount)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
