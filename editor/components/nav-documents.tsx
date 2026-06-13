"use client";

import { type LucideIcon, MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function NavDocuments({
  title,
  items,
  orgId,
}: {
  title: string;
  items: {
    name: string;
    url: string;
    icon: LucideIcon;
  }[];
  orgId: string;
}) {
  const { isMobile } = useSidebar();
  const [showMore, setShowMore] = useState(false);
  const basePath = `/dashboard/${orgId}`;
  const pathname = usePathname();

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel></SidebarGroupLabel>
      <SidebarMenu>
        <div
          className={
            showMore
              ? "px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              : "hidden"
          }
        >
          {title}
        </div>
        {showMore &&
          items.map((item) => {
            const href = basePath + item.url;
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <SidebarMenuItem key={item.name}>
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link href={href}>
                    <item.icon />
                    <span>{item.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}

        <SidebarMenuItem>
          <SidebarMenuButton
            className="text-sidebar-foreground/50"
            onClick={() => setShowMore(!showMore)}
          >
            <MoreHorizontalIcon className="text-sidebar-foreground/50" />
            <span>{showMore ? "Less" : "More"}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
