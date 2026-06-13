/**
 * Unified auth abstraction — selects between Firebase and local (API
 * key + API secret) providers based on the NEXT_PUBLIC_USE_FIREBASE
 * env var.
 *
 * Why this exists: the Astradial Editor was originally written
 * Firebase-first. Self-hosted OSS deployments don't want a Firebase
 * project as a hard prerequisite, so the local provider authenticates
 * against the API's existing `POST /api/v1/auth/login` route which
 * exchanges an organisation's `api_key` + `api_secret` (bcrypt-verified
 * server-side) for a JWT.
 *
 * Set `NEXT_PUBLIC_USE_FIREBASE=true` to use the Firebase provider
 * (requires the NEXT_PUBLIC_FIREBASE_* env vars), unset or "false" to
 * use the local provider (only NEXT_PUBLIC_PBX_URL needed).
 */

import { firebaseProvider } from "./providers/firebase";
import { localProvider } from "./providers/local";
import type { AuthProvider } from "./types";

export const USE_FIREBASE = (process.env.NEXT_PUBLIC_USE_FIREBASE || "").toLowerCase() === "true";

export const auth: AuthProvider = USE_FIREBASE ? firebaseProvider : localProvider;

export type { AuthProvider, AuthResult, AuthUser, SignInCredentials } from "./types";
