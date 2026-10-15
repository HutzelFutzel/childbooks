/**
 * Pages by number, in the reader's words.
 *
 * One numbering for the whole app: the inside pages count from 1 in reading
 * order, exactly as the book on the left labels them ("Page 4"). A request is
 * resolved here by the app, never by the model: "page 18", "pages 3–5", "the
 * last page", "the back cover", "Seite 7". A reference is kept as the unit's id,
 * so adding or moving a page later can never make it point at the wrong one;
 * the number is read back from the book whenever it is shown.
 *
 * Pure: a project and a sentence in, ids out.
 */
import { COVER_BACK_ID, COVER_FRONT_ID, type Project } from "../types";
import { illustrationUnits } from "./units";

/** The inside pages' unit ids, in reading order. */
export function interiorUnitIds(project: Project): string[] {
  return illustrationUnits(project)
    .filter((unit) => unit.id !== COVER_FRONT_ID && unit.id !== COVER_BACK_ID)
    .map((unit) => unit.id);
}

/** The inside page number of a unit, counting from 1; null for a cover or an unknown unit. */
export function pageNumberOf(project: Project, unitId: string): number | null {
  const index = interiorUnitIds(project).indexOf(unitId);
  return index >= 0 ? index + 1 : null;
}

/** The unit on inside page `n`, or null when the book has no such page. */
export function unitIdOfPage(project: Project, n: number): string | null {
  return Number.isInteger(n) && n >= 1 ? (interiorUnitIds(project)[n - 1] ?? null) : null;
}

/** "page 4", "the front cover", "the back cover", or "a page that is gone". */
export function pageLabel(project: Project, unitId: string): string {
  if (unitId === COVER_FRONT_ID) return "the front cover";
  if (unitId === COVER_BACK_ID) return "the back cover";
  if (unitId === "*") return "the whole book";
  const n = pageNumberOf(project, unitId);
  return n === null ? "a page that is gone" : `page ${n}`;
}

/** Page numbers as one phrase: "page 4", "pages 4 and 6", "pages 3, 4 and 7", "pages 3–7". */
export function describePageNumbers(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `page ${sorted[0]}`;
  const consecutive = sorted.length > 2 && sorted.every((n, i) => i === 0 || n === sorted[i - 1]! + 1);
  if (consecutive) return `pages ${sorted[0]}–${sorted[sorted.length - 1]}`;
  return `pages ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/** Several pages as one phrase: "page 4", "pages 4 and 6", "pages 3–7", "page 1 and the front cover". */
export function describePages(project: Project, unitIds: readonly string[]): string {
  const numbers: number[] = [];
  const named: string[] = [];
  for (const id of unitIds) {
    const n = pageNumberOf(project, id);
    if (n !== null) numbers.push(n);
    else named.push(pageLabel(project, id));
  }
  const parts: string[] = [];
  if (numbers.length > 0) parts.push(describePageNumbers(numbers));
  parts.push(...[...new Set(named)]);
  if (parts.length <= 1) return parts[0] ?? "no page";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// --- Reading a sentence ----------------------------------------------------------------

export interface PageMentions {
  /** The units named, in the order the book shows them, covers first. */
  ids: string[];
  /** "all pages", "every page", "the whole book": the sentence means the whole book, not a list. */
  all: boolean;
  /** Page numbers the sentence names that the book does not have. */
  missing: number[];
}

const PAGE_WORD = "(?:pages?|seiten?|p\\.|pp\\.)";
const NUMBER = "\\d{1,3}";
const RANGE_JOINER = "(?:-|–|—|to|through|thru|until|bis|\\.\\.)";
const LIST_JOINER = "(?:,|and|und|&|\\+)";
// "pages 3, 5 and 7–9": a word, then numbers and ranges joined by commas or "and".
const NUMBER_RUN = new RegExp(
  `\\b${PAGE_WORD}\\s*((?:${NUMBER}(?:\\s*${RANGE_JOINER}\\s*${NUMBER})?)(?:\\s*${LIST_JOINER}\\s*(?:${NUMBER}(?:\\s*${RANGE_JOINER}\\s*${NUMBER})?))*)`,
  "giu",
);

const ALL_PATTERN =
  /\b(?:all|every|each)\s+(?:the\s+)?(?:pages?|spreads?)\b|\b(?:the\s+)?(?:whole|entire)\s+book\b|\balle\s+seiten\b|\bjede\s+seite\b|\bdas\s+ganze\s+buch\b|\bim\s+ganzen\s+buch\b|\bthroughout\s+the\s+book\b|\beverywhere\b/iu;
const LAST_PATTERN = /\b(?:the\s+)?(?:last|final)\s+page\b|\bletzte\s+seite\b/iu;
const FIRST_PATTERN = /\b(?:the\s+)?first\s+page\b|\berste\s+seite\b/iu;
const BACK_PATTERN =
  /\b(?:the\s+)?back\s*[-\s]?cover\b|\brear\s+cover\b|\br(?:ü|ue)ckseite\b|\bhinterer?\s+umschlag\b|\bbackcover\b/iu;
const FRONT_PATTERN =
  /\b(?:the\s+)?front\s*[-\s]?cover\b|\bvorderseite\b|\btitelseite\b|\bvorderer?\s+umschlag\b|\bfrontcover\b|\b(?:the|my|this)\s+cover\b|\bcover\s+(?:page|art|image|picture|words|text|title)\b|\b(?:on|of|for|to|in|at)\s+cover\b|\bdas\s+cover\b|\bden\s+umschlag\b/iu;

/**
 * Which pages a sentence names. Reading only: it does not decide what the
 * sentence asks for, and a sentence that names no page returns nothing.
 */
export function pagesNamedIn(text: string, project: Project): PageMentions {
  const interior = interiorUnitIds(project);
  const picked = new Set<string>();
  const missing = new Set<number>();
  const take = (n: number) => {
    const id = n >= 1 ? interior[n - 1] : undefined;
    if (id) picked.add(id);
    else missing.add(n);
  };

  for (const match of text.matchAll(NUMBER_RUN)) {
    const run = match[1] ?? "";
    for (const item of run.split(new RegExp(`\\s*${LIST_JOINER}\\s*`, "iu"))) {
      const range = item.match(new RegExp(`(${NUMBER})\\s*${RANGE_JOINER}\\s*(${NUMBER})`, "iu"));
      if (range) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        const [low, high] = from <= to ? [from, to] : [to, from];
        // A runaway range is a typo, not a request for a hundred pages.
        for (let n = low; n <= Math.min(high, low + 200); n += 1) take(n);
        continue;
      }
      const single = item.match(new RegExp(`(${NUMBER})`, "u"));
      if (single) take(Number(single[1]));
    }
  }
  if (LAST_PATTERN.test(text) && interior.length > 0) picked.add(interior[interior.length - 1]!);
  if (FIRST_PATTERN.test(text) && interior.length > 0) picked.add(interior[0]!);

  const wantsBack = BACK_PATTERN.test(text);
  const withoutBack = text.replace(BACK_PATTERN, " ");
  const wantsFront = FRONT_PATTERN.test(withoutBack);
  const ids = [
    ...(wantsFront ? [COVER_FRONT_ID] : []),
    ...(wantsBack ? [COVER_BACK_ID] : []),
    ...interior.filter((id) => picked.has(id)),
  ];
  return { ids, all: ALL_PATTERN.test(text), missing: [...missing].sort((a, b) => a - b) };
}
