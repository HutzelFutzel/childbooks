/**
 * Private containment dependencies between visual references. These are
 * inferred during story analysis and never exposed as a relationship editor.
 * Pure so client and worker resolve render ordering identically.
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

/**
 * Anchors that CONTAIN this one — the inverse of {@link containedAnchorsFor}.
 * Containment stays directional (the container owns the link and draws the
 * child into its own sheet), so this is a read-only view used to show a
 * "contained in X" note on the child. It is deliberately NOT treated as a
 * dependency or reference of the child (the child renders without the parent).
 */
export function containersOf(anchor: Anchor, all: Anchor[]): Anchor[] {
  return all.filter((a) => a.id !== anchor.id && (a.containedIds ?? []).includes(anchor.id));
}

/**
 * Parent→child pairs where BOTH anchors are active on the same page/spread.
 * Used to detect obsolete generic instances of an embedded child (e.g. a default
 * bed drawn into a room when a specific bed anchor is also on the page).
 */
export function embeddedPairsAmong(
  anchors: Anchor[],
  activeIds: string[],
): { parent: Anchor; child: Anchor }[] {
  const active = new Set(activeIds);
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const pairs: { parent: Anchor; child: Anchor }[] = [];
  for (const pid of activeIds) {
    const parent = byId.get(pid);
    if (!parent || parent.type === "character") continue;
    for (const cid of parent.containedIds ?? []) {
      if (!active.has(cid)) continue;
      const child = byId.get(cid);
      if (child) pairs.push({ parent, child });
    }
  }
  return pairs;
}

/**
 * Order anchors into dependency layers so that a referenced anchor (e.g. a bed
 * contained in a room) is generated before the anchor that references it.
 * Anchors in the same layer have no remaining dependencies on each other.
 *
 * A contained reference image is drawn into the parent's sheet, so it must
 * exist first.
 */
export function orderAnchorsByDependency(anchors: Anchor[]): Anchor[][] {
  const ids = new Set(anchors.map((a) => a.id));
  const deps = new Map<string, Set<string>>();
  for (const a of anchors) {
    const rel = containedAnchorsFor(a, anchors)
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
