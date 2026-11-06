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
  query,
  runTransaction,
  setDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getBlob,
  ref,
  uploadBytes,
} from "firebase/storage";
import { getFirebaseAuth, getFirebaseDb, getFirebaseStorage } from "../lib/firebase";
import { STORED_BOOK_LIMIT_BYTES } from "../core/storage/bookSize";
import {
  NotSignedInError,
  StoredValueTooLargeError,
  type BlobStore,
  type KeyValueStore,
  type StorageBackend,
} from "../core/storage/types";
import {
  BLOB_VARIANTS,
  IMMUTABLE_BLOB_CACHE_CONTROL,
  blobObjectName,
  type BlobSize,
} from "../core/storage/blobVariants";
import { diskCacheDelete, diskCacheGet, diskCachePut } from "./blobDiskCache";

function currentUid(): string | null {
  try {
    return getFirebaseAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

function requireUid(): string {
  const uid = currentUid();
  if (!uid) throw new NotSignedInError();
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

/**
 * Firestore refuses a document over 1 MiB (1,048,576 bytes, field names and the
 * document path included). Checked here so an oversized book fails as itself,
 * before the network, instead of as a generic write error.
 */
const MAX_JSON_BYTES = STORED_BOOK_LIMIT_BYTES;

/** Below this many characters the exact byte count is not worth computing (well under a quarter of the limit). */
const EXACT_SIZE_FROM_CHARS = 200_000;

interface Encoded {
  doc: KvDoc;
  bytes: number;
}

function encodeValue(key: string, value: unknown): Encoded {
  const json = JSON.stringify(value);
  // A UTF-16 unit is at most 3 UTF-8 bytes, so short strings can't be over.
  let bytes = json.length;
  if (json.length > EXACT_SIZE_FROM_CHARS || json.length * 3 > MAX_JSON_BYTES) {
    bytes = new TextEncoder().encode(json).length;
    if (bytes > MAX_JSON_BYTES) throw new StoredValueTooLargeError(key, bytes, MAX_JSON_BYTES);
  }
  return { doc: { key, json, updatedAt: Date.now() }, bytes };
}

const writeListeners = new Set<(key: string, bytes: number) => void>();

/** Tell listeners how big a value that was just stored is. A listener's failure never reaches the write. */
function wrote(key: string, bytes: number): void {
  for (const listener of writeListeners) {
    try {
      listener(key, bytes);
    } catch {
      // measuring must never break saving
    }
  }
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
    const { doc: encoded, bytes } = encodeValue(key, value);
    await setDoc(doc(getFirebaseDb(), `users/${uid}/store`, docId(key)), encoded);
    wrote(key, bytes);
  },

  async remove(key: string): Promise<void> {
    const uid = requireUid();
    await deleteDoc(doc(getFirebaseDb(), `users/${uid}/store`, docId(key)));
  },

  async update<T>(key: string, mutator: (prev: T | null) => T): Promise<T> {
    const uid = requireUid();
    const ref = doc(getFirebaseDb(), `users/${uid}/store`, docId(key));
    let size = 0;
    const next = await runTransaction(getFirebaseDb(), async (tx) => {
      const snap = await tx.get(ref);
      let prev: T | null = null;
      if (snap.exists()) {
        try {
          prev = JSON.parse((snap.data() as KvDoc).json) as T;
        } catch {
          prev = null;
        }
      }
      const next = mutator(prev);
      const { doc: encoded, bytes } = encodeValue(key, next);
      size = bytes;
      tx.set(ref, encoded);
      return next;
    });
    wrote(key, size);
    return next;
  },

  onWrite(listener) {
    writeListeners.add(listener);
    return () => {
      writeListeners.delete(listener);
    };
  },

  async keys(): Promise<string[]> {
    const uid = currentUid();
    if (!uid) return [];
    const snap = await getDocs(collection(getFirebaseDb(), `users/${uid}/store`));
    return snap.docs.map((d) => (d.data() as KvDoc).key);
  },

  async listByPrefix<T>(prefix: string): Promise<T[]> {
    const uid = currentUid();
    if (!uid) return [];
    const q = query(
      collection(getFirebaseDb(), `users/${uid}/store`),
      where("key", ">=", prefix),
      where("key", "<", `${prefix}\uf8ff`),
    );
    const snap = await getDocs(q);
    const out: T[] = [];
    for (const d of snap.docs) {
      const data = d.data() as KvDoc;
      if (typeof data.key === "string" && data.key.startsWith(prefix)) {
        try {
          out.push(JSON.parse(data.json) as T);
        } catch {
          // skip malformed doc
        }
      }
    }
    return out;
  },
};

function blobRef(uid: string, id: string, size: BlobSize = "master") {
  return ref(getFirebaseStorage(), `users/${uid}/blobs/${blobObjectName(id, size)}`);
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: string })?.code === "storage/object-not-found";
}

const firestoreBlobs: BlobStore = {
  async put(id: string, data: Blob): Promise<void> {
    const uid = requireUid();
    await uploadBytes(blobRef(uid, id), data, {
      contentType: data.type || "application/octet-stream",
      // An id is minted once per stored picture and never rewritten.
      cacheControl: IMMUTABLE_BLOB_CACHE_CONTROL,
    });
  },

  async get(id: string, size: BlobSize = "master"): Promise<Blob | null> {
    const uid = currentUid();
    if (!uid) return null;
    // Only the small copies live on this device's disk; the master is the
    // thing being avoided, and is never worth the space.
    if (size !== "master") {
      const cached = await diskCacheGet(uid, blobObjectName(id, size));
      if (cached) return cached;
    }
    try {
      const blob = await getBlob(blobRef(uid, id, size));
      if (size !== "master") void diskCachePut(uid, blobObjectName(id, size), blob);
      return blob;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  async remove(id: string): Promise<void> {
    const uid = requireUid();
    // The copies go with the picture, or they would sit in the bucket forever.
    // A copy that is already gone (or never made) is the normal case.
    const copies = BLOB_VARIANTS.map(async (variant) => {
      try {
        await deleteObject(blobRef(uid, id, variant));
      } catch {
        // Best effort; an orphaned copy costs a few KB and nothing reads it.
      }
    });
    void diskCacheDelete(
      uid,
      BLOB_VARIANTS.map((variant) => blobObjectName(id, variant)),
    );
    try {
      await deleteObject(blobRef(uid, id));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    } finally {
      await Promise.all(copies);
    }
  },
};

export const firebaseStorage: StorageBackend = { kv: firestoreKv, blobs: firestoreBlobs };
