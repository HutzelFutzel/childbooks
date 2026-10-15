"use client";

/**
 * The book's undo/redo history, shared by the Chat and the page editor.
 *
 * The logic is pure (`core/book/changeLog.ts`); this store holds one log per
 * book, writes the book through `projectsStore.patchCurrent`, and keeps the
 * field-level entries across a reload. Both sides report a change here, so
 * Cmd+Z in the editor takes back what the chat did, a typed "undo" takes back
 * what the editor did, and an older chat change can be undone without losing a
 * newer one.
 *
 * Not recorded, on purpose: work the app does by itself (a finished picture,
 * re-inking text on new art). Undo never reverses what the reader did not do.
 */
import { create } from "zustand";
import {
  applyEntry,
  CHANGE_LOG_MAX,
  diffDesign,
  entriesNewerThan,
  EMPTY_LOG,
  logWith,
  mergeOps,
  newestApplied,
  nextRedo,
  pagesOfOps,
  takeStructural,
  withEntryState,
  type ChangeEntry,
  type ChangeLog,
  type ChangeSource,
  type DesignOp,
} from "../core/book/changeLog";
import type { BookDesign, Project } from "../core/types";
import { useProjectsStore } from "./projectsStore";

const STORAGE_PREFIX = "childbooks.changeLog.v1.";

function newId(): string {
  return `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStored(projectId: string): ChangeLog {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_PREFIX + projectId);
    if (!raw) return EMPTY_LOG;
    const parsed = JSON.parse(raw) as ChangeLog;
    if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.redo)) return EMPTY_LOG;
    return {
      entries: parsed.entries.filter((entry) => entry && typeof entry.id === "string" && Array.isArray(entry.ops)),
      redo: parsed.redo.filter((id) => typeof id === "string"),
    };
  } catch {
    return EMPTY_LOG;
  }
}

function writeStored(projectId: string, log: ChangeLog): void {
  try {
    if (typeof localStorage === "undefined") return;
    // Whole-book snapshots are large and stay in memory only.
    const entries = log.entries.filter((entry) => !entry.structural).slice(-CHANGE_LOG_MAX);
    const ids = new Set(entries.map((entry) => entry.id));
    localStorage.setItem(
      STORAGE_PREFIX + projectId,
      JSON.stringify({ entries: entries.map((e) => ({ ...e, coalesceKey: undefined })), redo: log.redo.filter((id) => ids.has(id)) }),
    );
  } catch {
    // Storage full or blocked: the history still works for this session.
  }
}

export type UndoOutcome =
  | { status: "done"; entry: ChangeEntry; conflicts: DesignOp[] }
  | { status: "empty" }
  /** An older change that something newer touched: nothing was changed. */
  | { status: "conflict"; entry: ChangeEntry; newer: ChangeEntry[] }
  | { status: "missing" };

interface HistoryState {
  logs: Record<string, ChangeLog>;
  /** Load a book's saved log once. */
  hydrate: (projectId: string) => void;
  recordDesign: (input: {
    projectId: string;
    source: ChangeSource;
    label: string;
    before: BookDesign | undefined;
    after: BookDesign | undefined;
    /** Add to the open gesture's entry instead of starting a new one. */
    coalesceKey?: string;
    merge?: boolean;
  }) => ChangeEntry | null;
  recordStructural: (input: { projectId: string; source: ChangeSource; label: string; before: Project; after: Project }) => ChangeEntry | null;
  /** Take back the newest change, whoever made it. */
  undo: (projectId: string) => Promise<UndoOutcome>;
  redo: (projectId: string) => Promise<UndoOutcome>;
  /** Take back one change, checking that nothing newer depends on it. */
  undoEntry: (projectId: string, entryId: string, options?: { force?: boolean }) => Promise<UndoOutcome>;
  /** Take back this change and every newer one, newest first. */
  undoThrough: (projectId: string, entryId: string) => Promise<UndoOutcome>;
  redoEntry: (projectId: string, entryId: string) => Promise<UndoOutcome>;
  entry: (projectId: string, entryId: string) => ChangeEntry | undefined;
  forget: (projectId: string) => void;
}

const sizeOf = (ops: readonly DesignOp[]) => JSON.stringify(ops).length;
/** An entry bigger than this is not worth keeping field by field. */
const MAX_OPS_CHARS = 400_000;

export const useBookHistory = create<HistoryState>((set, get) => {
  const logOf = (projectId: string): ChangeLog => get().logs[projectId] ?? EMPTY_LOG;
  const save = (projectId: string, log: ChangeLog) => {
    set((state) => ({ logs: { ...state.logs, [projectId]: log } }));
    writeStored(projectId, log);
  };

  /** Run one step on the live book, atomically. */
  async function apply(
    projectId: string,
    entry: ChangeEntry,
    direction: "undo" | "redo",
    force: boolean,
  ): Promise<{ conflicts: DesignOp[]; applied: number } | null> {
    const store = useProjectsStore.getState();
    if (store.current()?.id !== projectId) return null;
    const holder = { conflicts: [] as DesignOp[], applied: 0 };
    await store.patchCurrent((project) => {
      if (project.id !== projectId) return project;
      const result = applyEntry(project, entry, direction, { force });
      holder.conflicts = result.conflicts;
      holder.applied = result.applied;
      return result.project;
    });
    return holder;
  }

  return {
    logs: {},

    hydrate: (projectId) => {
      if (get().logs[projectId]) return;
      set((state) => ({ logs: { ...state.logs, [projectId]: readStored(projectId) } }));
    },

    recordDesign: ({ projectId, source, label, before, after, coalesceKey, merge }) => {
      get().hydrate(projectId);
      const ops = diffDesign(before, after);
      if (ops.length === 0) return null;
      const log = logOf(projectId);
      const last = log.entries[log.entries.length - 1];
      // One gesture, one entry: a slider drag adds to the entry it began.
      if (merge && coalesceKey && last && last.state === "applied" && last.source === source && last.coalesceKey === coalesceKey && !last.structural) {
        const merged = mergeOps(last.ops, ops);
        const entries = log.entries.slice(0, -1);
        if (merged.length === 0) {
          save(projectId, { entries, redo: [] });
          return null;
        }
        const entry = { ...last, ops: merged, pages: pagesOfOps(merged), at: Date.now() };
        save(projectId, { entries: [...entries, entry], redo: [] });
        return entry;
      }
      if (sizeOf(ops) > MAX_OPS_CHARS) return null;
      const entry: ChangeEntry = {
        id: newId(),
        at: Date.now(),
        source,
        label,
        pages: pagesOfOps(ops),
        ops,
        ...(coalesceKey ? { coalesceKey } : {}),
        state: "applied",
      };
      save(projectId, logWith(log, entry));
      return entry;
    },

    recordStructural: ({ projectId, source, label, before, after }) => {
      get().hydrate(projectId);
      const entry: ChangeEntry = {
        id: newId(),
        at: Date.now(),
        source,
        label,
        pages: ["*"],
        ops: [],
        structural: { before: takeStructural(before), after: takeStructural(after) },
        state: "applied",
      };
      save(projectId, logWith(logOf(projectId), entry));
      return entry;
    },

    undo: async (projectId) => {
      get().hydrate(projectId);
      const entry = newestApplied(logOf(projectId));
      if (!entry) return { status: "empty" };
      const result = await apply(projectId, entry, "undo", true);
      if (!result) return { status: "missing" };
      // Marked undone even when part of it could not go back (its page is gone): otherwise it would block every older change.
      save(projectId, withEntryState(logOf(projectId), entry.id, "undone"));
      return { status: "done", entry, conflicts: result.conflicts };
    },

    redo: async (projectId) => {
      get().hydrate(projectId);
      const entry = nextRedo(logOf(projectId));
      if (!entry) return { status: "empty" };
      const result = await apply(projectId, entry, "redo", true);
      if (!result) return { status: "missing" };
      save(projectId, withEntryState(logOf(projectId), entry.id, "applied"));
      return { status: "done", entry, conflicts: result.conflicts };
    },

    undoEntry: async (projectId, entryId, options = {}) => {
      get().hydrate(projectId);
      const log = logOf(projectId);
      const entry = log.entries.find((e) => e.id === entryId);
      if (!entry) return { status: "missing" };
      if (entry.state === "undone") return { status: "done", entry, conflicts: [] };
      const project = useProjectsStore.getState().current();
      if (!project || project.id !== projectId) return { status: "missing" };
      const newest = newestApplied(log);
      // The newest change goes back as asked; an older one only where nothing newer touched it.
      const linear = newest?.id === entry.id;
      if (!linear && !options.force) {
        const dry = applyEntry(project, entry, "undo", { force: false });
        if (dry.conflicts.length > 0) return { status: "conflict", entry, newer: entriesNewerThan(log, entry.id) };
      }
      const result = await apply(projectId, entry, "undo", linear || Boolean(options.force));
      if (!result) return { status: "missing" };
      save(projectId, withEntryState(logOf(projectId), entry.id, "undone"));
      return { status: "done", entry, conflicts: result.conflicts };
    },

    undoThrough: async (projectId, entryId) => {
      get().hydrate(projectId);
      const target = logOf(projectId).entries.find((e) => e.id === entryId);
      if (!target) return { status: "missing" };
      for (let guard = 0; guard < CHANGE_LOG_MAX; guard += 1) {
        const newest = newestApplied(logOf(projectId));
        if (!newest) break;
        const outcome = await get().undo(projectId);
        if (outcome.status !== "done") return outcome;
        if (newest.id === entryId) return outcome;
      }
      return { status: "done", entry: target, conflicts: [] };
    },

    redoEntry: async (projectId, entryId) => {
      get().hydrate(projectId);
      const log = logOf(projectId);
      const entry = log.entries.find((e) => e.id === entryId);
      if (!entry) return { status: "missing" };
      if (entry.state === "applied") return { status: "done", entry, conflicts: [] };
      const project = useProjectsStore.getState().current();
      if (!project || project.id !== projectId) return { status: "missing" };
      const dry = applyEntry(project, entry, "redo", { force: false });
      if (dry.conflicts.length > 0) return { status: "conflict", entry, newer: entriesNewerThan(log, entry.id) };
      const result = await apply(projectId, entry, "redo", false);
      if (!result) return { status: "missing" };
      save(projectId, withEntryState(logOf(projectId), entry.id, "applied"));
      return { status: "done", entry, conflicts: result.conflicts };
    },

    entry: (projectId, entryId) => logOf(projectId).entries.find((e) => e.id === entryId),

    forget: (projectId) => {
      set((state) => {
        const { [projectId]: _gone, ...logs } = state.logs;
        void _gone;
        return { logs };
      });
      try {
        localStorage.removeItem(STORAGE_PREFIX + projectId);
      } catch {
        // Nothing to clean up.
      }
    },
  };
});

/** Selectors: whether Undo and Redo have something to do for a book. */
export const canUndoSelector = (projectId: string | undefined) => (state: HistoryState) =>
  projectId ? Boolean(newestApplied(state.logs[projectId] ?? EMPTY_LOG)) : false;
export const canRedoSelector = (projectId: string | undefined) => (state: HistoryState) =>
  projectId ? Boolean(nextRedo(state.logs[projectId] ?? EMPTY_LOG)) : false;
