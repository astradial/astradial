import { create } from "zustand";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/config";
import { auth as authProvider, USE_FIREBASE } from "@/lib/auth";

// Unified signOut: prefers the auth abstraction so it works in both
// Firebase and local (api-key) modes. Falls back to the Firebase
// signOut when the abstraction isn't loaded yet (during initial
// bundle init).
function unifiedSignOut(): Promise<void> {
  try {
    return authProvider.signOut();
  } catch {
    if (USE_FIREBASE && auth) {
      return signOut(auth).catch(() => undefined);
    }
    return Promise.resolve();
  }
}

/**
 * Maximum lifetime of an admin session, enforced entirely client-side.
 *
 * Admin auth uses a long-lived `gateway_admin_key` plus the Firebase ID
 * token, which Firebase refreshes indefinitely in the background — neither
 * has a server-side expiry. We stamp `admin_session_start` in localStorage
 * at login time (see dashboard/page.tsx `handleAdminLogin`) and force a
 * full logout (Firebase signOut + clear gateway key) once the window
 * elapses. Impersonation JWTs have their own 24h server-side expiry,
 * handled separately by handleUnauthorized.
 */
export const ADMIN_SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Stamp `admin_session_start` = now. Called from admin login paths.
 */
export function markAdminSessionStart() {
  if (typeof window === "undefined") return;
  localStorage.setItem("admin_session_start", String(Date.now()));
}

/**
 * Epoch ms when the current admin session should force-expire, or null
 * if there is no admin session (or no start stamp we can trust).
 */
export function getAdminSessionExpiryMs(): number | null {
  if (typeof window === "undefined") return null;
  const hasAdminKey = !!localStorage.getItem("gateway_admin_key") || !!localStorage.getItem("admin_key");
  if (!hasAdminKey) return null;
  const startStr = localStorage.getItem("admin_session_start");
  if (!startStr) return null;
  const start = Number(startStr);
  if (!Number.isFinite(start) || start <= 0) return null;
  return start + ADMIN_SESSION_DURATION_MS;
}

/**
 * Decode the `exp` claim (epoch seconds) from a JWT without verifying the
 * signature — we only care about when it expires, not whether it's valid.
 * Returns the expiry as epoch milliseconds, or null if the token is
 * malformed.
 */
export function getJwtExpiryMs(token: string | null | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    // base64url → base64 → JSON
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

/**
 * True when the current session is an admin who has impersonated an org.
 * Signals: an admin/gateway key is present AND `org_access.impersonating`
 * is set (written by dashboard/page.tsx `handleEnterOrg` and the admin
 * impersonation path in the org layout).
 */
export function isImpersonatingAdmin(): boolean {
  if (typeof window === "undefined") return false;
  const hasAdminKey = !!localStorage.getItem("gateway_admin_key") || !!localStorage.getItem("admin_key");
  if (!hasAdminKey) return false;
  const raw = localStorage.getItem("org_access");
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { impersonating?: boolean };
    return !!parsed.impersonating;
  } catch {
    return false;
  }
}

/**
 * Called by API clients when they receive a 401 from the PBX or workflow engine,
 * and by AuthExpiryWatcher when the PBX JWT hits its `exp` claim.
 *
 * Three session shapes exist, and each wants different behaviour on expiry:
 *   1. Normal org user (pbx_org_token, no admin key) — full logout: clear
 *      local state, signOut of Firebase, redirect to login.
 *   2. Admin impersonating an org (admin key + org_access.impersonating=true
 *      + pbx_org_token) — clear only the impersonation state and bounce back
 *      to /dashboard so the admin lands on the org picker and can re-enter.
 *      Do NOT signOut of Firebase and do NOT clear the gateway/admin key —
 *      the admin's Firebase session is still valid.
 *   3. Pure admin session on /dashboard (admin key, no JWT) — swallow the
 *      401. Admin auth uses a long-lived gateway key, not a JWT, so expiry
 *      does not apply; a transient 401 from a PBX call should not kick them
 *      out of the admin panel.
 *
 * Guarded against re-entry / redirect loops via a module-level flag and a
 * pathname check.
 */
let _unauthorizedHandling = false;
export function handleUnauthorized(reason: string = "401") {
  if (typeof window === "undefined") return;
  if (_unauthorizedHandling) return;

  const hasAdminKey = !!localStorage.getItem("gateway_admin_key") || !!localStorage.getItem("admin_key");
  const hasJwt = !!localStorage.getItem("pbx_org_token") || !!localStorage.getItem("org_token");

  // Case 2: admin impersonating — clear impersonation state only, keep the
  // Firebase admin session and the gateway admin key intact.
  if (isImpersonatingAdmin()) {
    _unauthorizedHandling = true;
    try {
      localStorage.removeItem("pbx_org_token");
      localStorage.removeItem("pbx_org_token_exp");
      localStorage.removeItem("pbx_api_key");
      localStorage.removeItem("org_access");
      localStorage.removeItem("user_role");
      localStorage.removeItem("user_permissions");
    } catch {}
    console.warn("[auth] Impersonation session expired (" + reason + "), returning to admin dashboard");
    const path = window.location.pathname;
    if (path === "/dashboard" || path === "/dashboard/") {
      setTimeout(() => { _unauthorizedHandling = false; }, 100);
    } else {
      window.location.href = "/dashboard";
    }
    return;
  }

  // Case 3: pure admin session (admin key, no JWT) — don't kick on transient 401.
  if (hasAdminKey && !hasJwt) {
    console.warn("[auth] 401 ignored — admin session protected (" + reason + ")");
    return;
  }

  // Case 1: normal org user — full logout.
  _unauthorizedHandling = true;
  try {
    useAuthStore.getState().logout();
    // Sign out from Firebase. The global onAuthStateChanged listener in
    // lib/firebase/config.ts will auto re-sign-in with admin creds for
    // Firestore access, but the user's PBX JWT is gone — they have to
    // re-enter their email/password to get a fresh PBX token.
    unifiedSignOut().catch((err) => console.warn("[auth] signOut failed:", err?.code || err));
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

/**
 * Force a full admin logout once the 24h admin session window elapses.
 * Clears every auth key (including the gateway admin key), signs out of
 * Firebase so the admin must re-enter email+password, and redirects to
 * /dashboard. Called from AuthExpiryWatcher when the admin-session timer
 * fires.
 */
export function handleAdminSessionExpiry(reason: string = "admin-session-exp") {
  if (typeof window === "undefined") return;
  if (_unauthorizedHandling) return;
  _unauthorizedHandling = true;

  try {
    useAuthStore.getState().logout();
    unifiedSignOut().catch((err) => console.warn("[auth] signOut failed:", err?.code || err));
  } catch (e) {
    console.warn("[auth] handleAdminSessionExpiry cleanup failed:", e);
  }

  console.warn("[auth] Admin session expired after 24h (" + reason + "), forcing full logout");
  // Always navigate — even if we're already on /dashboard the assignment
  // triggers a fresh page load, and the remount sees no admin key so no
  // new timer is scheduled (no loop).
  window.location.href = "/dashboard";
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
      localStorage.removeItem("pbx_org_token_exp");
      localStorage.removeItem("admin_session_start");
      localStorage.removeItem("user_role");
      localStorage.removeItem("user_permissions");
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
