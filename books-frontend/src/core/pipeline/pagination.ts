/**
 * Physical pagination + printability for the screenplay.
 *
 * In a bound book, pages alternate: odd numbers are right-hand pages (recto),
 * even numbers are left-hand pages (verso). Page 1 is a lone right-hand page.
 * A double-page spread must occupy a *facing pair* — a left (even) page and the
 * next right (odd) page — so it MUST start on an even page. Otherwise the single
 * illustration would be split across the binding/page-turn, which can't print.
 */
import type { ScreenplayDoc, ScreenplaySpread } from "../types";

export interface PageSlot {
  pageNumber: number;
  spread: ScreenplaySpread;
  /** Set on the two halves of a double-page spread. */
  isSpreadLeft?: boolean;
  isSpreadRight?: boolean;
}

export interface PaginationIssue {
  spreadId: string;
  /** Index of the offending spread within doc.spreads. */
  index: number;
  pageNumber: number;
  message: string;
}

/** A facing pair as the reader sees it: a left page and a right page. */
export interface FacingPair {
  left: PageSlot | null;
  right: PageSlot | null;
}

export interface Pagination {
  pages: PageSlot[];
  pairs: FacingPair[];
  issues: PaginationIssue[];
  valid: boolean;
  pageCount: number;
  /** spreadId -> page numbers it occupies. */
  pageMap: Map<string, number[]>;
  invalidIds: Set<string>;
}

const SPREAD_ISSUE =
  "A double-page spread must start on a left-hand (even) page so it doesn't cross the binding. Add a single page before it.";

export function paginate(doc: ScreenplayDoc): Pagination {
  const pages: PageSlot[] = [];
  const issues: PaginationIssue[] = [];
  const pageMap = new Map<string, number[]>();
  let page = 1;

  doc.spreads.forEach((spread, index) => {
    if (spread.kind === "spread") {
      // A spread must begin on an even page (left/verso).
      if (page % 2 === 1) {
        issues.push({
          spreadId: spread.id,
          index,
          pageNumber: page,
          message: SPREAD_ISSUE,
        });
      }
      pages.push({ pageNumber: page, spread, isSpreadLeft: true });
      pages.push({ pageNumber: page + 1, spread, isSpreadRight: true });
      pageMap.set(spread.id, [page, page + 1]);
      page += 2;
    } else {
      pages.push({ pageNumber: page, spread });
      pageMap.set(spread.id, [page]);
      page += 1;
    }
  });

  // Build facing pairs: page 1 stands alone on the right, then (2,3), (4,5)…
  const pairs: FacingPair[] = [];
  if (pages.length > 0) {
    pairs.push({ left: null, right: pages[0] });
    for (let i = 1; i < pages.length; i += 2) {
      pairs.push({ left: pages[i] ?? null, right: pages[i + 1] ?? null });
    }
  }

  return {
    pages,
    pairs,
    issues,
    valid: issues.length === 0,
    pageCount: page - 1,
    pageMap,
    invalidIds: new Set(issues.map((i) => i.spreadId)),
  };
}

function fillerId(): string {
  return `blank_${Math.random().toString(36).slice(2, 10)}`;
}

function makeFiller(): ScreenplaySpread {
  return {
    id: fillerId(),
    kind: "single",
    text: "",
    illustration: "",
    layoutNote: "Blank page inserted to keep spreads printable.",
    anchorIds: [],
    placeholder: true,
  };
}

/**
 * Returns a printable version of the doc by inserting blank single pages before
 * any spread that would otherwise start on a right-hand (odd) page.
 */
export function fixPagination(doc: ScreenplayDoc): ScreenplayDoc {
  const out: ScreenplaySpread[] = [];
  let page = 1;
  for (const spread of doc.spreads) {
    if (spread.kind === "spread" && page % 2 === 1) {
      out.push(makeFiller());
      page += 1;
    }
    out.push(spread);
    page += spread.kind === "spread" ? 2 : 1;
  }
  return { ...doc, spreads: out };
}
