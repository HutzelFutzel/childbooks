/**
 * Firebase-backed storage adapter (Phase 2).
 *
 * Implements the {@link StorageBackend} port against the signed-in user's
 * private space:
 *   - KV docs → Firestore at `users/{uid}/store/{key}` (value JSON-encoded in a
 *     string field, so nested arrays like mask polygons survive — Firestore
 *     can't store nested arrays natively).
 *   - Blobs   → Firebase Storage at `users/{uid}/blobs/{id}`.
 *
 * The target uid is resolved per call from the Auth SDK, so this single backend
 * instance always points at the current user (guest-first guarantees one).
 * When signed out, reads return empty and writes throw — callers gate work on
 * the auth state.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import {
  deleteObject,
  getBlob,
  ref,
  uploadBytes,
} from "firebase/storage";
import { getFirebaseAuth, getFirebaseDb, getFirebaseStorage } from "../lib/firebase";
import type { BlobStore, KeyValueStore, StorageBackend } from "../core/storage/types";

function currentUid(): string | null {
  try {
    return getFirebaseAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

function requireUid(): string {
  const uid = currentUid();
  if (!uid) throw new Error("Not signed in: storage operation requires authentication.");
  return uid;
}

/** Firestore doc id for a KV key (encoded so any key is a valid id). */
function docId(key: string): string {
  return encodeURIComponent(key);
}

interface KvDoc {
  key: string;
  json: string;
  updatedAt: number;
}

const firestoreKv: KeyValueStore = {
  async get<T>(key: string): Promise<T | null> {
    const uid = currentUid();
    if (!uid) return null;
    const snap = await getDoc(doc(getFirebaseDb(), `users/${uid}/store`, docId(key)));
    if (!snap.exists()) return null;
    const data = snap.data() as KvDoc;
    try {
      return JSON.parse(data.json) as T;
    } catch {
      return null;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    const uid = requireUid();
    const payload: KvDoc = { key, json: JSON.stringify(value), updatedAt: Date.now() };
    await setDoc(doc(getFirebaseDb(), `users/${uid}/store`, docId(key)), payload);
  },

  async remove(key: string): Promise<void> {
    const uid = requireUid();
    await deleteDoc(doc(getFirebaseDb(), `users/${uid}/store`, docId(key)));
  },

  async keys(): Promise<string[]> {
    const uid = currentUid();
    if (!uid) return [];
    const snap = await getDocs(collection(getFirebaseDb(), `users/${uid}/store`));
    return snap.docs.map((d) => (d.data() as KvDoc).key);
  },
};

function blobRef(uid: string, id: string) {
  return ref(getFirebaseStorage(), `users/${uid}/blobs/${id}`);
}

const firestoreBlobs: BlobStore = {
  async put(id: string, data: Blob): Promise<void> {
    const uid = requireUid();
    await uploadBytes(blobRef(uid, id), data, {
      contentType: data.type || "application/octet-stream",
    });
  },

  async get(id: string): Promise<Blob | null> {
    const uid = currentUid();
    if (!uid) return null;
    try {
      return await getBlob(blobRef(uid, id));
    } catch (err) {
      if ((err as { code?: string })?.code === "storage/object-not-found") return null;
      throw err;
    }
  },

  async remove(id: string): Promise<void> {
    const uid = requireUid();
    try {
      await deleteObject(blobRef(uid, id));
    } catch (err) {
      if ((err as { code?: string })?.code === "storage/object-not-found") return;
      throw err;
    }
  },
};

export const firebaseStorage: StorageBackend = { kv: firestoreKv, blobs: firestoreBlobs };
