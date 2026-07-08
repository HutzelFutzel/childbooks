/**
 * Spread-identity stability across screenplay regenerations.
 *
 * The screenplay generator mints a brand-new random id for every spread on every
 * generation (initial AND revision — see `pipeline/screenplay.ts`). Illustrations
 * and the Final Design layer are keyed by spread id, so without intervention a
 * single screenplay edit would re-mint every id and orphan all page artwork and
 * page designs (the exact "another page becomes page 1" failure).
 *
 * `reconcileScreenplaySpreadIds` re-binds a freshly generated screenplay to the
 * previous one by REUSING the previous spread's id wherever a new spread clearly
 * corresponds to an old one. Because illustrations/design are keyed by that id,
 * preserving it means the existing artwork stays bound to the page with zero
 * remapping. Genuinely new pages keep their fresh id (no artwork yet); pages the
 * revision dropped simply stop being referenced (their artwork is retained in
 * history and reclaimed later by the scoped blob GC, so reverting is lossless).
 *
 * Pure and platform-agnostic.
 */
import type { ScreenplayDoc, ScreenplaySpread } from "../types";

/** Tokenize free text into a lowercase word set for cheap similarity. */
function tokens(text: string | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

/** Jaccard overlap of two sets (0..1); 1 when both are empty. */
function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface Fingerprint {
  anchors: Set<string>;
  text: Set<string>;
  illustration: Set<string>;
}

function fingerprint(s: ScreenplaySpread): Fingerprint {
  return {
    anchors: new Set(s.anchorIds ?? []),
    text: tokens(s.text),
    illustration: tokens(s.illustration),
  };
}

/**
 * Similarity of two spreads in 0..1. Anchors dominate (a page's cast is the most
 * stable signal across a rewrite), then narrative text, then the art brief.
 */
function similarity(a: Fingerprint, b: Fingerprint): number {
  return (
    0.5 * jaccard(a.anchors, b.anchors) +
    0.3 * jaccard(a.text, b.text) +
    0.2 * jaccard(a.illustration, b.illustration)
  );
}

/** Minimum similarity to consider two spreads "the same page" across an edit. */
const MATCH_THRESHOLD = 0.34;
/** Nudge toward keeping page order stable when scores are close. */
const SAME_INDEX_BONUS = 0.08;

/**
 * Return `next` with each spread's id replaced by the corresponding previous
 * spread's id wherever a confident match exists, so id-keyed artwork/design stay
 * bound. Matching is greedy by descending similarity with a small same-position
 * bonus; each previous id is reused at most once. When `prev` is undefined (first
 * generation) `next` is returned unchanged.
 */
export function reconcileScreenplaySpreadIds(
  next: ScreenplayDoc,
  prev: ScreenplayDoc | undefined,
): ScreenplayDoc {
  const prevSpreads = prev?.spreads ?? [];
  if (prevSpreads.length === 0 || next.spreads.length === 0) return next;

  const prevFp = prevSpreads.map(fingerprint);
  const nextFp = next.spreads.map(fingerprint);

  // Score every (next, prev) pair, then assign greedily best-first.
  type Pair = { ni: number; pi: number; score: number };
  const pairs: Pair[] = [];
  for (let ni = 0; ni < next.spreads.length; ni++) {
    for (let pi = 0; pi < prevSpreads.length; pi++) {
      let score = similarity(nextFp[ni], prevFp[pi]);
      if (ni === pi) score += SAME_INDEX_BONUS;
      if (score >= MATCH_THRESHOLD) pairs.push({ ni, pi, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const nextToPrevId = new Map<number, string>();
  const usedNext = new Set<number>();
  const usedPrev = new Set<number>();
  for (const { ni, pi } of pairs) {
    if (usedNext.has(ni) || usedPrev.has(pi)) continue;
    usedNext.add(ni);
    usedPrev.add(pi);
    nextToPrevId.set(ni, prevSpreads[pi].id);
  }

  const spreads = next.spreads.map((s, ni) => {
    const reusedId = nextToPrevId.get(ni);
    return reusedId ? { ...s, id: reusedId } : s;
  });
  return { ...next, spreads };
}

/**
 * All spread ids that appear in ANY version of a screenplay tree, plus the fixed
 * cover/spine keys. Used by the blob GC to decide which illustration/design
 * entries are truly orphaned (present in no screenplay version) vs. merely not on
 * the current cursor (still reachable by reverting) — so reverts stay lossless.
 */
export function liveSpreadIds(
  screenplayNodes: ScreenplayDoc[],
  coverKeys: string[],
): Set<string> {
  const ids = new Set<string>(coverKeys);
  for (const doc of screenplayNodes) {
    for (const s of doc.spreads) ids.add(s.id);
  }
  return ids;
}
