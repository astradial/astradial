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

function useCurrentPageLabel(): string | null {
  const pathname = usePathname() || "";
  const parts = pathname.split("/").filter(Boolean);
  // Under /dashboard/[orgId]/..., strip the first two segments.
  const pageSegments =
    parts[0] === "dashboard" ? parts.slice(2).filter((s) => !isDynamicSegment(s)) : parts;
  if (pageSegments.length === 0) return null;
  return prettify(pageSegments[pageSegments.length - 1]);
}

export function SiteHeader() {
  const currentLabel = useCurrentPageLabel();

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Dashboard</span>
          {currentLabel && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-foreground">{currentLabel}</span>
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
