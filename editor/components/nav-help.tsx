"use client"

import * as React from "react"
import { ShieldCheck, Lightbulb, CircleAlert, BookOpen } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"



export function NavHelp({
  title,
  orgId,
  ...props
}: {
  title: string
  orgId: string
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
    function handleUrgentCall() {
        if (typeof window !== "undefined") window.alert("For urgent issues, call: +91 99444 21125");
    }
    
  return (
    <>
      <SidebarGroup {...props}>
        <SidebarGroupContent>
          <SidebarMenu>
              <SidebarMenuItem key={"Role Permissions"}>
                <SidebarMenuButton asChild>
                  <a href={`/dashboard/${orgId}/roles`}>
                    <ShieldCheck />
                    <span>Role Permissions</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem key={"Request Feature"}>
                <SidebarMenuButton asChild >
                  <a href={`mailto:admin@astradial.com?subject=Feature%20Request`}>
                    <Lightbulb />
                    <span>Request Feature</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem key={"Raise Issue"}>
                <SidebarMenuButton asChild onClick={handleUrgentCall}>
                  <a>
                    <CircleAlert />
                    <span>Raise Issue</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem key={"Guide"}>
                <SidebarMenuButton asChild >
                  <a href={`https://docs.astradial.com`} target="_blank">
                    <BookOpen />
                    <span>Guide</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  )
}
