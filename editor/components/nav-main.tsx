"use client"

import { type LucideIcon } from "lucide-react"
import type { IconType } from "react-icons";
import Link from "next/link"
import { usePathname } from "next/navigation"

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
  orgId,
  children
}: {
  title: string
  items: {
    name: string
    url: string
    icon?: LucideIcon | IconType
    badge?: number
  }[]
  orgId: string
  children?: React.ReactNode
}) {
  const basePath = `/dashboard/${orgId}`;
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
        <div className="pl-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
          {items.map((item) => {
            const href = basePath + item.url;
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <SidebarMenuItem key={item.name}>
                <SidebarMenuButton
                  tooltip={item.name}
                  asChild
                  isActive={isActive}
                >
                  <Link href={href}>
                    {item.icon && <item.icon />}
                    {item.name === "Super Human" ?
                    <span
                      className="font-semibold bg-clip-text text-transparent bg-[length:200%_auto] animate-[text-shine_3s_linear_infinite]"
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, #5c3317 0%, #a16207 25%, #f1c987 50%, #a16207 75%, #5c3317 100%)",
                      }}
                    >{item.name}</span> : item.name}
                    {item.badge !== undefined && item.badge > 0 && (
                      <span
                        aria-label={`${item.badge} open ${item.name.toLowerCase()}`}
                        className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-medium text-white"
                      >
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
          {children}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
