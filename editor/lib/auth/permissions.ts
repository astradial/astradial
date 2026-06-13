"use client";

import { USE_FIREBASE } from "@/lib/auth";

type OrgAccess = {
  role?: string;
  source?: string;
};

function readOrgAccess(): OrgAccess | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("org_access");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OrgAccess;
  } catch {
    return null;
  }
}

function readRole(): string {
  if (typeof window === "undefined") return "";
  const explicitRole = localStorage.getItem("user_role");
  if (explicitRole) return explicitRole.toLowerCase();
  return (readOrgAccess()?.role || "").toLowerCase();
}

export function canManageOrgInfrastructure(): boolean {
  if (typeof window === "undefined") return false;

  if (USE_FIREBASE) {
    return !!localStorage.getItem("gateway_admin_key");
  }

  const role = readRole();
  return !!localStorage.getItem("pbx_org_token") && (role === "owner" || role === "admin");
}
