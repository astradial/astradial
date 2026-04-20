"use client"

import * as React from "react"
import {
  Briefcase,
  Phone,
  Server,
  Workflow,
  MessageCircle,
  Webhook,
  Target,
  HandshakeIcon,
  SlidersHorizontal,
  PhoneCall,
  Ticket,
  ListOrdered,
  Sparkles,
  LayoutDashboard,
  Users,
  ShieldCheck,
  Lightbulb,
  CircleAlert,
  BookOpen,
  ArrowLeft,
} from "lucide-react"

import Link from "next/link"
import AstradialLogo from "@/components/icons/AstradialLogo";
import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { NavHelp } from "@/components/nav-help"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const isAdmin = typeof window !== "undefined" && (!!localStorage.getItem("gateway_admin_key") || localStorage.getItem("user_role") === "owner" || localStorage.getItem("user_role") === "admin");
const userEmail = typeof window !== "undefined"
  ? (() => {
    try {
      const orgAccess = localStorage.getItem("org_access");
      if (orgAccess) return JSON.parse(orgAccess).email || "";
    } catch { }
    return isAdmin ? "admin@astradial.com" : "";
  })()
  : "";

const data = {
  user: {
    name: "",
    email: userEmail,
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      name: "Home",
      url: "/overview",
      icon: LayoutDashboard,
    },
    {
      name: "Users",
      url: "/users",
      icon: Users,
    },
    {
      name: "Super Human",
      url: "/bots",
      icon: Sparkles,
    },
    {
      name: "Queues",
      url: "/queues",
      icon: ListOrdered,
    },
  ],

  navMonitor: [
    {
      name: "Calls",
      url: "/calls",
      icon: PhoneCall,
    },
    {
      name: "Tickets",
      url: "/tickets",
      icon: Ticket,
    },
  ],

  navCRM: [
    {
      name: "Clients",
      url: "/crm/clients",
      icon: Briefcase,
    },
    {
      name: "Leads",
      url: "/crm/leads",
      icon: Target,
    },
    {
      name: "Deals",
      url: "/crm/deals",
      icon: HandshakeIcon,
    },
    {
      name: "Customize",
      url: "/crm/customize",
      icon: SlidersHorizontal,
    },
  ],

  navAutomate: [
    {
      name: "Workflows",
      url: "/workflows",
      icon: Workflow,
    },
    {
      name: "WhatsApp",
      url: "/whatsapp",
      icon: MessageCircle,
    },
    {
      name: "API & Webhooks",
      url: "/webhooks",
      icon: Webhook,
    },
  ],

  navDeploy: [
    {
      name: "Phone Numbers",
      url: "/dids",
      icon: Phone,
    },
    {
      name: "Trunks",
      url: "/trunks",
      icon: Server,
    }
  ],
}

export function AppSidebar({ orgId, orgName, ...props }: { orgId: string, orgName: string } & React.ComponentProps<typeof Sidebar>) {
  const basePath = `/dashboard/${orgId}`;
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <a href="#">
                <div className="flex items-center justify-center">
                  <AstradialLogo height={24} color="currentColor" />
                </div>
                <span className="text-lg font-bold">AstraDial</span>
              </a>
            </SidebarMenuButton>
            {isAdmin && (
              <Link href="/dashboard" className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="h-3 w-3" />
                Switch Organisation
              </Link>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain orgId={orgId} title="Configure" items={data.navMain} />
        <NavSecondary orgId={orgId} title="Automate" items={data.navAutomate} />
        <NavSecondary orgId={orgId} title="Deploy" items={data.navDeploy} />
        <NavSecondary orgId={orgId} title="Monitor" items={data.navMonitor} />
        <NavDocuments orgId={orgId} title="CRM" items={data.navCRM} />
      </SidebarContent>
      <SidebarFooter>
        <NavHelp orgId={orgId} title="Help" />
        <NavUser user={data.user} orgName={orgName} />
      </SidebarFooter>
    </Sidebar>
  )
}
