import type { User } from "firebase/auth";
import type { Timestamp } from "firebase/firestore";

/**
 * Base interface for Firestore documents with ID
 * Uses Firestore Timestamp type for date fields (has toMillis() method)
 */
export interface FirestoreDoc {
  id: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * Firebase error with code and message
 */
export interface FirebaseError {
  code: string;
  message: string;
}

/**
 * Auth state for context providers
 */
export interface AuthState {
  user: User | null;
  loading: boolean;
  error: FirebaseError | null;
}

/**
 * Auth context value with methods
 */
export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

/**
 * Firestore query constraint for typed queries
 */
export type QueryConstraintType =
  | ReturnType<typeof import("firebase/firestore").where>
  | ReturnType<typeof import("firebase/firestore").orderBy>
  | ReturnType<typeof import("firebase/firestore").limit>;

/**
 * Hook return type for real-time data
 */
export interface UseFirestoreReturn<T> {
  data: T | null;
  loading: boolean;
  error: FirebaseError | null;
}

/**
 * Hook return type for real-time collections
 */
export interface UseCollectionReturn<T> {
  data: T[];
  loading: boolean;
  error: FirebaseError | null;
}
