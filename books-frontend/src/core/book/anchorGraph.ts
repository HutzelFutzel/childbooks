/**
 * The explicit relationship graph between anchors (characters / places /
 * objects). Relations are user-declared by id (no fragile name matching), so the
 * dependency and staleness graphs only follow links the user actually created.
 *
 * Pure (depends only on `Anchor`), so both the client and the worker order and
 * resolve anchor references identically.
 */
import type { Anchor } from "../types";

function resolveIds(ids: string[] | undefined, all: Anchor[], selfId: string): Anchor[] {
  if (!ids || ids.length === 0) return [];
  const set = new Set(ids);
  return all.filter((a) => a.id !== selfId && set.has(a.id));
}

/** Anchors explicitly CONTAINED within this one (place/object), resolved by id. */
export function containedAnchorsFor(anchor: Anchor, all: Anchor[]): Anchor[] {
  return resolveIds(anchor.containedIds, all, anchor.id);
}

/** Anchors this one explicitly RELATES to / resembles, resolved by id. */
export function relatedAnchorsFor(anchor: Anchor, all: Anchor[]): Anchor[] {
  return resolveIds(anchor.relatedIds, all, anchor.id);
}

/** All explicitly linked anchors (contained + related) for refs/staleness/ordering. */
export function linkedAnchorsFor(anchor: Anchor, all: Anchor[]): Anchor[] {
  const ids = [...(anchor.containedIds ?? []), ...(anchor.relatedIds ?? [])];
  return resolveIds(ids, all, anchor.id);
}

/**
 * Order anchors into dependency layers so that a referenced anchor (e.g. a bed
 * contained in a room) is generated before the anchor that references it.
 * Anchors in the same layer have no remaining dependencies on each other.
 */
export function orderAnchorsByDependency(anchors: Anchor[]): Anchor[][] {
  const ids = new Set(anchors.map((a) => a.id));
  const deps = new Map<string, Set<string>>();
  for (const a of anchors) {
    const rel = linkedAnchorsFor(a, anchors)
      .map((r) => r.id)
      .filter((id) => ids.has(id));
    deps.set(a.id, new Set(rel));
  }
  const done = new Set<string>();
  const layers: Anchor[][] = [];
  let remaining = [...anchors];
  while (remaining.length > 0) {
    const ready = remaining.filter((a) => [...deps.get(a.id)!].every((d) => done.has(d)));
    if (ready.length === 0) {
      // Cycle (e.g. mutual references) — emit the rest together to avoid a hang.
      layers.push(remaining);
      break;
    }
    layers.push(ready);
    ready.forEach((a) => done.add(a.id));
    remaining = remaining.filter((a) => !done.has(a.id));
  }
  return layers;
}
