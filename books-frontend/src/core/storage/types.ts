/**
 * Storage interfaces. The app is local-first (no database yet): small JSON
 * documents go in a key-value store, large binary assets (generated images)
 * go in a blob store. Platform adapters implement these.
 */
import type { BlobSize } from "./blobVariants";

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  /**
   * Fetch all stored values whose key starts with `prefix` in a single query.
   * Optional — backends without range queries fall back to `keys()` + `get()`.
   */
  listByPrefix?<T>(prefix: string): Promise<T[]>;
  /**
   * Atomically read-modify-write a key inside a backend transaction. The mutator
   * receives the currently-stored value (or null) and returns the value to
   * persist; returning the previous value unchanged is a no-op. Guarantees the
   * write is based on the freshest committed state, so concurrent writers can't
   * silently clobber each other. Optional — backends without transactions omit
   * it, and callers fall back to {@link set}.
   */
  update?<T>(key: string, mutator: (prev: T | null) => T): Promise<T>;
}

export interface BlobStore {
  put(id: string, data: Blob): Promise<void>;
  /**
   * Read a picture at a size. `master` (the default) is the original bytes; a
   * smaller size resolves to null when no copy of that size has been made, and
   * the caller decides what to do instead (see `state/blobs.ts`).
   */
  get(id: string, size?: BlobSize): Promise<Blob | null>;
  /** Remove a picture and every smaller copy made from it. */
  remove(id: string): Promise<void>;
}

export interface StorageBackend {
  kv: KeyValueStore;
  blobs: BlobStore;
}
