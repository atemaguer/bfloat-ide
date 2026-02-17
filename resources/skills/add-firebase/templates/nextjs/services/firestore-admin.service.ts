import { getAdminDb } from "../lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { FirestoreDoc } from "../types/firebase";

/**
 * Create a typed Firestore service for server-side operations
 *
 * @param collectionName - Firestore collection path
 * @returns Service object with CRUD methods
 *
 * @example
 * // In an API Route or Server Component
 * interface Todo extends FirestoreDoc {
 *   title: string;
 *   completed: boolean;
 *   userId: string;
 * }
 *
 * const todosService = createAdminFirestoreService<Todo>("todos");
 *
 * // Create
 * const id = await todosService.add({ title: "Buy milk", completed: false, userId });
 *
 * // Read one
 * const todo = await todosService.get(id);
 *
 * // Read many
 * const userTodos = await todosService.query("userId", "==", userId);
 *
 * // Update
 * await todosService.update(id, { completed: true });
 *
 * // Delete
 * await todosService.delete(id);
 */
export function createAdminFirestoreService<T extends FirestoreDoc>(collectionName: string) {
  const getCollection = () => {
    const db = getAdminDb();
    return db.collection(collectionName);
  };

  return {
    /**
     * Add a new document to the collection
     * Automatically adds createdAt timestamp
     * @returns The new document ID
     */
    async add(data: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<string> {
      const docRef = await getCollection().add({
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return docRef.id;
    },

    /**
     * Get a single document by ID
     * @returns The document data or null if not found
     */
    async get(id: string): Promise<T | null> {
      const snapshot = await getCollection().doc(id).get();

      if (!snapshot.exists) {
        return null;
      }

      return {
        id: snapshot.id,
        ...snapshot.data(),
      } as T;
    },

    /**
     * Get all documents in the collection
     * @returns Array of documents
     */
    async getAll(): Promise<T[]> {
      const snapshot = await getCollection().get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as T[];
    },

    /**
     * Query documents with a single condition
     * @param field - Field to query
     * @param operator - Comparison operator
     * @param value - Value to compare against
     * @returns Array of matching documents
     */
    async query(
      field: string,
      operator: FirebaseFirestore.WhereFilterOp,
      value: unknown
    ): Promise<T[]> {
      const snapshot = await getCollection().where(field, operator, value).get();

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
      await getCollection().doc(id).update({
        ...data,
        updatedAt: FieldValue.serverTimestamp(),
      });
    },

    /**
     * Delete a document by ID
     */
    async delete(id: string): Promise<void> {
      await getCollection().doc(id).delete();
    },
  };
}
