/**
 * Tauri storage adapter: plugin-store for JSON, plugin-fs for blobs
 * (written under the app local data directory).
 */
import type { BlobStore, KeyValueStore, StorageBackend } from "../core/storage/types";

const STORE_FILE = "childbooks.json";
const BLOB_DIR = "blobs";

// Lazily import the plugins so the web bundle never pulls them in at module load.
async function getStore() {
  const { load } = await import("@tauri-apps/plugin-store");
  return load(STORE_FILE);
}

const tauriKv: KeyValueStore = {
  async get<T>(key: string): Promise<T | null> {
    const store = await getStore();
    const value = await store.get<T>(key);
    return value ?? null;
  },
  async set<T>(key: string, value: T): Promise<void> {
    const store = await getStore();
    await store.set(key, value);
    await store.save();
  },
  async remove(key: string): Promise<void> {
    const store = await getStore();
    await store.delete(key);
    await store.save();
  },
  async keys(): Promise<string[]> {
    const store = await getStore();
    return store.keys();
  },
};

async function fsApi() {
  const fs = await import("@tauri-apps/plugin-fs");
  return fs;
}

async function ensureBlobDir(fs: Awaited<ReturnType<typeof fsApi>>): Promise<void> {
  const exists = await fs.exists(BLOB_DIR, { baseDir: fs.BaseDirectory.AppLocalData });
  if (!exists) {
    await fs.mkdir(BLOB_DIR, {
      baseDir: fs.BaseDirectory.AppLocalData,
      recursive: true,
    });
  }
}

const tauriBlobs: BlobStore = {
  async put(id: string, data: Blob): Promise<void> {
    const fs = await fsApi();
    await ensureBlobDir(fs);
    const bytes = new Uint8Array(await data.arrayBuffer());
    await fs.writeFile(`${BLOB_DIR}/${id}`, bytes, {
      baseDir: fs.BaseDirectory.AppLocalData,
    });
  },
  async get(id: string): Promise<Blob | null> {
    const fs = await fsApi();
    const path = `${BLOB_DIR}/${id}`;
    const exists = await fs.exists(path, { baseDir: fs.BaseDirectory.AppLocalData });
    if (!exists) return null;
    const bytes = await fs.readFile(path, { baseDir: fs.BaseDirectory.AppLocalData });
    return new Blob([bytes as BlobPart]);
  },
  async remove(id: string): Promise<void> {
    const fs = await fsApi();
    const path = `${BLOB_DIR}/${id}`;
    const exists = await fs.exists(path, { baseDir: fs.BaseDirectory.AppLocalData });
    if (exists) await fs.remove(path, { baseDir: fs.BaseDirectory.AppLocalData });
  },
};

export const tauriStorage: StorageBackend = { kv: tauriKv, blobs: tauriBlobs };
