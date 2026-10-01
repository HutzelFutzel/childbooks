/**
 * Print preflight: the checks worth making BEFORE money moves.
 *
 * These are all things a printer will happily print and a reader will then
 * find wrong — text cut off at the trim, a line disappearing into the binding,
 * a page that turns out blank. None of them are visible in the editor, which
 * shows a page as a rectangle with no notion of where the knife lands.
 *
 * The safe area is the one the layouts are fitted into
 * (`computePageGuides`), so text the app placed can never fail it: a check
 * with its own, stricter margins flagged every freshly drawn page.
 */
import { computePageGuides, type BindingSide, type FormatCapabilities } from "../book/format";
import type { BookDesign, TextBox } from "../design";
import { withinSafeArea } from "./geometry";
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

export interface PreflightInput {
  plan: LeafPlan[];
  design: BookDesign;
  /** The book's print capabilities (`formatCapabilitiesForProject`). */
  caps: FormatCapabilities;
  /** Design page id -> whether that page has an illustration to print. */
  hasArtwork: (pageId: string) => boolean;
  /** Design page id -> the label the editor shows for it. */
  labelFor: (pageId: string) => string;
}

/** A recto binds on its left edge, a verso on its right. */
function bindingOf(side: LeafPlan["side"]): BindingSide {
  return side === "right" ? "left" : "right";
}

export function preflightInterior(input: PreflightInput): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const seenPages = new Set<string>();

  for (const leaf of input.plan) {
    const pageId = leaf.sourcePageId;
    if (!pageId) continue;
    const label = input.labelFor(pageId);

    // A spread is laid out on its double-width surface, so it is judged there,
    // once, rather than leaf by leaf.
    if (leaf.half !== "right") {
      const spread = Boolean(leaf.half);
      const { safe } = computePageGuides({
        caps: input.caps,
        spread,
        bindingSide: spread ? "center" : bindingOf(leaf.side),
      });
      for (const box of visibleTextBoxes(input.design, pageId)) {
        if (spread && box.rect.x < 0.5 && box.rect.x + box.rect.w > 0.5) {
          issues.push({
            code: "text-crosses-gutter",
            pageId,
            pageLabel: label,
            message: `Text on ${label} runs across the middle of the spread, where the pages meet at the binding. Part of it will curve into the fold.`,
          });
          continue;
        }
        if (!withinSafeArea(box.rect, safe)) {
          issues.push({
            code: "text-outside-safe-area",
            pageId,
            pageLabel: label,
            message: `Text on ${label} sits close to the edge or the binding. Move it inward so nothing is trimmed off or lost in the fold.`,
          });
        }
      }
    }

    if (!seenPages.has(pageId)) {
      seenPages.add(pageId);
      const hasText = visibleTextBoxes(input.design, pageId).length > 0;
      if (!input.hasArtwork(pageId) && !hasText) {
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
