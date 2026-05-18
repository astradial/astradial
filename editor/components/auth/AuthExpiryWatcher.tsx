"use client";

import { useEffect } from "react";
import {
  handleUnauthorized,
  handleAdminSessionExpiry,
  getJwtExpiryMs,
  getAdminSessionExpiryMs,
} from "@/lib/auth/authStore";

/**
 * Client-side session expiry watchdog.
 *
 * Schedules two setTimeouts:
 *   1. PBX JWT expiry — 24h server-side `exp` claim, for org users and
 *      admin-impersonated sessions. Fires handleUnauthorized(), which
 *      distinguishes normal-user logout from impersonation cleanup.
 *   2. Admin session expiry — 24h client-side policy from the
 *      `admin_session_start` stamp written at admin login time. Fires
 *      handleAdminSessionExpiry(), which does a full logout (Firebase
 *      signOut + clear gateway key).
 *
 * Also listens to `storage` + `visibilitychange` so:
 *   - A re-login in another tab re-arms both timers here.
 *   - A laptop sleeping past either expiry and waking up still triggers
 *     logout on the first visibility change (setTimeout can drift when
 *     the tab is throttled; the visibility check catches the missed fire).
 *
 * Mount this once in the root layout so it covers every page — admin-only
 * pages (/dashboard org picker), admin-impersonated pages, and normal-user
 * pages all share the same watcher.
 */
const MAX_SETTIMEOUT_MS = 2_000_000_000;

export function AuthExpiryWatcher() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let jwtTimeoutId: number | null = null;
    let adminTimeoutId: number | null = null;

    function clearTimers() {
      if (jwtTimeoutId !== null) {
        window.clearTimeout(jwtTimeoutId);
        jwtTimeoutId = null;
      }
      if (adminTimeoutId !== null) {
        window.clearTimeout(adminTimeoutId);
        adminTimeoutId = null;
      }
    }

    function getJwtExp(): number | null {
      const hasJwt = !!localStorage.getItem("pbx_org_token") || !!localStorage.getItem("org_token");
      if (!hasJwt) return null;
      const expStr = localStorage.getItem("pbx_org_token_exp");
      let exp = expStr ? Number(expStr) : NaN;
      if (!Number.isFinite(exp) || exp <= 0) {
        const token = localStorage.getItem("pbx_org_token") || localStorage.getItem("org_token");
        exp = getJwtExpiryMs(token) ?? NaN;
      }
      return Number.isFinite(exp) ? exp : null;
    }

    function scheduleFromStorage() {
      clearTimers();

      // JWT watcher (org users + admin-impersonation)
      const jwtExp = getJwtExp();
      if (jwtExp !== null) {
        const msUntil = jwtExp - Date.now();
        if (msUntil <= 0) {
          handleUnauthorized("token-exp (already past)");
          return;
        }
        jwtTimeoutId = window.setTimeout(() => {
          handleUnauthorized("token-exp");
        }, Math.min(msUntil, MAX_SETTIMEOUT_MS));
      }

      // Admin session watcher (24h client-side policy). Back-fill
      // `admin_session_start` for admin sessions that predate this
      // feature so they get a fresh 24h window from first observation
      // rather than being kicked out immediately.
      const hasAdminKey = !!localStorage.getItem("gateway_admin_key") || !!localStorage.getItem("admin_key");
      if (hasAdminKey) {
        if (!localStorage.getItem("admin_session_start")) {
          localStorage.setItem("admin_session_start", String(Date.now()));
        }
        const adminExp = getAdminSessionExpiryMs();
        if (adminExp !== null) {
          const msUntil = adminExp - Date.now();
          if (msUntil <= 0) {
            handleAdminSessionExpiry("admin-session-exp (already past)");
            return;
          }
          adminTimeoutId = window.setTimeout(() => {
            handleAdminSessionExpiry("admin-session-exp");
          }, Math.min(msUntil, MAX_SETTIMEOUT_MS));
        }
      }
    }

    function onStorage(e: StorageEvent) {
      const key = e.key;
      if (
        key === null ||
        key === "pbx_org_token_exp" ||
        key === "pbx_org_token" ||
        key === "admin_session_start" ||
        key === "gateway_admin_key" ||
        key === "admin_key"
      ) {
        scheduleFromStorage();
      }
    }

    function onVisibility() {
      if (document.visibilityState !== "visible") return;

      // JWT: check first so impersonation goes through its own cleanup path.
      const jwtExp = getJwtExp();
      if (jwtExp !== null && jwtExp <= Date.now()) {
        handleUnauthorized("token-exp (visibility)");
        return;
      }

      // Admin session: check after JWT so pure admin sessions also get kicked.
      const adminExp = getAdminSessionExpiryMs();
      if (adminExp !== null && adminExp <= Date.now()) {
        handleAdminSessionExpiry("admin-session-exp (visibility)");
        return;
      }

      scheduleFromStorage();
    }

    scheduleFromStorage();
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimers();
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
