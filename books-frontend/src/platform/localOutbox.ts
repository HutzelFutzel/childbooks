/**
 * Keeps unsaved book changes in the browser (IndexedDB) until the cloud has them.
 *
 * Every call here is best-effort: no IndexedDB (private mode, an old browser), a full disk or a
 * blocked database must never get in the way of editing, so nothing throws. The rules for what a
 * record means live in `core/storage/outbox.ts`.
 */
import { getFirebaseAuth } from "../lib/firebase";
import type { OutboxRecord, OutboxStore } from "../core/storage/outbox";
import type { Project } from "../core/types";

const DB_NAME = "childbooks-outbox";
const STORE = "books";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ["uid", "projectId"] });
        store.createIndex("uid", "uid", { unique: false });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("outbox database blocked"));
  });
}

/** The records, kept in IndexedDB. Exported for checks that bring their own fake. */
export function createIdbOutbox(dbPromise: () => Promise<IDBDatabase> = openDb): OutboxStore {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () => {
    opened ??= dbPromise().catch((err) => {
      opened = null;
      throw err;
    });
    return opened;
  };
  return {
    async put(record) {
      const conn = await db();
      const tx = conn.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const existing = (await request(store.get([record.uid, record.projectId]))) as OutboxRecord | undefined;
      const base = record.base ?? (existing && existing.baseRev === record.baseRev ? existing.base : undefined);
      store.put({ ...record, ...(base ? { base } : {}) });
      await done(tx);
    },
    async get(uid, projectId) {
      const conn = await db();
      const tx = conn.transaction(STORE, "readonly");
      return ((await request(tx.objectStore(STORE).get([uid, projectId]))) as OutboxRecord | undefined) ?? null;
    },
    async list(uid) {
      const conn = await db();
      const tx = conn.transaction(STORE, "readonly");
      return (await request(tx.objectStore(STORE).index("uid").getAll(uid))) as OutboxRecord[];
    },
    async delete(uid, projectId, upToUpdatedAt) {
      const conn = await db();
      const tx = conn.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const existing = (await request(store.get([uid, projectId]))) as OutboxRecord | undefined;
      if (!existing) return false;
      if (upToUpdatedAt !== undefined && existing.project.updatedAt > upToUpdatedAt) return false;
      store.delete([uid, projectId]);
      await done(tx);
      return true;
    },
    async deleteUser(uid) {
      const conn = await db();
      const tx = conn.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const keys = (await request(store.index("uid").getAllKeys(uid))) as IDBValidKey[];
      for (const key of keys) store.delete(key);
      await done(tx);
    },
  };
}

let store: OutboxStore | null | undefined;
let override: { store: OutboxStore | null; uid: string | null } | null = null;

/** For checks: bring a store and a user instead of IndexedDB and the Auth SDK. Null puts the real ones back. */
export function configureOutbox(next: { store: OutboxStore | null; uid: string | null } | null): void {
  override = next;
}

function outbox(): OutboxStore | null {
  if (override) return override.store;
  if (store !== undefined) return store;
  store = typeof indexedDB === "undefined" ? null : createIdbOutbox();
  return store;
}

function currentUid(): string | null {
  if (override) return override.uid;
  try {
    return getFirebaseAuth().currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

/** Run a call against the outbox for the signed-in user; any failure is swallowed. */
async function withOutbox<T>(fallback: T, run: (outbox: OutboxStore, uid: string) => Promise<T>): Promise<T> {
  try {
    const target = outbox();
    const uid = currentUid();
    if (!target || !uid) return fallback;
    return await run(target, uid);
  } catch {
    return fallback;
  }
}

/** Keep the book as edited, with the cloud copy it came from, until the cloud has it. */
export function rememberUnsaved(project: Project, base: Project | undefined): Promise<void> {
  return withOutbox(undefined, (target, uid) =>
    target.put({
      uid,
      projectId: project.id,
      project,
      ...(base && (base.rev ?? 0) === (project.rev ?? 0) ? { base } : {}),
      baseRev: project.rev ?? 0,
      savedAt: Date.now(),
    }),
  );
}

/** The cloud has the book up to this edit: drop the local copy, unless a newer edit is waiting in it. */
export function forgetSaved(projectId: string, upToUpdatedAt: number): Promise<boolean> {
  return withOutbox(false, (target, uid) => target.delete(uid, projectId, upToUpdatedAt));
}

/** Drop the local copy of one book, whatever it holds (the book was deleted). */
export function forgetBook(projectId: string): Promise<boolean> {
  return withOutbox(false, (target, uid) => target.delete(uid, projectId));
}

/** What this device holds for the signed-in user that the cloud may not have. */
export function pendingRecords(): Promise<OutboxRecord[]> {
  return withOutbox([] as OutboxRecord[], (target, uid) => target.list(uid));
}

/** Sign-out: the next person on this device must not find this user's books. */
export function forgetUserBooks(uid: string): Promise<void> {
  return withOutbox(undefined, (target) => target.deleteUser(uid));
}

/**
 * Ask the browser not to clear this site's storage under pressure. Safari removes it after about a
 * week without a visit unless this is granted. Best-effort, and only worth asking once there is
 * something worth keeping.
 */
export async function keepStorageDurable(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
    if (await navigator.storage.persisted?.()) return;
    await navigator.storage.persist();
  } catch {
    // not available: nothing to do
  }
}
