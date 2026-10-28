/**
 * Checks on a finished page plan, and the parts of it that code can settle
 * without asking a model again.
 *
 * A page plan is the one place where the story's words, its cast, the age
 * band's limits and the printed page order all meet, and it used to go straight
 * on to illustration unread. Everything here counts or compares: whether the
 * pages carry the story's words, whether a stanza was cut, whether a name
 * resolves to exactly one person, how many figures share a picture, which side
 * of the fold a page falls on. Nothing reads language, so it holds in every
 * book language.
 */
import type { AudienceProfile } from "../config/audienceCatalog";
import type { Anchor, CoverSpec, ScreenplayDoc, ScreenplaySpread } from "../types";
import { anchorNameKeys, normalizeAnchorName } from "../book/anchorRefs";
import { paginate } from "./pagination";
import { inspectPageSentences, inspectScreenplayDensity } from "./screenplayFit";
import { describeCut, inspectCuts, type Tie } from "./screenplayCuts";
import { firstTextMismatch } from "./screenplayText";

export type ScreenplayProblemCode =
  | "text-mismatch"
  | "verse-split"
  | "name-unknown"
  | "name-ambiguous"
  | "too-many-figures"
  | "empty-brief"
  | "empty-text"
  | "over-density"
  | "spread-misplaced"
  | "wordless-misuse";

export interface ScreenplayProblem {
  code: ScreenplayProblemCode;
  /** 1-based page, or "front" / "back" for a cover; absent for the plan as a whole. */
  page?: number | "front" | "back";
  /** One sentence the repair call can act on. */
  message: string;
  /** Worth another model call. Advisory problems are reported and kept. */
  repair: boolean;
}

/** A name the model gave that did not resolve to exactly one anchor. */
export interface NameIssue {
  page: number | "front" | "back";
  name: string;
  kind: "unknown" | "ambiguous";
}

// ---------------------------------------------------------------------------
// Who is on a page, from what the page says
// ---------------------------------------------------------------------------

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Hit {
  anchorId: string;
  start: number;
  end: number;
}

/** Whole-word spans of an anchor's names in `text`. */
function hitsFor(text: string, anchor: Anchor): Hit[] {
  const lowered = text.toLowerCase();
  const hits: Hit[] = [];
  for (const key of anchorNameKeys(anchor)) {
    if (key.length < 2) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(key)}(?![\\p{L}\\p{N}])`, "gu");
    for (const match of lowered.matchAll(re)) {
      hits.push({ anchorId: anchor.id, start: match.index!, end: match.index! + match[0].length });
    }
  }
  return hits;
}

/**
 * The anchors a text names, each counted only where a longer name does not
 * already say it: "Mia's Mom" names Mom, not Mia too.
 */
export function anchorsNamedOnPage(text: string, anchors: readonly Anchor[]): Anchor[] {
  const hits = anchors.filter((a) => a.include !== false).flatMap((a) => hitsFor(text, a));
  const named = new Set<string>();
  for (const hit of hits) {
    const covered = hits.some(
      (other) =>
        other.anchorId !== hit.anchorId &&
        other.start <= hit.start &&
        other.end >= hit.end &&
        other.end - other.start > hit.end - hit.start,
    );
    if (!covered) named.add(hit.anchorId);
  }
  return anchors.filter((a) => named.has(a.id));
}

const nameOf = (anchors: readonly Anchor[], id: string): string => anchors.find((a) => a.id === id)?.name ?? "";

function withAnchors<T extends { anchorIds: string[]; anchorNames?: string[] }>(
  target: T,
  anchors: readonly Anchor[],
  extra: Anchor[],
): T {
  const ids = [...target.anchorIds];
  for (const anchor of extra) if (!ids.includes(anchor.id)) ids.push(anchor.id);
  if (ids.length === target.anchorIds.length) return target;
  return { ...target, anchorIds: ids, anchorNames: ids.map((id) => nameOf(anchors, id)) };
}

/**
 * Puts everyone the page names on the page. A person the words or the picture
 * brief name is drawn from their reference sheet, never from a guess; and the
 * book's heroes appear on the front cover. A person the model listed stays.
 */
export function completeScreenplayCast(
  doc: ScreenplayDoc,
  anchors: readonly Anchor[],
  heroNames: readonly string[],
): ScreenplayDoc {
  const spreads = doc.spreads.map((spread) =>
    spread.placeholder
      ? spread
      : withAnchors(spread, anchors, anchorsNamedOnPage(`${spread.text}\n${spread.illustration}`, anchors)),
  );
  let frontCover: CoverSpec | undefined = doc.frontCover;
  if (frontCover) {
    frontCover = withAnchors(frontCover, anchors, anchorsNamedOnPage(frontCover.illustration, anchors));
    const heroKeys = new Set(heroNames.map(normalizeAnchorName).filter(Boolean));
    const heroes = anchors.filter(
      (a) => a.type === "character" && a.include !== false && anchorNameKeys(a).some((key) => heroKeys.has(key)),
    );
    const onCover = frontCover.anchorIds.some((id) => heroes.some((h) => h.id === id));
    if (heroes.length > 0 && !onCover) frontCover = withAnchors(frontCover, anchors, [heroes[0]!]);
  }
  return { ...doc, spreads, ...(frontCover ? { frontCover } : {}) };
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export interface ScreenplayCheckInput {
  doc: ScreenplayDoc;
  /** The anchors the plan may use. */
  anchors: readonly Anchor[];
  /** The story as the page plan read it, break markers included. */
  story: string;
  /** The author's words are printed exactly as written. */
  exact: boolean;
  /** Compare the pages' words with the story. False for a requested edit, which may change them. */
  checkText: boolean;
  profile?: AudienceProfile;
  /** The book language's word-count factor. */
  wordFactor: number;
  names: readonly NameIssue[];
  /** How many pages the plan may leave wordless. */
  wordlessAllowed: number;
  /** Lines that belong together which only a reader hears (rhymes, refrains); the text's own structure is always read. */
  ties?: readonly Tie[];
  /** The book's language, for reading sentences. */
  locale?: string;
}

export interface ScreenplayCheck {
  problems: ScreenplayProblem[];
  /** Lower is better; a plan that loses the story's words outweighs everything else. */
  score: number;
  /** The problems a repair call should fix, as the request it is given; "" when nothing needs repair. */
  instruction: string;
}

const WEIGHT: Record<ScreenplayProblemCode, number> = {
  "text-mismatch": 100,
  "verse-split": 20,
  "empty-text": 10,
  "name-unknown": 3,
  "name-ambiguous": 3,
  "too-many-figures": 3,
  "empty-brief": 5,
  "over-density": 2,
  "spread-misplaced": 4,
  "wordless-misuse": 4,
};

const label = (page: number | "front" | "back" | undefined): string =>
  page === "front" ? "the front cover" : page === "back" ? "the back cover" : page ? `page ${page}` : "the plan";

export function inspectScreenplay(input: ScreenplayCheckInput): ScreenplayCheck {
  const { doc, anchors, story, exact, profile, wordFactor, names } = input;
  const problems: ScreenplayProblem[] = [];
  const add = (problem: ScreenplayProblem) => problems.push(problem);
  const spreads = doc.spreads;
  const pageTexts = spreads.map((s) => (s.wordless ? "" : s.text ?? ""));

  // 1. The pages carry the story's words, once, in order; and no stanza is cut.
  if (input.checkText && exact) {
    const mismatch = firstTextMismatch(story, pageTexts);
    if (mismatch) {
      add({
        code: "text-mismatch",
        page: mismatch.page <= spreads.length ? mismatch.page : undefined,
        repair: true,
        message: mismatch.found
          ? `${label(mismatch.page)} does not carry the author's words as written. The story continues "${mismatch.expected}" but the page says "${mismatch.found}".`
          : `The author's words are not all on the pages: the story continues "${mismatch.expected}" after the last page.`,
      });
    } else {
      // A page turn may fall through lines that belong together only when no
      // plan of this many pages could avoid it; then it falls where it costs least.
      const cuts = inspectCuts(story, pageTexts, { ties: input.ties, locale: input.locale });
      for (const cut of cuts?.excess ?? []) {
        add({ code: "verse-split", page: cut.page, repair: true, message: describeCut(cut) });
      }
    }
  }

  // 2. Every page has words or is wordless on purpose, and a picture brief.
  spreads.forEach((spread, i) => {
    if (spread.placeholder) return;
    const page = i + 1;
    if (!spread.illustration.trim()) {
      add({ code: "empty-brief", page, repair: true, message: `${label(page)} has no picture brief.` });
    }
    if (!spread.wordless && !(spread.text ?? "").trim() && !spread.blankCanvas) {
      add({
        code: "empty-text",
        page,
        repair: true,
        message: `${label(page)} has no words. Give it the story's words for that moment, or leave it out.`,
      });
    }
  });

  // 3. A wordless page is rare, deliberate and never the opening or two in a row.
  const wordless = spreads.map((s) => Boolean(s.wordless));
  const count = wordless.filter(Boolean).length;
  if (count > input.wordlessAllowed) {
    add({
      code: "wordless-misuse",
      repair: true,
      message:
        input.wordlessAllowed === 0
          ? "This book has no wordless pages: give every page its words."
          : `At most ${input.wordlessAllowed} page${input.wordlessAllowed === 1 ? "" : "s"} may be wordless; ${count} are.`,
    });
  } else {
    wordless.forEach((is, i) => {
      if (is && (i === 0 || wordless[i - 1])) {
        add({
          code: "wordless-misuse",
          page: i + 1,
          repair: true,
          message: `${label(i + 1)} is wordless, but a wordless page never opens the book and never follows another.`,
        });
      }
    });
  }

  // 4. Names that did not resolve to exactly one person.
  const valid = anchors.map((a) => a.name).join(", ") || "none";
  for (const issue of names) {
    add({
      code: issue.kind === "unknown" ? "name-unknown" : "name-ambiguous",
      page: issue.page,
      repair: true,
      message:
        issue.kind === "unknown"
          ? `${label(issue.page)} lists "${issue.name}", who is not in the cast. Use only these exact names: ${valid}. Anyone else in the picture is an anonymous background figure and is not named.`
          : `${label(issue.page)} lists "${issue.name}", which matches more than one anchor. Use the exact name of one of: ${valid}.`,
    });
  }

  // 5. Age band: how many figures share a picture, and how much a page holds.
  if (profile) {
    const limit = profile.density.maxFocalCharactersPerScene;
    if (limit > 0) {
      spreads.forEach((spread, i) => {
        if (spread.placeholder) return;
        const figures = spread.anchorIds.filter((id) => anchors.find((a) => a.id === id)?.type === "character");
        const named = anchorsNamedOnPage(spread.text ?? "", anchors).filter((a) => a.type === "character").length;
        const allowed = Math.max(limit, named);
        if (figures.length > allowed) {
          add({
            code: "too-many-figures",
            page: i + 1,
            repair: true,
            message: `${label(i + 1)} shows ${figures.length} characters; a picture for ${profile.label} holds at most ${allowed}. Keep only those the words are about.`,
          });
        }
      });
    }
    const density = inspectScreenplayDensity(doc, profile, wordFactor);
    for (const over of density.overLimit) {
      add({
        code: "over-density",
        page: over.index,
        // The author's own words are not shortened to fit; a report is enough.
        repair: !exact,
        message: `${label(over.index)} has ${over.words} words; ${profile.label} usually holds at most ${over.limit}. Split it over two pages or tighten it.`,
      });
    }
    for (const over of inspectPageSentences(doc, profile)) {
      add({
        code: "over-density",
        page: over.index,
        repair: !exact,
        message: `${label(over.index)} has ${over.sentences} sentences, far more than one beat.`,
      });
    }
  }

  // 6. Printing: a double-page spread starts on a left-hand page.
  for (const issue of paginate(doc).issues) {
    add({
      code: "spread-misplaced",
      page: issue.index + 1,
      repair: true,
      message: `${label(issue.index + 1)} is a double-page spread but would start on a right-hand page. Make it a single page, or arrange the pages before it so that it starts on a left-hand page (an even number of single pages comes before it).`,
    });
  }

  const score = problems.reduce((sum, p) => sum + WEIGHT[p.code], 0);
  const repairable = problems.filter((p) => p.repair);
  const instruction =
    repairable.length === 0
      ? ""
      : `Fix exactly these problems and change nothing else. Keep every page that is not named here exactly as it is.\n${repairable
          .map((p) => `- ${p.message}`)
          .join("\n")}`;
  return { problems, score, instruction };
}

/** Wordless pages a plan may carry: one for every eight pages, none for a first reader or in the author's own words. */
export function wordlessAllowance(pageCount: number, options: { exact: boolean; independent: boolean }): number {
  if (options.exact || options.independent) return 0;
  return Math.floor(pageCount / 8);
}

/** The spreads that carry no words of their own, for callers that lay a page out. */
export function isWordless(spread: Pick<ScreenplaySpread, "wordless" | "text">): boolean {
  return Boolean(spread.wordless) || !(spread.text ?? "").trim();
}
