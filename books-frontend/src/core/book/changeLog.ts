/**
 * The book's change log: one history for the Chat and the page editor.
 *
 * Each entry keeps what a change did to the page design at the level of one
 * property of one element (`pages › p4 › textBoxes › #box › fontSizePct`), with
 * the value before and after. That is what lets a change be taken back without
 * touching anything else:
 *
 * - Undoing the newest change is a plain "put it back" (`force`), because the
 *   reader asked for exactly that and nothing newer depends on it.
 * - Undoing an older change checks each property first: it goes back only where
 *   the book still holds what that change wrote. Where something newer touched
 *   it, that part is reported as a conflict and left alone.
 *
 * A change that reshapes the book itself (a page added, removed, moved or
 * joined) is kept as a whole snapshot of the design, the screenplay and the
 * pictures instead: there is no useful smaller unit for it.
 *
 * Everything here is pure. `state/bookHistory.ts` holds the logs and writes the
 * book; the invariants run this module offline.
 */
import type { BookDesign } from "../design";
import type { IllustrationImage, Project, ScreenplayDoc } from "../types";
import type { VersionTree } from "../versioning";

// --- Operations ---------------------------------------------------------------------

/** A step of a path. A segment starting with "#" names the element of an id-keyed list. */
export type OpPath = string[];

/**
 * One property that changed. A missing `before` means it was added; a missing
 * `after` means it was removed. (Presence, not value: `null` is a value.)
 */
export interface DesignOp {
  path: OpPath;
  before?: unknown;
  after?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function isKeyedList(value: unknown): value is { id: string }[] {
  return Array.isArray(value) && value.every((item) => isObject(item) && typeof item.id === "string");
}

/** JSON with sorted keys, so two values that mean the same compare equal. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export const sameValue = (a: unknown, b: unknown): boolean => a === b || stable(a) === stable(b);

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

function opOf(path: OpPath, before: unknown, after: unknown): DesignOp {
  const op: DesignOp = { path };
  if (before !== undefined) op.before = clone(before);
  if (after !== undefined) op.after = clone(after);
  return op;
}

function diffInto(path: OpPath, a: unknown, b: unknown, ops: DesignOp[]): void {
  if (sameValue(a, b)) return;
  if (a === undefined || b === undefined) {
    ops.push(opOf(path, a, b));
    return;
  }
  if (isObject(a) && isObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diffInto([...path, key], a[key], b[key], ops);
    return;
  }
  if (isKeyedList(a) && isKeyedList(b)) {
    const before = new Map(a.map((item) => [item.id, item]));
    const after = new Map(b.map((item) => [item.id, item]));
    for (const id of new Set([...before.keys(), ...after.keys()])) diffInto([...path, `#${id}`], before.get(id), after.get(id), ops);
    return;
  }
  ops.push(opOf(path, a, b));
}

/** What changed between two designs, one property at a time. */
export function diffDesign(before: BookDesign | undefined, after: BookDesign | undefined): DesignOp[] {
  const ops: DesignOp[] = [];
  diffInto([], before, after, ops);
  return ops;
}

const pathKey = (path: OpPath) => path.join("\u0000");

/**
 * Fold a newer set of ops into an older one, for one gesture that makes many
 * small changes (a slider drag): the first "before" and the last "after" win,
 * and a property that ended where it began drops out.
 */
export function mergeOps(older: readonly DesignOp[], newer: readonly DesignOp[]): DesignOp[] {
  const merged = new Map<string, DesignOp>();
  for (const op of older) merged.set(pathKey(op.path), op);
  for (const op of newer) {
    const key = pathKey(op.path);
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, op);
      continue;
    }
    const next: DesignOp = { path: op.path };
    if ("before" in prior) next.before = prior.before;
    if ("after" in op) next.after = op.after;
    if (sameValue(next.before, next.after) && ("before" in next) === ("after" in next)) merged.delete(key);
    else merged.set(key, next);
  }
  return [...merged.values()];
}

// --- Applying ops ---------------------------------------------------------------------

const FAIL = Symbol("fail");

function readAt(node: unknown, path: OpPath): unknown {
  let current: unknown = node;
  for (const segment of path) {
    if (segment.startsWith("#")) {
      if (!Array.isArray(current)) return undefined;
      current = current.find((item) => isObject(item) && item.id === segment.slice(1));
    } else {
      if (!isObject(current)) return undefined;
      current = current[segment];
    }
    if (current === undefined) return undefined;
  }
  return current;
}

function writeAt(node: unknown, path: OpPath, index: number, value: unknown): unknown | typeof FAIL {
  const segment = path[index]!;
  const last = index === path.length - 1;
  if (segment.startsWith("#")) {
    if (!Array.isArray(node)) return FAIL;
    const id = segment.slice(1);
    const at = node.findIndex((item) => isObject(item) && item.id === id);
    if (last) {
      if (value === undefined) return at >= 0 ? node.filter((_, i) => i !== at) : node;
      return at >= 0 ? node.map((item, i) => (i === at ? value : item)) : [...node, value];
    }
    if (at < 0) return FAIL;
    const child = writeAt(node[at], path, index + 1, value);
    return child === FAIL ? FAIL : node.map((item, i) => (i === at ? child : item));
  }
  if (!isObject(node)) return FAIL;
  if (last) {
    if (value === undefined) {
      const { [segment]: _gone, ...rest } = node;
      void _gone;
      return rest;
    }
    return { ...node, [segment]: value };
  }
  if (node[segment] === undefined) return FAIL;
  const child = writeAt(node[segment], path, index + 1, value);
  return child === FAIL ? FAIL : { ...node, [segment]: child };
}

export interface ApplyResult {
  design: BookDesign | undefined;
  /** How many properties went back. */
  applied: number;
  /** Properties left alone because something newer changed them (or their page is gone). */
  conflicts: DesignOp[];
}

/**
 * Take a change's ops back (`undo`) or put them on again (`redo`).
 *
 * @param force Write the value whatever the book holds now. Only for the newest
 *   change, where "put it back" is exactly what was asked.
 */
export function applyOps(
  design: BookDesign | undefined,
  ops: readonly DesignOp[],
  direction: "undo" | "redo",
  options: { force?: boolean } = {},
): ApplyResult {
  let current: unknown = design;
  let applied = 0;
  const conflicts: DesignOp[] = [];
  if (!design) return { design, applied, conflicts: [...ops] };
  for (const op of ops) {
    const expected = direction === "undo" ? op.after : op.before;
    const target = direction === "undo" ? op.before : op.after;
    if (!options.force && !sameValue(readAt(current, op.path), expected)) {
      conflicts.push(op);
      continue;
    }
    const next = writeAt(current, op.path, 0, clone(target));
    if (next === FAIL) {
      conflicts.push(op);
      continue;
    }
    current = next;
    applied += 1;
  }
  return { design: current as BookDesign, applied, conflicts };
}

/** The page ids a set of ops touched. "*" stands for a book-wide setting. */
export function pagesOfOps(ops: readonly DesignOp[]): string[] {
  const pages = new Set<string>();
  for (const op of ops) pages.add(op.path[0] === "pages" && op.path[1] ? op.path[1] : "*");
  return [...pages];
}

/** A short name for what a set of ops changed, for an editor change that carries no words of its own. */
export function labelForOps(ops: readonly DesignOp[]): string {
  const parts = new Set<string>();
  for (const op of ops) {
    const [scope, , kind] = op.path;
    if (scope !== "pages") parts.add("Book settings");
    else if (kind === "textBoxes") parts.add("Text");
    else if (kind === "shapes") parts.add("Shapes");
    else if (kind === "images") parts.add("Pictures");
    else if (kind === "background") parts.add("Page color");
    else parts.add("Page layout");
  }
  const names = [...parts];
  return names.length === 0 ? "Change" : names.length === 1 ? names[0]! : `${names[0]} and more`;
}

// --- Entries and the log -------------------------------------------------------------------

/** The slice of the book a structural change restores together. */
export interface StructuralSnapshot {
  design: BookDesign | undefined;
  screenplay: VersionTree<ScreenplayDoc> | undefined;
  illustrations: Record<string, VersionTree<IllustrationImage>> | undefined;
}

export type ChangeSource = "chat" | "editor";

export interface ChangeEntry {
  id: string;
  at: number;
  source: ChangeSource;
  /** What the change was, in words for a list ("Text size, all pages"). */
  label: string;
  /** Page ids it touched; "*" for a book-wide setting. */
  pages: string[];
  ops: DesignOp[];
  /** A change to the book's structure: whole snapshots. Not kept across a reload. */
  structural?: { before: StructuralSnapshot; after: StructuralSnapshot };
  /** A gesture that is still adding to this entry (a slider drag). */
  coalesceKey?: string;
  state: "applied" | "undone";
}

export interface ChangeLog {
  entries: ChangeEntry[];
  /** Ids undone one after another, newest last: what Redo walks back through. */
  redo: string[];
}

export const EMPTY_LOG: ChangeLog = { entries: [], redo: [] };
export const CHANGE_LOG_MAX = 100;

/** Add an entry. A new change ends the redo line: what was undone is no longer next. */
export function logWith(log: ChangeLog, entry: ChangeEntry, max = CHANGE_LOG_MAX): ChangeLog {
  return { entries: [...log.entries, entry].slice(-max), redo: [] };
}

/** The entry Undo takes back: the newest one still applied. */
export function newestApplied(log: ChangeLog): ChangeEntry | undefined {
  return log.entries.findLast((entry) => entry.state === "applied");
}

/** The entry Redo puts back: the one undone most recently, while it is still undone. */
export function nextRedo(log: ChangeLog): ChangeEntry | undefined {
  for (let i = log.redo.length - 1; i >= 0; i -= 1) {
    const entry = log.entries.find((e) => e.id === log.redo[i]);
    if (entry?.state === "undone") return entry;
  }
  return undefined;
}

export function withEntryState(log: ChangeLog, id: string, state: ChangeEntry["state"]): ChangeLog {
  const entries = log.entries.map((entry) => (entry.id === id ? { ...entry, state } : entry));
  const redo = state === "undone" ? [...log.redo.filter((x) => x !== id), id] : log.redo.filter((x) => x !== id);
  return { entries, redo };
}

/**
 * The newer changes that touched something this one did (or reshaped the
 * book): what taking this one back out of order would run into.
 */
export function entriesNewerThan(log: ChangeLog, id: string): ChangeEntry[] {
  const at = log.entries.findIndex((entry) => entry.id === id);
  if (at < 0) return [];
  const paths = new Set(log.entries[at]!.ops.map((op) => pathKey(op.path)));
  return log.entries
    .slice(at + 1)
    .filter((entry) => entry.state === "applied" && (entry.structural || entry.ops.some((op) => paths.has(pathKey(op.path)))));
}

// --- Restoring a whole project slice -------------------------------------------------

export function takeStructural(project: Project): StructuralSnapshot {
  return {
    design: project.design ? clone(project.design) : undefined,
    screenplay: project.screenplay ? clone(project.screenplay) : undefined,
    illustrations: project.illustrations ? clone(project.illustrations) : undefined,
  };
}

export function applyStructural(project: Project, snapshot: StructuralSnapshot): Project {
  return {
    ...project,
    design: snapshot.design,
    screenplay: snapshot.screenplay,
    illustrations: snapshot.illustrations,
  };
}

export interface EntryApplied {
  project: Project;
  applied: number;
  conflicts: DesignOp[];
}

/** Take an entry back or put it on again, on a book. Never throws. */
export function applyEntry(
  project: Project,
  entry: ChangeEntry,
  direction: "undo" | "redo",
  options: { force?: boolean } = {},
): EntryApplied {
  if (entry.structural) {
    const snapshot = direction === "undo" ? entry.structural.before : entry.structural.after;
    const expected = direction === "undo" ? entry.structural.after : entry.structural.before;
    if (!options.force) {
      const now = takeStructural(project);
      if (!sameValue(now.design, expected.design) || !sameValue(now.screenplay, expected.screenplay)) {
        return { project, applied: 0, conflicts: [{ path: ["structure"] }] };
      }
    }
    return { project: applyStructural(project, snapshot), applied: 1, conflicts: [] };
  }
  const result = applyOps(project.design, entry.ops, direction, options);
  return {
    project: result.applied > 0 ? { ...project, design: result.design } : project,
    applied: result.applied,
    conflicts: result.conflicts,
  };
}
