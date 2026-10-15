import { pageNumberOf } from "../../../core/book/pageRefs";
import type { GuideTarget } from "../../../core/guide/target";
import { COVER_BACK_ID, COVER_FRONT_ID, type Project } from "../../../core/types";
import { contentSpreadIds, type DisplaySpread } from "../../studio/spreadModel";

/** The illustration units a displayed spread shows. */
export function dispUnitIds(disp: DisplaySpread): string[] {
  if (disp.cover === "front") return [COVER_FRONT_ID];
  if (disp.cover === "back") return [COVER_BACK_ID];
  return contentSpreadIds(disp);
}

/**
 * Where each unit sits on the displayed spread, in percent of its width. A page
 * alone beside an empty side (the first page, the last) takes its own side, not
 * the whole spread; a picture across both pages takes both; a cover is the
 * middle half, as drawn.
 */
export function unitSlots(disp: DisplaySpread): { unitId: string; left: number; width: number }[] {
  if (disp.cover) return dispUnitIds(disp).map((unitId) => ({ unitId, left: 0, width: 100 }));
  if (disp.kind === "full") return [{ unitId: disp.entry.page.id, left: 0, width: 100 }];
  const slots: { unitId: string; left: number; width: number }[] = [];
  [disp.left, disp.right].forEach((side, index) => {
    if (side.kind === "page" && side.entry.subject.kind === "spread") {
      slots.push({ unitId: side.entry.page.id, left: index * 50, width: 50 });
    }
  });
  return slots;
}

export { pageNumberOf };

/** The chip for a unit on the book. */
export function unitTarget(project: Project, unitId: string): Extract<GuideTarget, { kind: "page" | "cover" }> {
  const page = pageNumberOf(project, unitId);
  return page === null ? { kind: "cover", unitId } : { kind: "page", unitId, page };
}

/** The display index that shows a unit, or -1. */
export function dispIndexOf(displays: readonly DisplaySpread[], unitId: string): number {
  return displays.findIndex((d) => dispUnitIds(d).includes(unitId));
}
