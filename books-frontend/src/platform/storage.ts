/**
 * Storage backend accessor.
 *
 * Phase 2: persistence is Firebase-backed (Firestore for JSON, Firebase Storage
 * for blobs), scoped to the signed-in user. The repositories depend only on the
 * {@link StorageBackend} port, so they're unchanged. The backend resolves the
 * current uid per operation, so a single instance follows the active user.
 */
import type { StorageBackend } from "../core/storage/types";
import { firebaseStorage } from "./storage-firebase";

export function getStorage(): Promise<StorageBackend> {
  return Promise.resolve(firebaseStorage);
}
