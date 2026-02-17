import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { FirebaseError, UseFirestoreReturn, FirestoreDoc } from "../types/firebase";

/**
 * Real-time document listener hook
 *
 * @param collectionName - Firestore collection path
 * @param documentId - Document ID to listen to (null/undefined to skip)
 * @returns { data, loading, error }
 *
 * @example
 * // Listen to a specific user profile
 * const { data: profile, loading, error } = useDocument<UserProfile>("users", user?.uid);
 *
 * @example
 * // Conditional fetching - won't subscribe if todoId is undefined
 * const { data: todo } = useDocument<Todo>("todos", todoId);
 */
export function useDocument<T extends FirestoreDoc>(
  collectionName: string,
  documentId: string | null | undefined
): UseFirestoreReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FirebaseError | null>(null);

  useEffect(() => {
    // Skip subscription if no document ID
    if (!documentId) {
      setData(null);
      setLoading(false);
      return;
    }

    const docRef = doc(db, collectionName, documentId);

    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setData({
            id: snapshot.id,
            ...snapshot.data(),
          } as T);
        } else {
          setData(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError({
          code: err.code || "unknown",
          message: err.message || "Failed to fetch document",
        });
        setLoading(false);
      }
    );

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [collectionName, documentId]);

  return { data, loading, error };
}
