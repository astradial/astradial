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
import { cn } from "@/lib/utils";
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";

const CHILDREN = [
  { id: "dashboard", label: "Dashboard", url: "/campaigns/dashboard", icon: Activity },
  { id: "campaigns", label: "Campaigns", url: "/campaigns", icon: Target },
  { id: "studio", label: "Studio", url: "/campaigns/studio", icon: Workflow },
  { id: "approvals", label: "Approvals", url: "/campaigns/approvals", icon: CheckSquare },
  { id: "settings", label: "Settings", url: "/campaigns/settings", icon: SettingsIcon },
] as const;

const COUNT_FMT = new Intl.NumberFormat("en-US");

// Local lightweight Collapsible components matching Radix interface without new package dependencies
interface CollapsibleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}

function Collapsible({ open, onOpenChange, className, children }: CollapsibleProps) {
  return (
    <div data-state={open ? "open" : "closed"} className={className}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, { open, onOpenChange });
        }
        return child;
      })}
    </div>
  );
}

interface CollapsibleTriggerProps {
  asChild?: boolean;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  [key: string]: any;
}

function CollapsibleTrigger({ asChild, children, open, onOpenChange, ...props }: CollapsibleTriggerProps) {
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<any>;
    const childProps = {
      ...props,
      ...child.props,
      onClick: (e: React.MouseEvent) => {
        if (props.onClick) props.onClick(e);
        if (child.props.onClick) child.props.onClick(e);
        onOpenChange?.(!open);
      },
      className: cn(props.className, child.props.className),
      "data-state": open ? "open" : "closed",
    };
    return React.cloneElement(child, childProps);
  }
  return (
    <button
      type="button"
      onClick={() => onOpenChange?.(!open)}
      data-state={open ? "open" : "closed"}
      {...props}
    >
      {children}
    </button>
  );
}

interface CollapsibleContentProps {
  open?: boolean;
  children: React.ReactNode;
}

function CollapsibleContent({ open, children }: CollapsibleContentProps) {
  if (!open) return null;
  return <div>{children}</div>;
}

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
    <SidebarMenuItem className="list-none">
      <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible w-full">
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip="Campaigns"
            // isActive={hasActive} // Commented out to prevent active highlight as requested
          >
            <Zap className="size-4 shrink-0" />
            <span>Campaigns</span>
            {/* <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-500 normal-case">NEW</span> */}
            <ChevronRight className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {CHILDREN.map((c) => {
              const Icon = c.icon;
              const active = c.id === activeChild?.id;
              const showBadge = c.id === "approvals" && approvalsCount != null && approvalsCount > 0;
              const href = basePath + c.url;
              return (
                <SidebarMenuSubItem key={c.id}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={active}
                  >
                    <Link href={href}>
                      <Icon className="size-4 shrink-0" />
                      <span>{c.label}</span>
                      {showBadge && (
                        <span
                          aria-label={`${approvalsCount} pending approvals`}
                          className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-medium text-white"
                        >
                          {approvalsCount > 99 ? "99+" : COUNT_FMT.format(approvalsCount)}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
