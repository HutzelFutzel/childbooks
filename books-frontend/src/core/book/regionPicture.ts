/**
 * A spot the reader marked on a page, read against the picture that is on it.
 *
 * The reader drags over the page as they see it; the redraw needs the spot in
 * the picture's own 0..1 space. A page often shows its picture in only part of
 * it (a frame beside the words), so the two are not the same rectangle and the
 * spot has to be mapped across, or the mask would land on the wrong pixels.
 */
import { resolveIllustrationSlotId, type NormRect } from "../design";
import type { Project } from "../types";

const WHOLE_PAGE: NormRect = { x: 0, y: 0, w: 1, h: 1 };

/** Smallest side (of the picture) worth painting inside; below it the mark is a slip of the hand. */
export const MIN_SPOT = 0.03;

/** Where a unit's picture sits on its page, in page space; the whole page when it carries no placed picture. */
export function pictureRectOnPage(project: Project, unitId: string): NormRect {
  const images = project.design?.pages?.[unitId]?.images ?? [];
  const placed = images.find((el) => el.kind === "illustration" && resolveIllustrationSlotId(el, unitId) === unitId);
  const rect = placed?.rect;
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return WHOLE_PAGE;
  return rect;
}

/**
 * The marked spot in the picture's own space: the part of the spot that lies on
 * the picture, as fractions of it. Null when the spot is off the picture or
 * too little of it is on.
 */
export function regionOnPicture(spot: NormRect, picture: NormRect): NormRect | null {
  const x0 = Math.max(spot.x, picture.x);
  const y0 = Math.max(spot.y, picture.y);
  const x1 = Math.min(spot.x + spot.w, picture.x + picture.w);
  const y1 = Math.min(spot.y + spot.h, picture.y + picture.h);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  const out = { x: (x0 - picture.x) / picture.w, y: (y0 - picture.y) / picture.h, w: (x1 - x0) / picture.w, h: (y1 - y0) / picture.h };
  return out.w >= MIN_SPOT && out.h >= MIN_SPOT ? out : null;
}
