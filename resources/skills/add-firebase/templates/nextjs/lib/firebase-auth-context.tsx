"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  type User,
} from "firebase/auth";
import { getClientAuth } from "./firebase-client";
import type { AuthContextValue, FirebaseError } from "../types/firebase";

const AuthContext = createContext<AuthContextValue | null>(null);

// Token refresh interval (10 minutes)
const TOKEN_REFRESH_INTERVAL = 10 * 60 * 1000;

/**
 * Map Firebase error codes to user-friendly messages
 */
function getErrorMessage(error: unknown): FirebaseError {
  const firebaseError = error as { code?: string; message?: string };
  const code = firebaseError.code || "unknown";

  const errorMessages: Record<string, string> = {
    "auth/email-already-in-use": "This email is already registered",
    "auth/invalid-email": "Invalid email address",
    "auth/operation-not-allowed": "Email/password accounts are not enabled",
    "auth/weak-password": "Password should be at least 6 characters",
    "auth/user-disabled": "This account has been disabled",
    "auth/user-not-found": "No account found with this email",
    "auth/wrong-password": "Incorrect password",
    "auth/invalid-credential": "Invalid email or password",
    "auth/too-many-requests": "Too many attempts. Please try again later",
    "auth/network-request-failed": "Network error. Check your connection",
  };

  return {
    code,
    message: errorMessages[code] || firebaseError.message || "An error occurred",
  };
}

/**
 * Sync auth token with server session
 */
async function syncSessionWithServer(user: User | null): Promise<void> {
  try {
    if (user) {
      const token = await user.getIdToken();
      await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } else {
      await fetch("/api/auth/session", { method: "DELETE" });
    }
  } catch (error) {
    console.error("Failed to sync session with server:", error);
  }
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirebaseError | null>(null);

  useEffect(() => {
    const auth = getClientAuth();
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        setUser(user);
        setLoading(false);
        setError(null);

        // Sync session with server
        await syncSessionWithServer(user);
      },
      (err) => {
        setError(getErrorMessage(err));
        setLoading(false);
      }
    );

    // Refresh token every 10 minutes to keep session alive
    const refreshInterval = setInterval(async () => {
      const currentUser = auth.currentUser;
      if (currentUser) {
        try {
          const token = await currentUser.getIdToken(true);
          await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
        } catch (error) {
          console.error("Token refresh failed:", error);
        }
      }
    }, TOKEN_REFRESH_INTERVAL);

    return () => {
      unsubscribe();
      clearInterval(refreshInterval);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const auth = getClientAuth();
    if (!auth) throw new Error("Firebase auth not initialized");

    try {
      setError(null);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const firebaseError = getErrorMessage(err);
      setError(firebaseError);
      throw firebaseError;
    }
  };

  const signUp = async (email: string, password: string) => {
    const auth = getClientAuth();
    if (!auth) throw new Error("Firebase auth not initialized");

    try {
      setError(null);
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const firebaseError = getErrorMessage(err);
      setError(firebaseError);
      throw firebaseError;
    }
  };

  const signOut = async () => {
    const auth = getClientAuth();
    if (!auth) throw new Error("Firebase auth not initialized");

    try {
      setError(null);
      await firebaseSignOut(auth);
    } catch (err) {
      const firebaseError = getErrorMessage(err);
      setError(firebaseError);
      throw firebaseError;
    }
  };

  const resetPassword = async (email: string) => {
    const auth = getClientAuth();
    if (!auth) throw new Error("Firebase auth not initialized");

    try {
      setError(null);
      await sendPasswordResetEmail(auth, email);
    } catch (err) {
      const firebaseError = getErrorMessage(err);
      setError(firebaseError);
      throw firebaseError;
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, error, signIn, signUp, signOut, resetPassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
