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
 * Anchors this one RELATES to / resembles. A relates link is symmetric but
 * stored only once (on whichever anchor the user created it from), so this
 * returns matches in BOTH directions — this anchor's own `relatedIds` plus any
 * other anchor whose `relatedIds` points back here. Deriving the reverse at
 * read time (instead of mirror-writing a second copy) keeps the two sides from
 * ever drifting out of sync.
 */
export function relatedAnchorsFor(anchor: Anchor, all: Anchor[]): Anchor[] {
  const outbound = new Set(anchor.relatedIds ?? []);
  return all.filter(
    (a) => a.id !== anchor.id && (outbound.has(a.id) || (a.relatedIds ?? []).includes(anchor.id)),
  );
}

/**
 * All linked anchors that count as references of THIS anchor's sheet, for
 * provenance / staleness / the reference legend: the anchors it contains
 * (outbound — drawn into its sheet) plus the anchors it relates to in either
 * direction (context only). Containment is not included in the inbound
 * direction on purpose — a child doesn't reference the parent that contains it.
 */
export function linkedAnchorsFor(anchor: Anchor, all: Anchor[]): Anchor[] {
  const byId = new Map<string, Anchor>();
  for (const a of [...containedAnchorsFor(anchor, all), ...relatedAnchorsFor(anchor, all)]) {
    byId.set(a.id, a);
  }
  return [...byId.values()];
}

/**
 * The single anchor that OWNS the stored relates edge (and its note) for a
 * pair — the one whose `relatedIds` lists the other. Order-independent; returns
 * null when the two aren't related.
 */
export function relationOwner(a: Anchor, b: Anchor): Anchor | null {
  if ((a.relatedIds ?? []).includes(b.id)) return a;
  if ((b.relatedIds ?? []).includes(a.id)) return b;
  return null;
}

/**
 * The user's note describing HOW a related pair connects — the predicate of the
 * stored statement — wherever it happens to live. Undefined when unrelated or
 * no note has been written.
 */
export function relationNote(a: Anchor, b: Anchor): string | undefined {
  const owner = relationOwner(a, b);
  if (!owner) return undefined;
  const otherId = owner.id === a.id ? b.id : a.id;
  const note = owner.relatedNotes?.[otherId]?.trim();
  return note ? note : undefined;
}

/**
 * A full, side-independent sentence for a related pair, e.g. "Dad has lighter
 * hair than Mom" — it reads identically from either anchor's editor and from
 * either anchor's generation prompt, which is exactly what removes the need to
 * auto-invert "lighter" into "darker". The owner is the sentence's subject.
 * Returns null when the pair is unrelated or has no note yet.
 */
export function relationSentence(a: Anchor, b: Anchor): string | null {
  const owner = relationOwner(a, b);
  const note = relationNote(a, b);
  if (!owner || !note) return null;
  const other = owner.id === a.id ? b : a;
  return `${owner.name} ${note} ${other.name}`;
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
 * Only CONTAINED anchors are hard dependencies: their reference image is drawn
 * into the parent's sheet, so it must exist first. Related anchors are context
 * only (text), so a "resembles" link never forces an ordering — this also keeps
 * mutual sibling links from forming cycles.
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
