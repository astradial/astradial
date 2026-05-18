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

import { FaWhatsapp, FaRoute } from "react-icons/fa";

import Link from "next/link"
import AstradialLogo from "@/components/icons/AstradialLogo";
import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { NavHelp } from "@/components/nav-help"
// MariaDB-backed open-ticket count subscription (Phase B+).
// Internally: fetch /api/pbx/tickets?status=open&limit=1 → reads `total`,
// then refetches on every SSE `refresh` event.
import { subscribeToOpenTicketCount } from "@/lib/tickets/api"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

function readIsAdmin(): boolean {
  if (typeof window === "undefined") return false;
  return (
    !!localStorage.getItem("gateway_admin_key") ||
    localStorage.getItem("user_role") === "owner" ||
    localStorage.getItem("user_role") === "admin"
  );
}

function readUserEmail(admin: boolean): string {
  if (typeof window === "undefined") return "";
  try {
    const orgAccess = localStorage.getItem("org_access");
    if (orgAccess) return JSON.parse(orgAccess).email || "";
  } catch { }
  return admin ? "admin@example.com" : "";
}

const data = {
  user: {
    name: "",
    email: "",
    avatar: "/avatars/shadcn.jpg",
  },

  navAnalytics: [
    {
      name: "Dashboard",
      url: "/overview",
      icon: LayoutDashboard,
    },
    {
      name: "Call Logs",
      url: "/calls",
      icon: PhoneCall,
    },
    {
      name: "Tickets",
      url: "/tickets",
      icon: Ticket,
    },
  ],

  navConfigure: [
    {
      name: "Users",
      url: "/users",
      icon: Users,
    },
    {
      name: "Departments",
      url: "/departments",
      icon: ListOrdered,
    },
    {
      name: "Super Human",
      url: "/bots",
      icon: Sparkles,
    },
    {
      name: "Workflows",
      url: "/workflows",
      icon: Workflow,
    },
    {
      name: "IVR",
      url: "/ivr",
      icon: FaRoute,
    },
  ],

  navPlugins: [
    {
      name: "API & Webhooks",
      url: "/webhooks",
      icon: Webhook,
    },
    {
      name: "WhatsApp",
      url: "/whatsapp",
      icon: FaWhatsapp,
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
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [userEmail, setUserEmail] = React.useState("");
  // Live count of open tickets — drives the red badge on the Tickets nav item.
  // Mirrors the Open Tickets card on the Dashboard overview (same query, same
  // status filter), so the two values stay in sync.
  const [openTicketCount, setOpenTicketCount] = React.useState(0);

  React.useEffect(() => {
    const admin = readIsAdmin();
    setIsAdmin(admin);
    setUserEmail(readUserEmail(admin));
  }, []);

  React.useEffect(() => {
    if (!orgId) return;
    // Live count via API + SSE — replaces the Firestore onSnapshot
    // that used to read the same data. After closing a ticket the
    // page broadcasts a `refresh` event; this resubscribe refetches
    // and the badge decrements within ~1 round-trip.
    return subscribeToOpenTicketCount(orgId, setOpenTicketCount);
  }, [orgId]);

  const user = { ...data.user, email: userEmail };

  // Inject the live open-ticket count onto the Tickets nav item without
  // mutating the static `data` config above.
  const navAnalyticsWithBadges = data.navAnalytics.map((item) =>
    item.name === "Tickets" ? { ...item, badge: openTicketCount } : item
  );

  return (
    <Sidebar collapsible="offcanvas" {...props} className="w-60" >
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
        <NavMain orgId={orgId} title="Analytics" items={navAnalyticsWithBadges} />
        <NavMain orgId={orgId} title="Configure" items={data.navConfigure} />
        <NavSecondary orgId={orgId} title="Plugins" items={data.navPlugins} />
        <NavSecondary orgId={orgId} title="Deploy" items={data.navDeploy} />
        <NavDocuments orgId={orgId} title="CRM" items={data.navCRM} />
      </SidebarContent>
      <SidebarFooter>
        <NavHelp orgId={orgId} title="Help" />
        <NavUser user={user} orgName={orgName} orgId={orgId} />
      </SidebarFooter>
    </Sidebar>
  )
}