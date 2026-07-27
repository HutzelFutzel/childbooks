/**
 * The physical leaf plan for a book's interior.
 *
 * A "design page" and a "printed page" are not the same thing, and conflating
 * them is what let the order flow price a book by one count while shipping a
 * PDF with another:
 *
 *   - a double-page spread is ONE design page but TWO printed leaves;
 *   - a pagination filler (the blank inserted so a spread starts on a verso)
 *     is a printed leaf with no design page at all.
 *
 * {@link paginate} already knows the physical truth, so the plan is derived
 * from it rather than from the editor's page list. Everything downstream — the
 * page count that gets priced, the spine width, the capture list, the blank
 * padding — reads the same plan.
 */
import { paginate } from "../pipeline/pagination";
import type { ScreenplayDoc } from "../types";
import type { LeafSide } from "./geometry";

export interface LeafPlan {
  /**
   * Capture identity. For a spread this is `${spreadId}#left` / `#right`, which
   * is also the `data-export-page` attribute the renderer emits, so a capture
   * loop can find its element without knowing anything about spreads.
   */
  id: string;
  /** Design page to capture from, or null for a blank leaf. */
  sourcePageId: string | null;
  /** Which half of a spread this leaf is, when it is one. */
  half: LeafSide | null;
  /** 1-based physical page number. Odd is recto (right-hand). */
  pageNumber: number;
  /** Which side of the book the leaf falls on — drives the gutter margin. */
  side: LeafSide;
  label: string;
}

function sideOf(pageNumber: number): LeafSide {
  return pageNumber % 2 === 1 ? "right" : "left";
}

/** Every printed leaf of the interior, in reading order. */
export function interiorLeafPlan(doc: ScreenplayDoc | null): LeafPlan[] {
  if (!doc) return [];
  return paginate(doc).pages.map((slot) => {
    const side = sideOf(slot.pageNumber);
    const base = {
      pageNumber: slot.pageNumber,
      side,
      label: `Page ${slot.pageNumber}`,
    };
    // A filler carries no artwork or text by construction — it exists purely to
    // push the next spread onto a left-hand page.
    if (slot.spread.placeholder) {
      return { ...base, id: `blank-${slot.pageNumber}`, sourcePageId: null, half: null };
    }
    if (slot.isSpreadLeft || slot.isSpreadRight) {
      const half: LeafSide = slot.isSpreadLeft ? "left" : "right";
      return {
        ...base,
        id: `${slot.spread.id}#${half}`,
        sourcePageId: slot.spread.id,
        half,
      };
    }
    return { ...base, id: slot.spread.id, sourcePageId: slot.spread.id, half: null };
  });
}

/** How many leaves the interior physically has (covers excluded). */
export function physicalPageCount(doc: ScreenplayDoc | null): number {
  return interiorLeafPlan(doc).length;
}
