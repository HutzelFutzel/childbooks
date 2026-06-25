/**
 * Browser storage adapter: localStorage for JSON, IndexedDB (via idb) for blobs.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { BlobStore, KeyValueStore, StorageBackend } from "../core/storage/types";

const KV_PREFIX = "childbooks:";
const DB_NAME = "childbooks";
const BLOB_STORE = "blobs";

const webKv: KeyValueStore = {
  async get<T>(key: string): Promise<T | null> {
    const raw = localStorage.getItem(KV_PREFIX + key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(KV_PREFIX + key, JSON.stringify(value));
  },
  async remove(key: string): Promise<void> {
    localStorage.removeItem(KV_PREFIX + key);
  },
  async keys(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KV_PREFIX)) out.push(k.slice(KV_PREFIX.length));
    }
    return out;
  },
};

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          db.createObjectStore(BLOB_STORE);
        }
      },
    });
  }
  return dbPromise;
}

const webBlobs: BlobStore = {
  async put(id: string, data: Blob): Promise<void> {
    const db = await getDb();
    await db.put(BLOB_STORE, data, id);
  },
  async get(id: string): Promise<Blob | null> {
    const db = await getDb();
    return (await db.get(BLOB_STORE, id)) ?? null;
  },
  async remove(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(BLOB_STORE, id);
  },
};

export const webStorage: StorageBackend = { kv: webKv, blobs: webBlobs };
