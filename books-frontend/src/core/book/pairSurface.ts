/**
 * Facing-pair geometry: two single pages sharing one double-wide surface.
 *
 * Each page still owns its elements (page-local rects, which may overflow the
 * trim when something continues across the fold). Combined space is what the
 * editor, preview, and print compositor speak — x in 0..1 over both leaves.
 *
 * Page backgrounds stay per-leaf (`rightSurface`). Generated page art may
 * overflow like any other element; the bitmap stays bound to the owner leaf
 * via {@link ImageElement.pairLeaf}, not the fold-crossing center.
 */
import type { ImageElement, NormRect, PageDesign } from "../design";

/** Map a page-local (0..1) rect into its half of the combined double-wide surface. */
export function toCombinedRect(rect: NormRect, isRight: boolean): NormRect {
  return { x: (isRight ? 0.5 : 0) + rect.x / 2, y: rect.y, w: rect.w / 2, h: rect.h };
}

/** Inverse of {@link toCombinedRect} — combined-space rect back to page-local. */
export function fromCombinedRect(rect: NormRect, isRight: boolean): NormRect {
  return { x: (rect.x - (isRight ? 0.5 : 0)) * 2, y: rect.y, w: rect.w * 2, h: rect.h };
}

export function mapPairElements<T extends { rect: NormRect }>(list: T[], isRight: boolean): T[] {
  return list.map((el) => ({ ...el, rect: toCombinedRect(el.rect, isRight) }));
}

function withPairLeaf(image: ImageElement, leaf: "left" | "right"): ImageElement {
  return image.kind === "illustration" ? { ...image, pairLeaf: leaf } : image;
}

/**
 * Which leaf an illustration is bound to on a merged pair surface.
 * Prefer the stamp from {@link mergePairDesign}; fall back to the fold center
 * only for unmarked frames (true spreads, lone pages).
 */
export function illustrationLeaf(
  image: Pick<ImageElement, "kind" | "pairLeaf" | "rect">,
): "left" | "right" {
  if (image.pairLeaf === "left" || image.pairLeaf === "right") return image.pairLeaf;
  return image.rect.x + image.rect.w / 2 >= 0.5 ? "right" : "left";
}

/**
 * Flatten both pages' overlay elements into one virtual {@link PageDesign}
 * in combined space. The left background is the primary; the right page's
 * own background is painted separately via `rightSurface`.
 *
 * Right-page elements keep their z, and stable sort after the left list, so
 * when z ties the right leaf paints on top of the fold — same as the live
 * pair stage.
 */
export function mergePairDesign(left: PageDesign, right: PageDesign): PageDesign {
  return {
    background: left.background,
    textBoxes: [...mapPairElements(left.textBoxes, false), ...mapPairElements(right.textBoxes, true)],
    shapes: [
      ...mapPairElements(left.shapes ?? [], false),
      ...mapPairElements(right.shapes ?? [], true),
    ],
    images: [
      ...mapPairElements(left.images ?? [], false).map((image) => withPairLeaf(image, "left")),
      ...mapPairElements(right.images ?? [], true).map((image) => withPairLeaf(image, "right")),
    ],
    layoutId: left.layoutId,
    compositionMode: left.compositionMode,
  };
}

/** Which real page currently owns each element id. */
export function pairElementOwners(
  left: PageDesign,
  right: PageDesign,
  leftId: string,
  rightId: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const box of left.textBoxes) map.set(box.id, leftId);
  for (const shape of left.shapes ?? []) map.set(shape.id, leftId);
  for (const image of left.images ?? []) map.set(image.id, leftId);
  for (const box of right.textBoxes) map.set(box.id, rightId);
  for (const shape of right.shapes ?? []) map.set(shape.id, rightId);
  for (const image of right.images ?? []) map.set(image.id, rightId);
  return map;
}

function overflowsTowardNeighbor(rect: NormRect, neighborIsRight: boolean): boolean {
  const eps = 1e-6;
  return neighborIsRight ? rect.x + rect.w > 1 + eps : rect.x < -eps;
}

function shiftOntoSelf(rect: NormRect, neighborIsRight: boolean): NormRect {
  return { ...rect, x: rect.x + (neighborIsRight ? 1 : -1) };
}

function isPageArt(image: ImageElement): boolean {
  return image.kind === "illustration";
}

/**
 * Copy the neighbor's overflowing elements into this page's space so a
 * single-leaf render (ebook, lone page) still shows the half that belongs
 * here — including generated page art, which keeps its owner leaf stamp.
 *
 * `neighborIsRight` means the neighbor sits to the right of `self`.
 */
export function withFacingOverflow(
  self: PageDesign,
  neighbor: PageDesign,
  neighborIsRight: boolean,
): PageDesign {
  const neighborLeaf: "left" | "right" = neighborIsRight ? "right" : "left";
  const guests = <T extends { rect: NormRect }>(list: T[]): T[] =>
    list
      .filter((el) => overflowsTowardNeighbor(el.rect, !neighborIsRight))
      .map((el) => ({ ...el, rect: shiftOntoSelf(el.rect, neighborIsRight) }));

  return {
    ...self,
    textBoxes: [...self.textBoxes, ...guests(neighbor.textBoxes)],
    shapes: [...(self.shapes ?? []), ...guests(neighbor.shapes ?? [])],
    images: [
      ...(self.images ?? []),
      ...guests(neighbor.images ?? []).map((image) => withPairLeaf(image, neighborLeaf)),
    ],
  };
}

function maxZ(pd: PageDesign): number {
  let max = 0;
  for (const box of pd.textBoxes) max = Math.max(max, box.z);
  for (const shape of pd.shapes ?? []) max = Math.max(max, shape.z);
  for (const image of pd.images ?? []) max = Math.max(max, image.z);
  return max;
}

/**
 * Permanently combine two page designs onto one double-wide spread.
 *
 * Overlay elements are remapped into combined space. The right leaf's
 * generated illustration is dropped (one spread has one page-art slot);
 * its background is kept only when the left page has none.
 */
export function joinPairDesign(left: PageDesign, right: PageDesign): PageDesign {
  const zOff = maxZ(left) + 1;
  const lift = <T extends { rect: NormRect; z: number }>(el: T, isRight: boolean): T => ({
    ...el,
    rect: toCombinedRect(el.rect, isRight),
    z: isRight ? el.z + zOff : el.z,
  });
  return {
    background: left.background ?? right.background,
    textBoxes: [
      ...left.textBoxes.map((el) => lift(el, false)),
      ...right.textBoxes.map((el) => lift(el, true)),
    ],
    shapes: [
      ...(left.shapes ?? []).map((el) => lift(el, false)),
      ...(right.shapes ?? []).map((el) => lift(el, true)),
    ],
    images: [
      ...(left.images ?? []).map((el) => lift(el, false)),
      ...(right.images ?? []).filter((image) => !isPageArt(image)).map((el) => lift(el, true)),
    ],
    layoutId: left.layoutId,
    compositionMode: left.compositionMode,
  };
}
