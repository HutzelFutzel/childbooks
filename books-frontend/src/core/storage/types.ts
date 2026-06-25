/**
 * Storage interfaces. The app is local-first (no database yet): small JSON
 * documents go in a key-value store, large binary assets (generated images)
 * go in a blob store. Platform adapters implement these.
 */

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface BlobStore {
  put(id: string, data: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  remove(id: string): Promise<void>;
}

export interface StorageBackend {
  kv: KeyValueStore;
  blobs: BlobStore;
}
