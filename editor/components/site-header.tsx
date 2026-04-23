"use client";

import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const LABEL_OVERRIDES: Record<string, string> = {
  crm: "CRM",
  dids: "DIDs",
  sip: "SIP",
  whatsapp: "WhatsApp",
};

function isDynamicSegment(segment: string): boolean {
  // UUID-ish or pure numeric → treated as dynamic entity id
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(segment) || /^\d+$/.test(segment);
}

function prettify(slug: string): string {
  if (LABEL_OVERRIDES[slug]) return LABEL_OVERRIDES[slug];
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const ROUTE_CATEGORIES: Record<string, string> = {
  overview: "ANALYTICS",
  calls: "ANALYTICS",
  users: "CONFIGURE",
  departments: "CONFIGURE",
  bots: "CONFIGURE",
  tickets: "MONITOR",
  workflows: "MONITOR",
  whatsapp: "PLUGINS",
  webhooks: "PLUGINS",
  dids: "DEPLOY",
  trunks: "DEPLOY",
  crm: "CRM",
};

function useCurrentPageInfo() {
  const pathname = usePathname() || "";
  const parts = pathname.split("/").filter(Boolean);
  // Under /dashboard/[orgId]/..., strip the first two segments.
  const pageSegments =
    parts[0] === "dashboard" ? parts.slice(2).filter((s) => !isDynamicSegment(s)) : parts;
  if (pageSegments.length === 0) return { category: null, label: null };
  const baseSegment = pageSegments[0].toLowerCase();
  const category = ROUTE_CATEGORIES[baseSegment] || "App";
  const label = prettify(pageSegments[pageSegments.length - 1]);
  return { category, label };
}

export function SiteHeader() {
  const { category, label } = useCurrentPageInfo();

  return (
    <header className="sticky top-0 z-50 bg-background/50 backdrop-blur-sm rounded-t-lg flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          {category && <span className="text-muted-foreground">{category}</span>}
          {label && (
            <>
              {category && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <span className="font-medium text-foreground">{label}</span>
            </>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" asChild size="sm" className="hidden sm:flex">
            <a
              href="https://github.com/shadcn-ui/ui/tree/main/apps/v4/app/(examples)/dashboard"
              rel="noopener noreferrer"
              target="_blank"
              className="dark:text-foreground"
            >
              GitHub
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}
