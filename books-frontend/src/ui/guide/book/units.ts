import { illustrationUnits } from "../../../core/book/units";
import type { GuideTarget } from "../../../core/guide/target";
import { COVER_BACK_ID, COVER_FRONT_ID, type Project } from "../../../core/types";
import { contentSpreadIds, type DisplaySpread } from "../../studio/spreadModel";

/** The illustration units a displayed spread shows. */
export function dispUnitIds(disp: DisplaySpread): string[] {
  if (disp.cover === "front") return [COVER_FRONT_ID];
  if (disp.cover === "back") return [COVER_BACK_ID];
  return contentSpreadIds(disp);
}

/** The inside page number of a unit, counting from 1; null for a cover. */
export function pageNumberOf(project: Project, unitId: string): number | null {
  if (unitId === COVER_FRONT_ID || unitId === COVER_BACK_ID) return null;
  const inside = illustrationUnits(project).filter((u) => u.id !== COVER_FRONT_ID && u.id !== COVER_BACK_ID);
  const index = inside.findIndex((u) => u.id === unitId);
  return index >= 0 ? index + 1 : null;
}

/** The chip for a unit on the book. */
export function unitTarget(project: Project, unitId: string): GuideTarget {
  const page = pageNumberOf(project, unitId);
  return page === null ? { kind: "cover", unitId } : { kind: "page", unitId, page };
}

/** The display index that shows a unit, or -1. */
export function dispIndexOf(displays: readonly DisplaySpread[], unitId: string): number {
  return displays.findIndex((d) => dispUnitIds(d).includes(unitId));
}
