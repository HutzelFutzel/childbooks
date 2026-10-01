/**
 * The context chip: what a typed change is about.
 *
 * Clicking the book sets the chip ("Maya", "Cover", "Page 4"); the chip is the
 * only way to retarget. A sentence that names exactly one person needs no tap.
 * When several people are in view and the sentence names nobody, the well asks
 * which name. Nothing redraws until the chip is one target, and nothing here
 * spends Sparks — the scoped redraw button does, with its estimate.
 */
import { COVER_FRONT_ID } from "../types";
import type { BookViewId } from "./journey";

export type GuideTarget =
  | { kind: "person"; castId: string; name: string }
  | { kind: "cover"; unitId: string }
  | { kind: "page"; unitId: string; page: number };

/**
 * The tab a chip belongs to. The card it opens is the reader's own doing, with
 * no line from the guide to explain it, so it closes when they leave that tab
 * rather than turning up on a tab where nothing points to it.
 */
export function targetHomeView(target: GuideTarget): BookViewId {
  return target.kind === "person" ? "cast" : "pages";
}

/** Keep the chip only while the tab it belongs to is the open one. */
export function chipForView(chip: GuideTarget | null, view: BookViewId | null): GuideTarget | null {
  return chip && view === targetHomeView(chip) ? chip : null;
}

export function sameTarget(a: GuideTarget | null, b: GuideTarget | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "person" && b.kind === "person") return a.castId === b.castId;
  return (a as { unitId: string }).unitId === (b as { unitId: string }).unitId;
}

export function coverTarget(): GuideTarget {
  return { kind: "cover", unitId: COVER_FRONT_ID };
}

export interface TargetPerson {
  id: string;
  name: string;
}

export type TargetResolution =
  | { kind: "target"; target: GuideTarget }
  | { kind: "ask"; people: TargetPerson[] }
  | { kind: "none" };

function mentions(sentence: string, name: string): boolean {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.length > 0 && new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, "iu").test(sentence);
}

/**
 * What a typed change targets.
 *
 * @param inView people visible on the object the chip points at (a cover or a
 *   page with several people), used only when the sentence names nobody.
 */
export function resolveGuideTarget(args: {
  sentence: string;
  chip: GuideTarget | null;
  cast: readonly TargetPerson[];
  inView?: readonly TargetPerson[];
}): TargetResolution {
  const named = args.cast.filter((person) => mentions(args.sentence, person.name));
  if (named.length === 1 && (!args.chip || args.chip.kind === "person")) {
    return { kind: "target", target: { kind: "person", castId: named[0]!.id, name: named[0]!.name } };
  }
  // A page or cover is one target however many people are on it: the picture.
  if (args.chip) return { kind: "target", target: args.chip };
  if (named.length > 1) return { kind: "ask", people: named };
  if ((args.inView?.length ?? 0) > 1) return { kind: "ask", people: [...args.inView!] };
  if (args.inView?.length === 1) {
    const only = args.inView[0]!;
    return { kind: "target", target: { kind: "person", castId: only.id, name: only.name } };
  }
  return { kind: "none" };
}

/** The chip's label as the reader sees it. */
export function targetLabel(target: GuideTarget, labels: { cover: string; page: (n: number) => string }): string {
  if (target.kind === "person") return target.name;
  if (target.kind === "cover") return labels.cover;
  return labels.page(target.page);
}
