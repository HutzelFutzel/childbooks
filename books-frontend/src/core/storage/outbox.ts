/**
 * The copy of a book kept on this device until the cloud has it.
 *
 * Before a save is sent, the book as edited is written here. When the save lands, it is removed. If
 * the tab closes first (a refresh, a crash, a connection that never came back), the next open finds
 * it and puts the changes back. The rules for that are here, pure, so they can be checked offline;
 * `platform/localOutbox.ts` keeps the records in the browser.
 */
import { mergeBooks, resolveBookConflict } from "../guide/merge";
import type { Project } from "../types";

export interface OutboxRecord {
  uid: string;
  projectId: string;
  /** The book with the changes the cloud may not have. */
  project: Project;
  /** The cloud copy it was edited from: the base of a merge when the cloud moved on. */
  base?: Project;
  /** The `rev` the edits are based on. */
  baseRev: number;
  savedAt: number;
}

export interface OutboxStore {
  /**
   * Keep a record. A record without a `base` keeps the one already stored for the same `baseRev`,
   * so the cloud copy is written once per revision and not once per edit.
   */
  put(record: OutboxRecord): Promise<void>;
  get(uid: string, projectId: string): Promise<OutboxRecord | null>;
  list(uid: string): Promise<OutboxRecord[]>;
  /**
   * Remove a record, unless it holds an edit newer than `upToUpdatedAt`: a save that was already in
   * flight must not remove changes made after it started. Returns whether it was removed.
   */
  delete(uid: string, projectId: string, upToUpdatedAt?: number): Promise<boolean>;
  deleteUser(uid: string): Promise<void>;
}

export type Recovery =
  /** The cloud already has these changes (the save landed, only the clean-up did not). */
  | { kind: "landed" }
  /** The cloud is where the edits started: put them back as they were. */
  | { kind: "restore" }
  /** The cloud moved on (another device, another tab): merge the changes into it. */
  | { kind: "merge" }
  /** The cloud moved on and the copy it started from is gone: nothing can be merged safely. */
  | { kind: "unmergeable" }
  /** The cloud is behind the edits. Something was lost there; keep this copy and say so. */
  | { kind: "ahead" }
  /** The book is not in the cloud (deleted elsewhere): keep this copy and say so. */
  | { kind: "orphan" };

/** Bookkeeping that differs between two copies of the same book. */
function content(project: Project): string {
  return JSON.stringify({ ...project, rev: 0, updatedAt: 0 });
}

/** What to do with a record, given the book as the cloud has it. */
export function decideRecovery(record: OutboxRecord, cloud: Project | null): Recovery {
  if (!cloud) return { kind: "orphan" };
  const cloudRev = cloud.rev ?? 0;
  if (content(record.project) === content(cloud)) return { kind: "landed" };
  if (cloudRev === record.baseRev) return { kind: "restore" };
  if (cloudRev > record.baseRev) return record.base ? { kind: "merge" } : { kind: "unmergeable" };
  return { kind: "ahead" };
}

export interface Recovered {
  project: Project;
  /** Fields both sides had changed; the edits made here won, and the other value is kept in the book's history of replaced values. */
  conflicts: string[];
}

/**
 * The book to continue with, for a `restore` or a `merge`. Edits made here win a field both sides
 * changed (they are the ones the reader just made and nearly lost), and the cloud's value is kept in
 * `authoringState.replaced`, so nothing either side wrote is lost.
 */
export function recoveredBook(record: OutboxRecord, cloud: Project, recovery: Recovery, now: number): Recovered | null {
  const cloudRev = cloud.rev ?? 0;
  if (recovery.kind === "restore") {
    return { project: { ...record.project, rev: cloudRev }, conflicts: [] };
  }
  if (recovery.kind === "merge" && record.base) {
    const { project: merged, conflicts } = mergeBooks(record.base, record.project, cloud);
    const project = conflicts.length > 0 ? resolveBookConflict(merged, record.project, cloud, conflicts, "mine", now) : merged;
    return { project: { ...project, rev: cloudRev }, conflicts };
  }
  return null;
}

/** An in-memory store: for checks, and where the browser has no IndexedDB. */
export function createMemoryOutbox(): OutboxStore {
  const records = new Map<string, OutboxRecord>();
  const keyOf = (uid: string, projectId: string) => `${uid}\u0000${projectId}`;
  return {
    async put(record) {
      const key = keyOf(record.uid, record.projectId);
      const existing = records.get(key);
      const base = record.base ?? (existing && existing.baseRev === record.baseRev ? existing.base : undefined);
      records.set(key, { ...record, ...(base ? { base } : {}) });
    },
    async get(uid, projectId) {
      return records.get(keyOf(uid, projectId)) ?? null;
    },
    async list(uid) {
      return [...records.values()].filter((record) => record.uid === uid);
    },
    async delete(uid, projectId, upToUpdatedAt) {
      const key = keyOf(uid, projectId);
      const existing = records.get(key);
      if (!existing) return false;
      if (upToUpdatedAt !== undefined && existing.project.updatedAt > upToUpdatedAt) return false;
      records.delete(key);
      return true;
    },
    async deleteUser(uid) {
      for (const [key, record] of [...records]) if (record.uid === uid) records.delete(key);
    },
  };
}
