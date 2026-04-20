"use client"

import { MailIcon, PlusCircleIcon, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
const isAdmin = typeof window !== "undefined" && (!!localStorage.getItem("gateway_admin_key") || localStorage.getItem("user_role") === "owner" || localStorage.getItem("user_role") === "admin");


import { Button } from "@/components/ui/button"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"


export function NavMain({
  items,
  title,
  orgId
}: {
  title: string
  items: {
    name: string
    url: string
    icon?: LucideIcon
  }[]
  orgId: string
}) {
  const basePath = `/dashboard/${orgId}`;
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
        <div className="pl-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
          {items.map((item) => (
            <SidebarMenuItem key={item.name}>
              <SidebarMenuButton tooltip={item.name} asChild>
                <Link href={basePath + item.url}>
                  {item.icon && <item.icon />}
                  <span>{item.name}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
