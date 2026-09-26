/**
 * Is this edit a real change to the story, or a typo?
 *
 * While the story step is current, cast extraction and the page plan rerun on a
 * real change only: someone added or removed, an age changed, or what happens
 * changed. A typo or a reworded sentence leaves the previous result in place.
 *
 * Deterministic on purpose: the same two drafts always give the same verdict,
 * so a burst of typing is one pause and at most one run.
 */

const STOP = new Set(
  "a an the and or but so to of in on at for with from by as is was were be been are it its he she they them his her their we our you your i me my this that then there here not no yes up down out into over under again very just".split(
    " ",
  ),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

/** Capitalised words that are not sentence-initial: a cheap proper-noun set. */
export function namesIn(text: string): Set<string> {
  const out = new Set<string>();
  const re = /(?<![.!?]\s|^|\n)\b(\p{Lu}[\p{Ll}]{1,})/gu;
  for (const match of text.matchAll(re)) out.add(match[1]!);
  return out;
}

function numbersIn(text: string): string {
  return (text.match(/\b\d{1,3}\b/g) ?? []).sort().join(",");
}

function paragraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((p) => p.trim()).length;
}

/** Jaccard distance between the content-word sets of two drafts. */
export function contentDistance(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return 1 - shared / (left.size + right.size - shared);
}

/** How far the content may drift before "what happens" counts as changed. */
export const REAL_CHANGE_DISTANCE = 0.18;

export function isRealStoryChange(before: string, after: string): boolean {
  if (before === after) return false;
  if (!before.trim() || !after.trim()) return before.trim() !== after.trim();
  const namesBefore = namesIn(before);
  const namesAfter = namesIn(after);
  if (namesBefore.size !== namesAfter.size || [...namesBefore].some((n) => !namesAfter.has(n))) return true;
  if (numbersIn(before) !== numbersIn(after)) return true;
  if (Math.abs(paragraphs(before) - paragraphs(after)) >= 2) return true;
  return contentDistance(before, after) > REAL_CHANGE_DISTANCE;
}

/** The pause after the last keystroke before a rerun is considered. */
export const STORY_SETTLE_MS = 2500;
