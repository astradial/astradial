"use client"

import * as React from "react"
import { LucideIcon } from "lucide-react"
import Link from "next/link"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavSecondary({
  title,
  items,
  orgId,
  ...props
}: {
  title: string
  items: {
    name: string
    url: string
    icon: LucideIcon
  }[]
  orgId: string
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const basePath = `/dashboard/${orgId}`;
  return (
    <>
      <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <SidebarGroup {...props}>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.name}>
                <SidebarMenuButton asChild >
                  <Link href={basePath + item.url}>
                    <item.icon />
                    <span>{item.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  )
}
