"use client";

import { ShieldCheck, Check, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const ROLES = ["Owner", "Admin", "Manager", "Agent"] as const;

const PERMISSIONS: { category: string; items: { name: string; roles: boolean[] }[] }[] = [
  {
    category: "Organisation & Settings",
    items: [
      { name: "Edit org settings",         roles: [true,  true,  false, false] },
      { name: "Manage API keys / secrets",  roles: [true,  false, false, false] },
      { name: "View billing & usage",       roles: [true,  true,  false, false] },
      { name: "Deploy Asterisk config",     roles: [true,  true,  false, false] },
    ],
  },
  {
    category: "User Management",
    items: [
      { name: "Invite / delete users",     roles: [true,  true,  false, false] },
      { name: "Assign any role",            roles: [true,  false, false, false] },
      { name: "Assign manager / agent",     roles: [true,  true,  false, false] },
      { name: "View user list",             roles: [true,  true,  true,  false] },
      { name: "View own profile",           roles: [true,  true,  true,  true]  },
    ],
  },
  {
    category: "Phone Numbers & Queues",
    items: [
      { name: "Buy / configure numbers",   roles: [true,  true,  false, false] },
      { name: "View numbers & queues",      roles: [true,  true,  true,  true]  },
    ],
  },
  {
    category: "Calls",
    items: [
      { name: "View all call logs",         roles: [true,  true,  true,  false] },
      { name: "View own calls only",        roles: [true,  true,  true,  true]  },
      { name: "Listen to recordings",       roles: [true,  true,  true,  false] },
      { name: "Download recordings",        roles: [true,  true,  false, false] },
      { name: "Delete recordings",          roles: [true,  true,  false, false] },
      { name: "Click-to-call",              roles: [true,  true,  true,  true]  },
    ],
  },
  {
    category: "Tickets",
    items: [
      { name: "View tickets",              roles: [true,  true,  true,  true]  },
      { name: "Create / update tickets",   roles: [true,  true,  true,  true]  },
      { name: "Delete / archive tickets",  roles: [true,  true,  true,  false] },
    ],
  },
  {
    category: "Workflows & Bots",
    items: [
      { name: "Create / edit workflows",   roles: [true,  true,  false, false] },
      { name: "View workflows",            roles: [true,  true,  true,  false] },
      { name: "Manage bots (AI config)",   roles: [true,  true,  false, false] },
    ],
  },
  {
    category: "CRM",
    items: [
      { name: "View contacts, companies, deals",   roles: [true,  true,  true,  true]  },
      { name: "Create / edit CRM records",          roles: [true,  true,  true,  false] },
      { name: "Delete CRM records",                 roles: [true,  true,  false, false] },
      { name: "Customize fields & pipelines",       roles: [true,  true,  false, false] },
      { name: "Assign to users",                    roles: [true,  true,  true,  false] },
    ],
  },
  {
    category: "API & Integrations",
    items: [
      { name: "Create / revoke API keys",           roles: [true,  true,  false, false] },
      { name: "View API keys",                      roles: [true,  true,  true,  false] },
      { name: "Manage webhooks",                    roles: [true,  true,  false, false] },
    ],
  },
  {
    category: "Compliance & Audit",
    items: [
      { name: "Set retention policy",       roles: [true,  true,  false, false] },
      { name: "View audit log",             roles: [true,  true,  true,  false] },
      { name: "Export data (DPDP)",          roles: [true,  true,  false, false] },
      { name: "Handle erasure requests",     roles: [true,  true,  false, false] },
    ],
  },
];

const roleCounts = ROLES.map((_, i) =>
  PERMISSIONS.reduce((sum, cat) => sum + cat.items.filter((item) => item.roles[i]).length, 0)
);

const roleColors: Record<string, string> = {
  Owner: "",
  Admin: "",
  Manager: "",
  Agent: "",
};

export default function RolesPage() {
  const userRole = typeof window !== "undefined" ? localStorage.getItem("user_role") : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-4 sm:px-6 py-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Role Permissions</h1>
            <p className="text-sm text-muted-foreground">
              Who can access what in your organisation
              {userRole && (
                <span className="ml-2">
                  — your role: <Badge variant="default">{userRole}</Badge>
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Role summary cards */}
      <div className="px-4 sm:px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ROLES.map((role, i) => (
          <div key={role} className={`rounded-lg border p-3 ${userRole === role.toLowerCase() ? "ring-2 ring-primary" : ""}`}>
            <div className="flex items-center justify-between mb-1">
              <Badge variant="secondary">{role}</Badge>
              <span className="text-xs text-muted-foreground">{roleCounts[i]} perms</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight mt-1">
              {role === "Owner" && "Full control over everything"}
              {role === "Admin" && "Everything except API keys"}
              {role === "Manager" && "View calls, recordings, users"}
              {role === "Agent" && "Own calls, tickets, click-to-call"}
            </p>
          </div>
        ))}
      </div>

      {/* Permission table */}
      <div className="px-4 sm:px-6 flex-1 overflow-y-auto pb-6">
        <div className="border rounded-lg">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[300px]">Permission</TableHead>
                {ROLES.map((role) => (
                  <TableHead key={role} className="text-center w-24">
                    <Badge variant="outline">{role}</Badge>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSIONS.map((category) => (
                <>
                  <TableRow key={category.category} className="bg-muted/30">
                    <TableCell colSpan={5} className="font-semibold text-xs uppercase tracking-wide text-muted-foreground py-2">
                      {category.category}
                    </TableCell>
                  </TableRow>
                  {category.items.map((item) => (
                    <TableRow key={item.name}>
                      <TableCell className="text-sm">{item.name}</TableCell>
                      {item.roles.map((allowed, i) => (
                        <TableCell key={i} className="text-center">
                          {allowed ? (
                            <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
