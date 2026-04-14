import { create } from "zustand";

/**
 * Clear all authentication state from localStorage.
 */
function clearAllAuth() {
  if (typeof window === "undefined") return;
  const keys = [
    "auth_type", "admin_key", "org_token", "org_id", "org_name",
    "gateway_admin_key", "pbx_api_key", "pbx_org_token",
    "org_access", "user_role", "user_permissions", "admin_jwt",
  ];
  keys.forEach(k => localStorage.removeItem(k));
}

/**
 * Called by API clients when they receive a 401.
 * Admin sessions (gateway_admin_key) are never auto-logged out.
 * Clears ALL state including org_access to prevent stale token loops.
 */
let _unauthorizedHandling = false;
export function handleUnauthorized(reason: string = "401") {
  if (typeof window === "undefined") return;
  if (_unauthorizedHandling) return;

  // Admin sessions persist through 401 errors
  const hasAdminKey = !!localStorage.getItem("gateway_admin_key");
  if (hasAdminKey) {
    console.warn("[auth] 401 ignored (admin session):", reason);
    return;
  }

  _unauthorizedHandling = true;
  clearAllAuth();

  const path = window.location.pathname;
  const onLoginPage = path === "/dashboard" || path === "/dashboard/" || path === "/";
  if (!onLoginPage) {
    console.warn("[auth] Session expired (" + reason + "), redirecting to login");
    window.location.href = "/dashboard";
  } else {
    setTimeout(() => { _unauthorizedHandling = false; }, 100);
  }
}

interface AuthState {
  authType: "admin" | "org" | null;
  adminKey: string | null;
  orgToken: string | null;
  orgId: string | null;
  orgName: string | null;
  loginAsAdmin: (key: string) => void;
  loginAsOrg: (token: string, orgId: string, orgName: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  authType: null,
  adminKey: null,
  orgToken: null,
  orgId: null,
  orgName: null,

  loginAsAdmin: (key) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("auth_type", "admin");
      localStorage.setItem("admin_key", key);
    }
    set({ authType: "admin", adminKey: key });
  },

  loginAsOrg: (token, orgId, orgName) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("auth_type", "org");
      localStorage.setItem("org_token", token);
      localStorage.setItem("org_id", orgId);
      localStorage.setItem("org_name", orgName);
    }
    set({ authType: "org", orgToken: token, orgId, orgName });
  },

  logout: () => {
    clearAllAuth();
    _unauthorizedHandling = false;
    set({ authType: null, adminKey: null, orgToken: null, orgId: null, orgName: null });
  },

  isAuthenticated: () => {
    const { authType, adminKey, orgToken } = get();
    return (authType === "admin" && !!adminKey) || (authType === "org" && !!orgToken);
  },

  hydrate: () => {
    if (typeof window === "undefined") return;
    const authType = localStorage.getItem("auth_type") as "admin" | "org" | null;
    if (authType === "admin") {
      set({ authType: "admin", adminKey: localStorage.getItem("admin_key") });
    } else if (authType === "org") {
      set({
        authType: "org",
        orgToken: localStorage.getItem("org_token"),
        orgId: localStorage.getItem("org_id"),
        orgName: localStorage.getItem("org_name"),
      });
    }
  },
}));
