"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { auth, db as firestoreDb, USE_FIREBASE } from "@/lib/firebase/config";
import { ASTRAPBX_ROOT } from "@/lib/firebase/firestore";
import { useAuthStore, isImpersonatingAdmin } from "@/lib/auth/authStore";
import { auth as authProvider } from "@/lib/auth";
import {
  LayoutDashboard,
  Users,
  Phone,
  Server,
  ListOrdered,
  PhoneCall,
  Contact,
  Briefcase,
  HandshakeIcon,
  Target,
  SlidersHorizontal,
  Ticket,
  Sparkles,
  Route,
  Settings,
  Webhook,
  Workflow,
  MessageCircle,
  ArrowLeft,
  Sun,
  Moon,
  LogOut,
  MoreVertical,
  Lightbulb,
  CircleAlert,
  BookOpen,
  ShieldCheck,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AstradialLogo from "@/components/icons/AstradialLogo";

interface SidebarProps {
  orgId: string;
  orgName: string;
}

const navSections = [
  {
    label: "Configure",
    items: [
      { label: "Home", icon: LayoutDashboard, href: "/overview" },
      { label: "Users", icon: Users, href: "/users" },
      { label: "Super Human", icon: Sparkles, href: "/bots" },
      { label: "Queues", icon: ListOrdered, href: "/queues" },
      { label: "IVR", icon: Route, href: "/ivr" },
    ],
  },
  {
    label: "Monitor",
    items: [
      { label: "Calls", icon: PhoneCall, href: "/calls" },
      { label: "Tickets", icon: Ticket, href: "/tickets", badge: 0 },
    ],
  },
  {
    label: "Mini CRM",
    items: [
      { label: "Clients", icon: Briefcase, href: "/crm/clients" },
      { label: "Leads", icon: Target, href: "/crm/leads" },
      { label: "Deals", icon: HandshakeIcon, href: "/crm/deals" },
      { label: "Customize", icon: SlidersHorizontal, href: "/crm/customize" },
    ],
  },
  {
    label: "Automate",
    items: [
      { label: "Workflows", icon: Workflow, href: "/workflows" },
      { label: "WhatsApp", icon: FaWhatsapp, href: "/whatsapp" },
      { label: "API & Webhooks", icon: Webhook, href: "/webhooks" },
    ],
  },
  {
    label: "Deploy",
    items: [
      { label: "Phone Numbers", icon: Phone, href: "/dids" },
    ],
  },
];

export function Sidebar({ orgId, orgName }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const basePath = `/dashboard/${orgId}`;
  const isAdmin = typeof window !== "undefined" && !!localStorage.getItem("gateway_admin_key");

  // Open ticket count — Firestore real-time when USE_FIREBASE=true,
  // falls back to no badge (0) in OSS local mode. v1.1 will swap this
  // for an SSE/poll-based count from the ticket API.
  const [openTickets, setOpenTickets] = useState(0);
  useEffect(() => {
    if (!USE_FIREBASE || !firestoreDb) return;
    try {
      const ref = collection(firestoreDb, ASTRAPBX_ROOT, orgId, "tickets");
      const q = query(ref, where("status", "==", "open"));
      return onSnapshot(q, (snap) => setOpenTickets(snap.size));
    } catch { return () => {}; }
  }, [orgId]);

  // Get user info from session — prefer org_access.email (set by user-login or
  // admin impersonation). Re-read on storage + custom event so the Open
  // Dashboard transition (which sets org_access async after the layout renders)
  // updates the sidebar without needing a manual refresh.
  const [userEmail, setUserEmail] = useState<string>("");
  const [impersonating, setImpersonating] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let firebaseUnsub: (() => void) | null = null;

    function readOrgAccess(): boolean {
      try {
        const raw = localStorage.getItem("org_access");
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        setImpersonating(!!parsed.impersonating);
        if (parsed.email) {
          setUserEmail(parsed.email);
          return true;
        }
      } catch {}
      return false;
    }

    if (!readOrgAccess()) {
      // Subscribe to auth state via the unified provider so this works
      // in both Firebase and local modes.
      firebaseUnsub = authProvider.onAuthStateChanged((u) => {
        if (!readOrgAccess()) setUserEmail(u?.email || "");
      });
    }

    const onChange = () => readOrgAccess();
    window.addEventListener("storage", onChange);
    window.addEventListener("astradial:org-access-changed", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("astradial:org-access-changed", onChange);
      if (firebaseUnsub) firebaseUnsub();
    };
  }, []);

  function handleSwitchOrg(e: React.MouseEvent) {
    e.preventDefault();
    if (typeof window !== "undefined") {
      localStorage.removeItem("org_access");
      localStorage.removeItem("pbx_org_token");
      localStorage.removeItem("user_role");
      localStorage.removeItem("user_permissions");
    }
    window.location.href = "/dashboard";
  }

  function isActive(href: string) {
    const fullPath = `${basePath}${href}`;
    return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
  }

  function handleLogout() {
    if (typeof window === "undefined") {
      router.push("/dashboard");
      return;
    }
    // Admin impersonating: "Logout" from inside the impersonated org means
    // exit impersonation, not sign out of Firebase. Keep the gateway admin
    // key + Firebase admin session so they land back on the org picker.
    if (isImpersonatingAdmin()) {
      localStorage.removeItem("pbx_org_token");
      localStorage.removeItem("pbx_org_token_exp");
      localStorage.removeItem("pbx_api_key");
      localStorage.removeItem("org_access");
      localStorage.removeItem("user_role");
      localStorage.removeItem("user_permissions");
      router.push("/dashboard");
      return;
    }
    // Normal org user or pure admin: full logout — clear everything via
    // the unified auth provider (signs out of Firebase if active, clears
    // local JWT storage if local-mode).
    useAuthStore.getState().logout();
    authProvider.signOut().catch((err) => console.warn("[sidebar] signOut failed:", err?.code || err));
    router.push("/dashboard");
  }

  // Initials from org name
  const initials = orgName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="flex flex-col w-52 border-r bg-background shrink-0">
      {/* Header */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2">
          <AstradialLogo height={18} color="currentColor" />
          <span className="text-sm font-semibold">Astradial</span>
        </div>
        {impersonating && (
          <span className="mt-3 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
            <ShieldCheck className="h-3 w-3" />
            Impersonation
          </span>
        )}
        {isAdmin && (
          <a href="/dashboard" onClick={handleSwitchOrg} className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3 w-3" />
            Switch Organisation
          </a>
        )}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-3 pb-2">
        {navSections.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="px-2 mb-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {section.label}
            </p>
            {section.items.map((item) => (
              <Link key={item.href} href={`${basePath}${item.href}`}>
                <div
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] transition-colors ${
                    isActive(item.href)
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.label === "Tickets" && openTickets > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-red-500/80 text-[10px] text-white font-medium">{openTickets}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* Bottom — Help + Profile */}
      <div className="px-3 pb-1 space-y-0.5">
        <Link href={`/dashboard/${orgId}/roles`} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>Role Permissions</span>
        </Link>
        <a href="mailto:admin@example.com?subject=Feature%20Request" className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
          <Lightbulb className="h-4 w-4 shrink-0" />
          <span>Request Feature</span>
        </a>
        <button onClick={() => { if (typeof window !== "undefined") window.alert("For urgent issues, call: +91 99444 21125"); }} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors w-full text-left">
          <CircleAlert className="h-4 w-4 shrink-0" />
          <span>Raise Issue</span>
        </button>
        <a href="https://docs.example.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
          <BookOpen className="h-4 w-4 shrink-0" />
          <span>Guide</span>
        </a>
      </div>
      <div className="border-t">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 w-full px-4 py-3 text-left hover:bg-accent/50 transition-colors">
              <div className="flex items-center justify-center h-8 w-8 rounded-full bg-accent text-accent-foreground text-xs font-semibold shrink-0">
                {initials || "A"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate">{orgName}</p>
                {userEmail && <p className="text-[11px] text-muted-foreground truncate">{userEmail}</p>}
              </div>
              <MoreVertical className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            {/* Profile header in dropdown */}
            <div className="flex items-center gap-2.5 px-2 py-2">
              <div className="flex items-center justify-center h-9 w-9 rounded-full bg-accent text-accent-foreground text-xs font-semibold shrink-0">
                {initials || "A"}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{orgName}</p>
                {userEmail && <p className="text-xs text-muted-foreground truncate">{userEmail}</p>}
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push(`${basePath}/settings`)} className="gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="gap-2">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="gap-2">
              <LogOut className="h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
