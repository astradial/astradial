/**
 * Local (OSS-native) auth provider.
 *
 * Uses `POST /api/v1/auth/login` on the api server — exchanges an
 * organisation's `api_key` + `api_secret` (server-side bcrypt-verified)
 * for a JWT. The token is stored in localStorage under `pbx_org_token`
 * (same key the rest of the editor already expects).
 *
 * No external dependencies (no Firebase project required).
 */

import type {
  AuthProvider,
  AuthResult,
  AuthUser,
  SignInCredentials,
} from "../types";

const TOKEN_KEY = "pbx_org_token";
const USER_KEY = "pbx_local_auth_user";

type Listener = (user: AuthUser | null) => void;
const listeners = new Set<Listener>();

function getUserFromStorage(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function persistUser(user: AuthUser | null, token?: string) {
  if (typeof window === "undefined") return;
  if (user) {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(TOKEN_KEY);
  }
  // Notify all subscribers synchronously after persistence
  for (const l of listeners) {
    try { l(user); } catch { /* ignore listener errors */ }
  }
}

function loginUrl(): string {
  // Always go through the editor's same-origin /api/pbx proxy
  // (rewritten server-side in next.config.ts). Reaching
  // NEXT_PUBLIC_PBX_URL directly from the browser breaks in docker
  // because the env points at http://api:3000 — an internal hostname
  // the browser can't resolve.
  return "/api/pbx/auth/login";
}

export const localProvider: AuthProvider = {
  async signIn(credentials: SignInCredentials): Promise<AuthResult> {
    const apiKey = credentials.apiKey;
    const apiSecret = credentials.apiSecret;
    if (!apiKey || !apiSecret) {
      throw new Error(
        "Local auth mode: api_key and api_secret are required. Find them via the editor admin or the org-creation response.",
      );
    }

    const r = await fetch(loginUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
    });

    if (!r.ok) {
      let detail = "Invalid credentials";
      try {
        const body = await r.json();
        detail = body.error || body.detail || detail;
      } catch { /* body wasn't JSON */ }
      throw new Error(detail);
    }

    const data = await r.json();
    if (!data?.token || !data?.organization?.id) {
      throw new Error("Unexpected response shape from /auth/login");
    }

    const user: AuthUser = {
      uid: data.organization.id,
      orgId: data.organization.id,
      orgName: data.organization.name,
      role: "admin", // api_key/api_secret = org-level auth
    };
    persistUser(user, data.token);
    return { user, token: data.token };
  },

  async signOut() {
    persistUser(null);
  },

  onAuthStateChanged(callback) {
    listeners.add(callback);
    // Emit current state asynchronously so the subscriber can finish
    // setting up before the callback fires (matches Firebase's behaviour).
    queueMicrotask(() => {
      try { callback(getUserFromStorage()); } catch { /* ignore */ }
    });
    return () => {
      listeners.delete(callback);
    };
  },

  getCurrentUser() {
    return getUserFromStorage();
  },
};
