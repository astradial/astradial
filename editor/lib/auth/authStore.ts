import { create } from "zustand";

/**
 * Called by API clients when they receive a 401 from the PBX or workflow engine.
 * Clears all local auth state and redirects to the dashboard root which shows
 * the login form when there's no token.
 *
 * Guarded against re-entry / redirect loops via a module-level flag and a
 * pathname check (don't redirect if we're already on the login page).
 */
let _unauthorizedHandling = false;
export function handleUnauthorized(reason: string = "401") {
  if (typeof window === "undefined") return;
  if (_unauthorizedHandling) return;

  // Don't logout if admin key exists — admin sessions should persist
  const hasAdminKey = !!localStorage.getItem("gateway_admin_key");
  if (hasAdminKey) {
    console.warn("[auth] 401 but admin key exists, ignoring:", reason);
    return;
  }

  _unauthorizedHandling = true;

  try {
    useAuthStore.getState().logout();
  } catch (e) {
    console.warn("[auth] handleUnauthorized cleanup failed:", e);
  }

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
    if (typeof window !== "undefined") {
      localStorage.removeItem("auth_type");
      localStorage.removeItem("admin_key");
      localStorage.removeItem("org_token");
      localStorage.removeItem("org_id");
      localStorage.removeItem("org_name");
      localStorage.removeItem("gateway_admin_key");
      localStorage.removeItem("pbx_api_key");
      localStorage.removeItem("pbx_org_token");
      // org_access is the JSON blob the /dashboard page reads on mount;
      // if not cleared, the page sees a stale session and redirects back to
      // the protected route, creating a redirect loop instead of showing login.
      localStorage.removeItem("org_access");
    }
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
      set({
        authType: "admin",
        adminKey: localStorage.getItem("admin_key"),
      });
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
