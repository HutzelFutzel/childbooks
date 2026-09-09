/**
 * Paper color for a page — behind every layer, never itself a layer.
 */
import { parseColor } from "../design/color";
import type { BookDesign, PageDesign } from "../../core/types";
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";

export const DEFAULT_PAGE_COLOR = "#ffffff";

export function pageColorOf(page: PageDesign | undefined): string {
  return page?.background?.color ?? DEFAULT_PAGE_COLOR;
}

export function pageColorsEqual(a: string, b: string): boolean {
  const pa = parseColor(a);
  const pb = parseColor(b);
  return (
    Math.round(pa.r) === Math.round(pb.r) &&
    Math.round(pa.g) === Math.round(pb.g) &&
    Math.round(pa.b) === Math.round(pb.b) &&
    Math.abs(pa.a - pb.a) < 0.001
  );
}

export function isInteriorPageId(pageId: string): boolean {
  return pageId !== COVER_FRONT_ID && pageId !== COVER_BACK_ID;
}

export function interiorPageIds(design: BookDesign): string[] {
  return Object.keys(design.pages).filter(isInteriorPageId);
}

export function pageColorAppliedToAll(design: BookDesign, color: string): boolean {
  const ids = interiorPageIds(design);
  if (ids.length === 0) return true;
  return ids.every((id) => pageColorsEqual(pageColorOf(design.pages[id]), color));
}

/** True when Apply to all would still change interiors or the new-page default. */
export function pageColorNeedsApplyToAll(design: BookDesign, color: string): boolean {
  if (interiorPageIds(design).length === 0) return false;
  if (!pageColorAppliedToAll(design, color)) return true;
  return !pageColorsEqual(design.defaultPageBackground?.color ?? DEFAULT_PAGE_COLOR, color);
}
