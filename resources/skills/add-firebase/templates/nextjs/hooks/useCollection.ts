"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  onSnapshot,
  type QueryConstraint,
} from "firebase/firestore";
import { getClientDb } from "../lib/firebase-client";
import type { FirebaseError, UseCollectionReturn, FirestoreDoc } from "../types/firebase";

interface UseCollectionOptions {
  /** Sort results client-side by a field (avoids needing composite indexes) */
  sortBy?: {
    field: keyof FirestoreDoc | string;
    direction: "asc" | "desc";
  };
}

/**
 * Real-time collection listener hook (client-side)
 *
 * @param collectionName - Firestore collection path
 * @param constraints - Optional query constraints (where, limit). Avoid using orderBy with where on different fields.
 * @param options - Optional settings like client-side sorting
 * @returns { data, loading, error }
 *
 * @example
 * // Get all todos for current user, sorted client-side (no composite index needed)
 * const { data: todos, loading, error } = useCollection<Todo>(
 *   "todos",
 *   [where("userId", "==", user.uid), limit(50)],
 *   { sortBy: { field: "createdAt", direction: "desc" } }
 * );
 */
export function useCollection<T extends FirestoreDoc>(
  collectionName: string,
  constraints: QueryConstraint[] = [],
  options: UseCollectionOptions = {}
): UseCollectionReturn<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirebaseError | null>(null);

  useEffect(() => {
    const db = getClientDb();
    if (!db) {
      setLoading(false);
      return;
    }

    const collectionRef = collection(db, collectionName);
    const q = constraints.length > 0 ? query(collectionRef, ...constraints) : query(collectionRef);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as T[];

        // Client-side sorting (avoids needing composite indexes in Firestore)
        if (options.sortBy) {
          const { field, direction } = options.sortBy;
          docs = docs.sort((a, b) => {
            const aVal = (a as Record<string, unknown>)[field];
            const bVal = (b as Record<string, unknown>)[field];
            // Handle Firestore Timestamp objects
            const aTime = aVal && typeof aVal === "object" && "toMillis" in aVal
              ? (aVal as { toMillis: () => number }).toMillis()
              : aVal;
            const bTime = bVal && typeof bVal === "object" && "toMillis" in bVal
              ? (bVal as { toMillis: () => number }).toMillis()
              : bVal;
            if (aTime === bTime) return 0;
            if (aTime === undefined || aTime === null) return 1;
            if (bTime === undefined || bTime === null) return -1;
            const comparison = aTime < bTime ? -1 : 1;
            return direction === "desc" ? -comparison : comparison;
          });
        }

        setData(docs);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError({
          code: err.code || "unknown",
          message: err.message || "Failed to fetch collection",
        });
        setLoading(false);
      }
    );

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [collectionName, JSON.stringify(constraints), JSON.stringify(options)]);

  return { data, loading, error };
}
