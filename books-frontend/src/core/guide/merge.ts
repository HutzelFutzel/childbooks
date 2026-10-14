/**
 * Two devices, one book: a three-way merge by field.
 *
 * `base` is the copy both devices started from (the last one this device
 * saved or loaded), `mine` is this device's, `theirs` is what the other device
 * stored. A field only one side changed takes that side. A field both changed
 * the same way is kept. A field both changed differently is a conflict: the
 * reader chooses once, and the version they didn't choose is kept in the
 * book's history of replaced values.
 *
 * Fields are the book's top-level parts, its settings one level down, and the
 * Chat's own state one level down, which is as fine as a person would name them
 * ("the story", "the style", "the title"). The page design goes one level
 * further, to a single page: two devices that restyled different pages merge,
 * and only a page both of them changed is a question.
 */
import type { Project } from "../types";
import { authoringOf, withAuthoring } from "./projectState";

export interface BookMerge {
  project: Project;
  /** Paths both devices changed differently, e.g. `config.storyText`. */
  conflicts: string[];
}

const NESTED = new Set(["config", "authoringState", "design", "design.pages"]);
/** Bookkeeping that is expected to differ and never counts as a change. */
const IGNORED = new Set(["rev", "updatedAt", "authoringState.seenAt"]);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

type Loose = Record<string, unknown>;

function mergeLevel(
  prefix: string,
  base: Loose,
  mine: Loose,
  theirs: Loose,
  conflicts: string[],
): Loose {
  const out: Loose = { ...theirs };
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (IGNORED.has(path)) continue;
    const b = base[key];
    const m = mine[key];
    const t = theirs[key];
    if (NESTED.has(path) && isObject(m) && isObject(t)) {
      out[key] = mergeLevel(path, isObject(b) ? b : {}, m, t, conflicts);
      continue;
    }
    if (same(m, t) || same(m, b)) {
      if (t === undefined) delete out[key];
      else out[key] = t;
      continue;
    }
    if (same(t, b)) {
      if (m === undefined) delete out[key];
      else out[key] = m;
      continue;
    }
    conflicts.push(path);
    out[key] = m;
  }
  return out;
}

function isObject(value: unknown): value is Loose {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Merge; on a conflict the result holds this device's value until the reader chooses. */
export function mergeBooks(base: Project, mine: Project, theirs: Project): BookMerge {
  const conflicts: string[] = [];
  const merged = mergeLevel("", base as unknown as Loose, mine as unknown as Loose, theirs as unknown as Loose, conflicts);
  return { project: { ...(merged as unknown as Project), rev: theirs.rev }, conflicts };
}

function getPath(project: Project, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (isObject(value) ? value[key] : undefined), project);
}

function setLoose(root: Loose, keys: readonly string[], value: unknown): Loose {
  const [head, ...rest] = keys as [string, ...string[]];
  if (rest.length === 0) {
    const next = { ...root };
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  const inner = isObject(root[head]) ? (root[head] as Loose) : {};
  return { ...root, [head]: setLoose(inner, rest, value) };
}

function setPath(project: Project, path: string, value: unknown): Project {
  return setLoose(project as unknown as Loose, path.split("."), value) as unknown as Project;
}

const REPLACED_KEEP = 5;

/**
 * Settle the conflicted fields on one side. The other side's values are kept
 * in `authoringState.replaced`, newest first, so nothing either device wrote is
 * lost.
 */
export function resolveBookConflict(
  merged: Project,
  mine: Project,
  theirs: Project,
  conflicts: readonly string[],
  keep: "mine" | "theirs",
  at: number,
): Project {
  const winner = keep === "mine" ? mine : theirs;
  const loser = keep === "mine" ? theirs : mine;
  let out = merged;
  const lost: Record<string, unknown> = {};
  for (const path of conflicts) {
    out = setPath(out, path, getPath(winner, path));
    lost[path] = getPath(loser, path);
  }
  const replaced = [{ at, fields: lost }, ...(authoringOf(out).replaced ?? [])].slice(0, REPLACED_KEEP);
  return withAuthoring(out, { replaced });
}
