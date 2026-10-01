/**
 * Can this story be a hardcover? Deterministic, and never asked as a question.
 *
 * Reads the current draft, the reading age's words per page, and the minimum
 * page count and page step of the hardcover and softcover products for the
 * book's current shape. The numbers in every sentence come from those
 * products — never a fixed 24.
 *
 * - **natural**: the story already reaches a hardcover, or this shape has none.
 * - **spread**: it can reach the hardcover minimum by giving the moments it
 *   already has more room, without a page dropping under about half the words
 *   this age expects. Done without asking; one line says so.
 * - **short**: it can't. The shorter book is kept, the guide says so plainly,
 *   and spreading anyway (a thin stretch) waits for the reader to agree.
 */
import { BOOK_PRODUCTS, type BookProduct } from "../fulfillment";
import { bookProductForConfig } from "../book";
import type { AudienceDensity } from "../config/audienceCatalog";
import { wordCount } from "../story/brief";
import { restoreModelLineBreaks } from "../story/lineBreaks";
import type { BookConfig, HardcoverDecision } from "../types";

const HARD_BINDINGS = new Set(["casewrap", "linen-wrap"]);

/** Round a page count up to one the product sells. */
export function roundPages(product: Pick<BookProduct, "minPages" | "pageStep" | "maxPages">, pages: number): number {
  const step = Math.max(1, product.pageStep || 1);
  const min = Math.max(1, product.minPages || 1);
  const want = Math.max(min, Math.ceil(pages));
  const rounded = min + Math.ceil((want - min) / step) * step;
  return product.maxPages > 0 ? Math.min(rounded, product.maxPages) : rounded;
}

/** The hardcover and softcover products at the book's current trim. */
export function shapeProducts(config: Pick<BookConfig, "productSku" | "bookSize">): {
  hardcover: BookProduct | null;
  softcover: BookProduct | null;
} {
  const current = bookProductForConfig(config);
  const sameTrim = BOOK_PRODUCTS.filter(
    (p) => p.trim.widthIn === current.trim.widthIn && p.trim.heightIn === current.trim.heightIn,
  );
  const lowest = (list: BookProduct[]) =>
    list.sort((a, b) => a.minPages - b.minPages)[0] ?? null;
  return {
    hardcover: lowest(sameTrim.filter((p) => HARD_BINDINGS.has(p.binding))),
    softcover: lowest(sameTrim.filter((p) => !HARD_BINDINGS.has(p.binding))),
  };
}

/** The separate moments in a draft: its paragraphs. */
export function storyMoments(text: string): number {
  return restoreModelLineBreaks(text)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => wordCount(block) > 0).length;
}

export type HardcoverCase = "natural" | "spread" | "short" | "thin";

export interface HardcoverCheck {
  case: HardcoverCase;
  /** Pages the plan should aim at, already rounded to a count a product sells. */
  pages: number;
  /** Pages the story wants on its own. */
  naturalPages: number;
  wordsPerPage: number;
  /** Hardcover minimum at this shape; absent when this shape has no hardcover. */
  hardcoverMin?: number;
  /** The shorter book, rounded for the softcover; absent when no softcover exists. */
  softcoverPages?: number;
  /** Whether a product at this shape can print `pages`. */
  printable: boolean;
}

/**
 * @param decision the reader's answer to the short-story line, if any:
 *   `thin` agrees to spread anyway; `keep` (or nothing) keeps the shorter book.
 */
export function hardcoverCheck(
  config: Pick<BookConfig, "storyText" | "productSku" | "bookSize">,
  density: Pick<AudienceDensity, "targetWordsPerPage">,
  decision?: HardcoverDecision,
): HardcoverCheck {
  const words = wordCount(config.storyText);
  const wpp = Math.max(1, density.targetWordsPerPage || 1);
  const moments = Math.max(1, storyMoments(config.storyText));
  const naturalPages = Math.max(1, Math.ceil(words / wpp));
  const { hardcover, softcover } = shapeProducts(config);
  const soft = softcover ? roundPages(softcover, naturalPages) : undefined;

  if (!hardcover) {
    const pages = soft ?? naturalPages;
    return { case: "natural", pages, naturalPages, wordsPerPage: wpp, softcoverPages: soft, printable: soft !== undefined };
  }
  const hardMin = roundPages(hardcover, hardcover.minPages);
  if (naturalPages >= hardMin) {
    const pages = roundPages(hardcover, naturalPages);
    return { case: "natural", pages, naturalPages, wordsPerPage: wpp, hardcoverMin: hardMin, softcoverPages: soft, printable: true };
  }
  // A moment may carry onto a second page (a repetition this age enjoys); a new
  // event never counts as room.
  const sensible = words / hardMin >= wpp / 2 && moments * 2 >= hardMin;
  if (sensible || decision === "spread") {
    return { case: "spread", pages: hardMin, naturalPages, wordsPerPage: wpp, hardcoverMin: hardMin, softcoverPages: soft, printable: true };
  }
  if (decision === "thin") {
    return { case: "thin", pages: hardMin, naturalPages, wordsPerPage: wpp, hardcoverMin: hardMin, softcoverPages: soft, printable: true };
  }
  return {
    case: "short",
    pages: soft ?? naturalPages,
    naturalPages,
    wordsPerPage: wpp,
    hardcoverMin: hardMin,
    softcoverPages: soft,
    printable: soft !== undefined,
  };
}

/** The page target handed to the page plan for this check. */
export function pageTargetFor(check: HardcoverCheck): NonNullable<BookConfig["pageTarget"]> {
  return {
    pages: check.pages,
    wordsPerPage: check.wordsPerPage,
    case: check.case === "spread" ? "spread" : check.case === "thin" ? "thin" : "natural",
  };
}
