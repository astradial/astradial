/**
 * Shared types for the auth abstraction.
 */

export interface AuthUser {
  /**
   * Provider-specific user identifier:
   * - Firebase mode: the Firebase UID
   * - Local mode: the organisation id (api_key + api_secret authenticate
   *   the org as a whole; per-user identity is layered on top via the
   *   user-management endpoints, not at the auth login step).
   */
  uid: string;

  /** User email if known (Firebase) or undefined (local-mode org login). */
  email?: string;

  /** Organisation id once the user has selected/joined an org. */
  orgId?: string;
  orgName?: string;

  /** Role within the org (admin/owner/manager/agent). */
  role?: string;
}

export interface SignInCredentials {
  /** Firebase mode */
  email?: string;
  password?: string;

  /** Local mode */
  apiKey?: string;
  apiSecret?: string;
}

export interface AuthResult {
  user: AuthUser;
  /** JWT for the API. Set by both providers — local generates it from
   *  /api/v1/auth/login, Firebase obtains it from the email-login
   *  exchange downstream. */
  token?: string;
}

export interface AuthProvider {
  /** Sign in with the given credentials. Throws on failure. */
  signIn(credentials: SignInCredentials): Promise<AuthResult>;

  /** Sign out current user, clear local state. */
  signOut(): Promise<void>;

  /**
   * Subscribe to auth state changes. Returns an unsubscribe function.
   * Should call the callback with the current state shortly after
   * subscription (initial state).
   */
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void;

  /** Synchronous current user (best-effort, from local cache). */
  getCurrentUser(): AuthUser | null;
}
