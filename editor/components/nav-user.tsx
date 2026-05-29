import {
  BellIcon,
  CreditCardIcon,
  LogOutIcon,
  MoonIcon,
  MoreVerticalIcon,
  SunIcon,
  MonitorIcon,
  UserCircleIcon,
  SettingsIcon,
  CheckIcon
} from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { EllipsisIcon } from "lucide-react"

function handleLogout() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("gateway_admin_key");
    localStorage.removeItem("pbx_api_key");
    localStorage.removeItem("pbx_org_token");
    localStorage.removeItem("org_access");
    localStorage.removeItem("user_role");
    localStorage.removeItem("user_permissions");
  }
  window.location.href = "/dashboard";
}

export function NavUser({
  user,
  orgName,
  orgId
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
  orgName: string
  orgId: string
}) {
  const { isMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const basePath = `/dashboard/${orgId}`;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">{orgName.substring(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="block flex flex-1 text-left text-sm leading-tight w-full min-w-0 overflow-hidden">
                <div className="">
                  <div className="truncate font-medium w-35">{orgName}</div>
                  <div className="truncate text-xs text-muted-foreground w-35">
                    {user.email}
                  </div>
                </div>
                <div className="flex justify-end items-center w-full">
                  <EllipsisIcon className="h-4 w-4 rotate-90" />
                </div>
              </div>

            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-lg">CN</AvatarFallback>
                </Avatar>
                <div className="block flex-1 text-left text-sm leading-tight w-full min-w-0 overflow-hidden">
                  <div className="truncate font-medium">{user.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </div>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-1 text-xs font-normal text-muted-foreground">
                Theme
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setTheme("light")
                }}
              >
                <SunIcon className="mr-2 h-4 w-4" />
                Light
                {theme === "light" && <CheckIcon className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setTheme("dark")
                }}
              >
                <MoonIcon className="mr-2 h-4 w-4" />
                Dark
                {theme === "dark" && <CheckIcon className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault()
                  setTheme("system")
                }}
              >
                <MonitorIcon className="mr-2 h-4 w-4" />
                System
                {theme === "system" && <CheckIcon className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                {/* <IconNotification /> */}
                <SettingsIcon className="mr-2 h-4 w-4" />
                <Link href={`${basePath}/settings`}>
                  Settings
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOutIcon className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
