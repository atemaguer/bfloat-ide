import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Client-side Firebase instances
let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

/**
 * Get Firebase app instance (client-side only)
 * Safe to call during SSR - returns undefined on server
 */
function getApp(): FirebaseApp | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!app) {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  }

  return app;
}

/**
 * Get Firebase Auth instance (client-side only)
 */
function getClientAuth(): Auth | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!auth) {
    const firebaseApp = getApp();
    if (firebaseApp) {
      auth = getAuth(firebaseApp);
    }
  }

  return auth;
}

/**
 * Get Firestore instance (client-side only)
 */
function getClientDb(): Firestore | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!db) {
    const firebaseApp = getApp();
    if (firebaseApp) {
      db = getFirestore(firebaseApp);
    }
  }

  return db;
}

/**
 * Get Firebase Storage instance (client-side only)
 */
function getClientStorage(): FirebaseStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!storage) {
    const firebaseApp = getApp();
    if (firebaseApp) {
      storage = getStorage(firebaseApp);
    }
  }

  return storage;
}

export { getApp, getClientAuth, getClientDb, getClientStorage };

// For convenience, also export direct instances (ensure client-side use only)
export const clientAuth = typeof window !== "undefined" ? getClientAuth() : undefined;
export const clientDb = typeof window !== "undefined" ? getClientDb() : undefined;
export const clientStorage = typeof window !== "undefined" ? getClientStorage() : undefined;
