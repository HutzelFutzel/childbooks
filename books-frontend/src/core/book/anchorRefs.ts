/**
 * Anchor reference integrity helpers.
 *
 * Spreads and covers reference anchors *by id*. Two things can break those
 * links, both of which manifest as "anchors are ignored" when generating pages:
 *
 *  1. Re-analyzing the story mints brand-new anchor ids, orphaning every page
 *     reference to the old ids ("id drift").
 *  2. Even without re-analysis, a stored id can fall out of sync with the
 *     current anchor set.
 *
 * `reconcileAnchorIds` prevents (1) by preserving stable ids across re-analysis.
 * `effectiveAnchorIds` heals (2) at read time by falling back to the anchor name
 * recorded alongside each id. Both are pure and platform-agnostic so the client
 * and the backend worker resolve references identically.
 */
import type { Anchor } from "../types";

/** Normalize an anchor name for tolerant matching (case/whitespace/articles). */
export function normalizeAnchorName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(the|a|an)\s+/, "");
}

/** Index current anchors by normalized name (first occurrence wins). */
function anchorsByName(anchors: Anchor[]): Map<string, Anchor> {
  const m = new Map<string, Anchor>();
  for (const a of anchors) {
    const key = normalizeAnchorName(a.name);
    if (key && !m.has(key)) m.set(key, a);
  }
  return m;
}

/**
 * Reconcile a freshly-analyzed anchor list against the project's existing
 * anchors, preserving the stable id (and any already-generated image versions)
 * for anchors whose name is unchanged. This is the primary fix for "id drift":
 * it keeps screenplay/illustration references — which point at anchors by id —
 * valid across re-analysis instead of orphaning them behind brand-new ids.
 */
export function reconcileAnchorIds(next: Anchor[], prev: Anchor[]): Anchor[] {
  const prevByName = new Map<string, Anchor[]>();
  for (const a of prev) {
    const key = normalizeAnchorName(a.name);
    if (!key) continue;
    const bucket = prevByName.get(key);
    if (bucket) bucket.push(a);
    else prevByName.set(key, [a]);
  }
  const used = new Set<string>();
  return next.map((a) => {
    const candidates = prevByName.get(normalizeAnchorName(a.name)) ?? [];
    const match = candidates.find((c) => !used.has(c.id));
    if (!match) return a;
    used.add(match.id);
    // Keep the stable id so existing page references still resolve, and carry
    // over already-generated images so re-analysis doesn't discard the artwork.
    return { ...a, id: match.id, versions: a.versions ?? match.versions };
  });
}

/**
 * Resolve a spread/cover's referenced anchors to *current* anchor ids, healing
 * id drift. For each stored id that still exists we keep it; for a stored id
 * that no longer exists we fall back to the name recorded in the same slot of
 * `anchorNames` and re-match it to a current anchor.
 *
 * Only the stored id list is iterated, so user removals stick — `anchorNames`
 * is a per-slot recovery hint, never a union that could resurrect an anchor the
 * user removed. Legacy data without `anchorNames` simply can't be healed (its
 * surviving ids still resolve normally).
 */
export function effectiveAnchorIds(
  anchors: Anchor[] | undefined,
  ref: { anchorIds: string[]; anchorNames?: string[] },
): string[] {
  const list = anchors ?? [];
  const byId = new Map(list.map((a) => [a.id, a]));
  const byName = anchorsByName(list);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  ref.anchorIds.forEach((id, i) => {
    if (byId.has(id)) {
      add(id);
      return;
    }
    const name = ref.anchorNames?.[i];
    if (name) add(byName.get(normalizeAnchorName(name))?.id);
  });
  return out;
}
