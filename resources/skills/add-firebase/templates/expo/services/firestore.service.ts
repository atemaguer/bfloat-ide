import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  serverTimestamp,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { FirestoreDoc } from "../types/firebase";

/**
 * Create a typed Firestore service for a collection
 *
 * @param collectionName - Firestore collection path
 * @returns Service object with CRUD methods
 *
 * @example
 * interface Todo extends FirestoreDoc {
 *   title: string;
 *   completed: boolean;
 *   userId: string;
 * }
 *
 * const todosService = createFirestoreService<Todo>("todos");
 *
 * // Create
 * const id = await todosService.add({ title: "Buy milk", completed: false, userId: user.uid });
 *
 * // Read one
 * const todo = await todosService.get(id);
 *
 * // Read many with query
 * const userTodos = await todosService.getAll([
 *   where("userId", "==", user.uid),
 *   orderBy("createdAt", "desc")
 * ]);
 *
 * // Update
 * await todosService.update(id, { completed: true });
 *
 * // Delete
 * await todosService.delete(id);
 */
export function createFirestoreService<T extends FirestoreDoc>(collectionName: string) {
  const collectionRef = collection(db, collectionName);

  return {
    /**
     * Add a new document to the collection
     * Automatically adds createdAt timestamp
     * @returns The new document ID
     */
    async add(data: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<string> {
      const docRef = await addDoc(collectionRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    },

    /**
     * Get a single document by ID
     * @returns The document data or null if not found
     */
    async get(id: string): Promise<T | null> {
      const docRef = doc(db, collectionName, id);
      const snapshot = await getDoc(docRef);

      if (!snapshot.exists()) {
        return null;
      }

      return {
        id: snapshot.id,
        ...snapshot.data(),
      } as T;
    },

    /**
     * Get all documents matching the query constraints
     * @param constraints - Optional array of where, orderBy, limit clauses
     * @returns Array of documents
     */
    async getAll(constraints: QueryConstraint[] = []): Promise<T[]> {
      const q = constraints.length > 0 ? query(collectionRef, ...constraints) : query(collectionRef);
      const snapshot = await getDocs(q);

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as T[];
    },

    /**
     * Update a document by ID
     * Automatically updates the updatedAt timestamp
     */
    async update(id: string, data: Partial<Omit<T, "id" | "createdAt">>): Promise<void> {
      const docRef = doc(db, collectionName, id);
      await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });
    },

    /**
     * Delete a document by ID
     */
    async delete(id: string): Promise<void> {
      const docRef = doc(db, collectionName, id);
      await deleteDoc(docRef);
    },
  };
}
