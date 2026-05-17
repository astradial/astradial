/**
 * Firebase client init — only happens when NEXT_PUBLIC_USE_FIREBASE=true.
 *
 * In OSS-native mode (USE_FIREBASE=false / unset), this file exports
 * `auth` and `db` as null. Callers MUST null-check before using either,
 * OR use the unified `lib/auth` abstraction instead (preferred).
 *
 * If you're writing new code, import from `@/lib/auth` and never touch
 * Firebase directly.
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  type Auth,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export const USE_FIREBASE =
  (process.env.NEXT_PUBLIC_USE_FIREBASE || "").toLowerCase() === "true";

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

if (USE_FIREBASE) {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  // Tolerate missing env — log + skip rather than crash the whole bundle.
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    _app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    _db = getFirestore(_app);
    _auth = getAuth(_app);

    // Auto sign in with Firebase admin credentials for Firestore access.
    // This is the legacy shared-account pattern from the hosted product;
    // remove once Firestore reads migrate to the API.
    const FB_EMAIL = process.env.NEXT_PUBLIC_FB_AUTH_EMAIL;
    const FB_PASS = process.env.NEXT_PUBLIC_FB_AUTH_PASS;

    if (typeof window !== "undefined") {
      onAuthStateChanged(_auth, (user) => {
        if (!user && FB_EMAIL && FB_PASS) {
          signInWithEmailAndPassword(_auth!, FB_EMAIL, FB_PASS).catch((err) => {
            console.error("Firebase auth failed:", err.code);
          });
        }
      });
    }
  } else if (typeof window !== "undefined") {
    console.warn(
      "[firebase/config] USE_FIREBASE=true but NEXT_PUBLIC_FIREBASE_API_KEY / PROJECT_ID missing — Firebase disabled.",
    );
  }
}

/** Firebase Auth instance, or null when USE_FIREBASE=false or env vars missing. */
export const auth: Auth | null = _auth;

/** Firestore instance, or null when USE_FIREBASE=false or env vars missing. */
export const db: Firestore | null = _db;
