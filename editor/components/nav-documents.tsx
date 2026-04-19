"use client"

import { useState } from "react"
import {
  FolderIcon,
  MoreHorizontalIcon,
  ShareIcon,
  type LucideIcon,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export function NavDocuments({
  title,
  items,
  orgId,
}: {
  title: string
  items: {
    name: string
    url: string
    icon: LucideIcon
  }[]
  orgId: string
}) {
  const { isMobile } = useSidebar()
  const [showMore, setShowMore] = useState(false)
  const basePath = `/dashboard/${orgId}`;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel></SidebarGroupLabel>
      <SidebarMenu>

        <div className={showMore ? "px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" : "hidden"}>{title}</div>
        {showMore && items.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton asChild>
              <a href={basePath + item.url}>
                <item.icon />
                <span>{item.name}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}

        <SidebarMenuItem>
          <SidebarMenuButton className="text-sidebar-foreground/50" onClick={() => setShowMore(!showMore)}>
            <MoreHorizontalIcon className="text-sidebar-foreground/50" />
            <span>{showMore ? "Less" : "More"}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
