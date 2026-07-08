/**
 * Structural page layouts.
 *
 * Unlike the schematic `LAYOUT_TEMPLATES` in `config/options` (which only drove
 * a diagram + a textual hint), a `BookLayout` is *structural*: it says exactly
 * where the editable text column sits on a page and what the image model must
 * do to leave room for it. The renderer seeds text from `textRegion(side)` and
 * the illustration pipeline injects `imageGuidance(side)`, so the words and the
 * art always agree.
 *
 * MVP ships a single layout — `outer-text` — where the text hugs the OUTER edge
 * of each page (left on left-hand pages, right on right-hand pages) over a calm
 * ~one-third band the illustration keeps clear (a 1:2 text:art split). Adding a
 * new layout later is purely additive: register another `BookLayout` here and
 * everything (seeding, prompts, and any future picker) flows from it.
 */
import type { NormRect } from "../design";

/** Which physical side of the book a page sits on — drives the outer edge. */
export type PageSide = "left" | "right" | "spread";

export interface BookLayout {
  id: string;
  label: string;
  description: string;
  /** Fraction of page WIDTH reserved for the text column (rest is art). */
  textFraction: number;
  /** Premium layouts require a plan entitlement (none are, for now). */
  premium?: boolean;
  /**
   * The normalized (0..1) text-box rectangle for a page on the given side. The
   * column hugs the outer edge. A double-page `spread` gets a narrower column on
   * its far-left outer edge (callers may seed one box per outer edge later).
   */
  textRegion(side: PageSide): NormRect;
  /**
   * Per-page-side guidance appended to the illustration prompt so the model
   * keeps the text band calm and text-safe. Empty ⇒ no special guidance
   * (e.g. covers, which are excluded).
   */
  imageGuidance(side: PageSide): string;
  /**
   * Layout-level instruction for the screenplay model, so the page-by-page plan
   * it writes is consistent with how the pages are actually composed.
   */
  screenplayGuidance: string;
}

const OUTER_TEXT: BookLayout = {
  id: "outer-text",
  label: "Text on the outer edge",
  description:
    "Words sit in a calm column along the outer edge of each page — left on left-hand pages, right on right-hand pages — beside a full-bleed illustration.",
  textFraction: 1 / 3,
  textRegion(side) {
    // A comfortable text column with page margins. Left/right hug the outer
    // edge; a double spread uses a narrower far-left column (it's twice as wide).
    if (side === "right") return { x: 0.69, y: 0.1, w: 0.26, h: 0.8 };
    if (side === "spread") return { x: 0.03, y: 0.1, w: 0.14, h: 0.8 };
    return { x: 0.05, y: 0.1, w: 0.26, h: 0.8 };
  },
  imageGuidance(side) {
    if (side === "spread") {
      return "Composition: keep BOTH outer thirds of the image (far left and far right) calm, simple and free of important subjects, faces or busy detail — the story text sits along the outer edges. Keep the main focal action toward the center.";
    }
    const edge = side === "right" ? "RIGHT" : "LEFT";
    const opposite = side === "right" ? "left" : "right";
    return `Composition: reserve the ${edge} third of the image as a calm, uncluttered area — soft background tones, no important subjects, faces or fine detail there — so the story text has a clean place to sit. Place the main subject and focal action in the ${opposite} two-thirds.`;
  },
  screenplayGuidance:
    "Every page keeps its text in a calm column along the OUTER edge (left on left-hand pages, right on right-hand pages), about one-third of the page width, beside the illustration. In each spread's layoutNote, note that the outer-edge third stays calm and text-safe.",
};

/** All registered structural layouts, keyed by id. */
export const BOOK_LAYOUTS: Record<string, BookLayout> = {
  [OUTER_TEXT.id]: OUTER_TEXT,
};

/** The only layout available for now; also the fallback for legacy layout ids. */
export const DEFAULT_BOOK_LAYOUT_ID = OUTER_TEXT.id;

/** Resolve a layout by id, falling back to the default (covers legacy ids too). */
export function getBookLayout(id: string | undefined | null): BookLayout {
  return (id && BOOK_LAYOUTS[id]) || BOOK_LAYOUTS[DEFAULT_BOOK_LAYOUT_ID];
}

/** Layouts a user may choose from (MVP: just the default). */
export function selectableBookLayouts(): BookLayout[] {
  return Object.values(BOOK_LAYOUTS);
}
