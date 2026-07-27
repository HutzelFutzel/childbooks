/**
 * Print preflight: the checks worth making BEFORE money moves.
 *
 * These are all things a printer will happily print and a reader will then
 * find wrong — text cut off at the trim, a line disappearing into the binding,
 * a page that turns out blank. None of them are visible in the editor, which
 * shows a page as a rectangle with no notion of where the knife lands.
 *
 * Advisory by design. The geometry is a comfort margin, not a hard limit, and
 * a designer who deliberately runs a word to the edge shouldn't be blocked —
 * so callers surface these as warnings and let the customer decide.
 */
import type { BookDesign, TextBox } from "../design";
import type { BookProduct } from "../fulfillment/types";
import { safeArea, withinSafeArea, type LeafSide } from "./geometry";
import type { LeafPlan } from "./pagePlan";

export type PreflightCode =
  | "text-outside-safe-area"
  | "text-crosses-gutter"
  | "page-has-no-artwork";

export interface PreflightIssue {
  code: PreflightCode;
  /** The design page the reader would need to open to fix it. */
  pageId: string;
  pageLabel: string;
  message: string;
}

/** Text boxes that actually put ink on the page. */
function visibleTextBoxes(design: BookDesign, pageId: string): TextBox[] {
  const page = design.pages[pageId];
  if (!page) return [];
  return page.textBoxes.filter(
    (box) => !box.hidden && box.paragraphs.some((p) => p.spans.some((s) => s.text.trim())),
  );
}

/**
 * Re-express a rect that is normalized to a SPREAD in terms of one of its
 * leaves. Returns null when the rect doesn't reach this leaf at all.
 */
function rectOnLeaf(
  rect: { x: number; y: number; w: number; h: number },
  half: LeafSide,
): { x: number; y: number; w: number; h: number } | null {
  const start = half === "left" ? 0 : 0.5;
  const end = start + 0.5;
  if (rect.x + rect.w <= start || rect.x >= end) return null;
  const x = (Math.max(rect.x, start) - start) * 2;
  const w = (Math.min(rect.x + rect.w, end) - Math.max(rect.x, start)) * 2;
  return { x, y: rect.y, w, h: rect.h };
}

export interface PreflightInput {
  plan: LeafPlan[];
  design: BookDesign;
  product: Pick<BookProduct, "trim">;
  /** Design page id -> whether that page has an illustration to print. */
  hasArtwork: (pageId: string) => boolean;
  /** Design page id -> the label the editor shows for it. */
  labelFor: (pageId: string) => string;
}

export function preflightInterior(input: PreflightInput): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const seenPages = new Set<string>();

  for (const leaf of input.plan) {
    const pageId = leaf.sourcePageId;
    if (!pageId) continue;
    const label = input.labelFor(pageId);
    const area = safeArea(input.product, leaf.side);

    for (const box of visibleTextBoxes(input.design, pageId)) {
      // On a spread, a box is placed against the full double-width surface, so
      // it has to be mapped onto this leaf before it can be judged against a
      // single page's margins.
      const rect = leaf.half ? rectOnLeaf(box.rect, leaf.half) : box.rect;
      if (!rect) continue;

      if (leaf.half && box.rect.x < 0.5 && box.rect.x + box.rect.w > 0.5) {
        // Only report the crossing once, not once per leaf.
        if (leaf.half === "left") {
          issues.push({
            code: "text-crosses-gutter",
            pageId,
            pageLabel: label,
            message: `Text on ${label} runs across the middle of the spread, where the pages meet at the binding. Part of it will curve into the fold.`,
          });
        }
        continue;
      }

      if (!withinSafeArea(rect, area)) {
        issues.push({
          code: "text-outside-safe-area",
          pageId,
          pageLabel: label,
          message: `Text on ${label} sits close to the edge or the binding. Move it inward so nothing is trimmed off or lost in the fold.`,
        });
      }
    }

    if (!seenPages.has(pageId)) {
      seenPages.add(pageId);
      if (!input.hasArtwork(pageId)) {
        issues.push({
          code: "page-has-no-artwork",
          pageId,
          pageLabel: label,
          message: `${label} has no illustration and will print blank.`,
        });
      }
    }
  }

  // One issue per page per code: a page with six text boxes over the margin is
  // one thing to go and fix, not six.
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.pageId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
