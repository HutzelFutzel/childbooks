/**
 * Whether a page (or cover) is finished enough to leave the Pages step.
 *
 * Artwork is one way to be done — not the only way. A user can keep a page as
 * text, or as an intentionally blank canvas, and later kinds can be added
 * without changing the progress gate.
 */
import type { Project, ScreenplaySpread } from "../types";
import { getCursor } from "../versioning";

/** Persisted non-art completions. Illustrated is derived from current artwork. */
export type PageCompletion = "blank" | "text";

/** Why a unit counts as done. `null` means it still needs attention. */
export type PageDoneReason = "illustrated" | PageCompletion;

export function unitHasArtwork(project: Project, unitId: string): boolean {
  const tree = project.illustrations?.[unitId];
  return Boolean(tree && getCursor(tree).content.blobId);
}

/**
 * True when this unit should be sent to the image model. Covers always need
 * art; interior pages can opt out with a completion or a blank canvas.
 */
export function unitNeedsArtwork(unit: ScreenplaySpread): boolean {
  if (unit.placeholder) return false;
  if (unit.blankCanvas) return false;
  if (unit.completion === "text" || unit.completion === "blank") return false;
  return true;
}

export function unitDoneReason(
  project: Project,
  unit: ScreenplaySpread,
): PageDoneReason | null {
  if (unit.placeholder) return "blank";
  if (unit.completion === "text") return "text";
  if (unit.completion === "blank" || unit.blankCanvas) return "blank";
  if (unitHasArtwork(project, unit.id)) return "illustrated";
  return null;
}

export function unitIsDone(project: Project, unit: ScreenplaySpread): boolean {
  return unitDoneReason(project, unit) !== null;
}
