/**
 * What in the book no longer matches the facts it was made from.
 *
 * This is the other half of letting a reader change their mind. Editing a fact is easy
 * — they say "Maya's six, not five" and the patch layer writes it. The hard part is
 * everything already built from the old answer: a story written for a five-year-old, a
 * cast sheet drawn to it, a dozen illustrations referencing that sheet. A guide that
 * accepts the edit and says nothing has quietly left the reader with a book that
 * contradicts itself, and they will only find out at the print preview.
 *
 * **Detection is not reimplemented here.** `isDraftStale`, `staleAnchorIds` and
 * `staleIllustrationSpreadIds` already decide what is out of date, and the wizard's
 * "update stale" toolbar reads exactly those. A second opinion about staleness that
 * agrees today is one that disagrees after the next signature change, and the two
 * flows have to stay portable. So the anchor and page verdicts are passed IN, the same
 * way `GuidePatchContext` passes in the admin-configured worlds and
 * `GuideEffectSignals` passes in live job state — those functions live in
 * `state/ai.ts`, which reaches Firebase, and this module has to stay pure enough to
 * walk every synthesized book offline.
 *
 * What IS decided here is the part that is new: which guide component owns each kind of
 * staleness, what to tell the reader, and what fixes it.
 */
import { briefOf, isDraftStale } from "../story/brief";
import type { Project } from "../types";
import type { GuideComponentId, GuideEffectId } from "./components";

/**
 * The verdicts from the shipped detectors. Optional because a caller that has not run
 * them yet (the first render, before the project's version trees are scanned) should
 * report nothing stale rather than guess.
 */
export interface GuideStaleInput {
  /** From `staleAnchorIds` — sheets whose references have since changed. */
  anchors?: readonly string[];
  /** From `staleIllustrationSpreadIds` — pages whose art no longer matches. */
  pages?: readonly string[];
}

export interface GuideStaleItem {
  /** The component whose work is out of date. */
  component: GuideComponentId;
  /** What is out of date and why, in the reader's words. */
  reason: string;
  /** The generation that would bring it up to date. */
  effect: GuideEffectId;
  /** How many things are affected. One, for the story. */
  count: number;
}

/**
 * Everything out of date, upstream first.
 *
 * The order is the useful part, not a presentation detail. Re-drawing the pages before
 * re-drawing the cast sheet they reference produces pages that are stale the moment
 * they land, so the reader would pay twice — which is why the wizard's `refreshStale`
 * updates anchors and waits before queueing pages. Anything offering to fix these has
 * to respect the same order, so it is established here rather than left to a caller.
 */
export function guideStaleness(project: Project, input: GuideStaleInput = {}): GuideStaleItem[] {
  const items: GuideStaleItem[] = [];

  const brief = briefOf(project.config);
  const storyStale = isDraftStale(
    brief,
    project.config.storyText ?? "",
    project.config.ageRangeId,
    project.config.readingModeId,
    project.config.contentLocale,
  );
  if (storyStale) {
    items.push({
      component: "story-draft",
      // Deliberately vague about WHICH detail changed: the signature covers the whole
      // brief plus the age band and language, and naming the wrong one is worse than
      // naming none. The reader knows what they just changed.
      reason: "The story was written before your last change.",
      effect: "storyDraft",
      count: 1,
    });
  }

  const anchors = input.anchors ?? [];
  if (anchors.length > 0) {
    items.push({
      component: "cast-looks",
      reason:
        anchors.length === 1
          ? "One character or place has changed since it was drawn."
          : `${anchors.length} characters and places have changed since they were drawn.`,
      effect: "castArt",
      count: anchors.length,
    });
  }

  const pages = input.pages ?? [];
  if (pages.length > 0) {
    items.push({
      component: "page-art",
      reason:
        pages.length === 1
          ? "One page no longer matches the story."
          : `${pages.length} pages no longer match the story.`,
      effect: "pageArt",
      count: pages.length,
    });
  }

  return items;
}

/**
 * One line summarising everything stale, for a notice the reader sees once.
 *
 * Collapsed into a single sentence rather than a list, because three separate warnings
 * about one edit reads as three problems. Empty string when nothing is stale, so the
 * caller's check is `if (summary)`.
 */
export function guideStaleSummary(items: readonly GuideStaleItem[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!.reason;
  return `${items[0]!.reason} ${items
    .slice(1)
    .map((item) => item.reason)
    .join(" ")}`;
}
