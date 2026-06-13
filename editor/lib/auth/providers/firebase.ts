/**
 * Firebase auth provider.
 *
 * Only loaded/initialised when NEXT_PUBLIC_USE_FIREBASE=true (the
 * selector in `lib/auth/index.ts` picks this vs the local provider).
 * Wraps the existing `lib/firebase/config.ts` Firebase Auth instance.
 */

import {
  onAuthStateChanged as fbOnAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from "firebase/auth";

import { auth as firebaseAuth } from "@/lib/firebase/config";

import type { AuthProvider, AuthUser, SignInCredentials } from "../types";

function mapFirebaseUser(u: { uid: string; email: string | null } | null): AuthUser | null {
  if (!u) return null;
  return { uid: u.uid, email: u.email || undefined };
}

export const firebaseProvider: AuthProvider = {
  async signIn(credentials: SignInCredentials) {
    if (!credentials.email || !credentials.password) {
      throw new Error("Firebase mode requires email + password");
    }
    if (!firebaseAuth) {
      throw new Error("Firebase auth is not initialised — check NEXT_PUBLIC_FIREBASE_* env vars");
    }
    const cred = await signInWithEmailAndPassword(
      firebaseAuth,
      credentials.email,
      credentials.password
    );
    return {
      user: { uid: cred.user.uid, email: cred.user.email || undefined },
    };
  },

  async signOut() {
    if (!firebaseAuth) return;
    await fbSignOut(firebaseAuth);
  },

  onAuthStateChanged(callback) {
    if (!firebaseAuth) {
      // No-op subscription; immediately notify with null state.
      queueMicrotask(() => callback(null));
      return () => {};
    }
    return fbOnAuthStateChanged(firebaseAuth, (u) =>
      callback(mapFirebaseUser(u as { uid: string; email: string | null } | null))
    );
  },

  getCurrentUser() {
    if (!firebaseAuth) return null;
    return mapFirebaseUser(
      firebaseAuth.currentUser as { uid: string; email: string | null } | null
    );
  },
};
