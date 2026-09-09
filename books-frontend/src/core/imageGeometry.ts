/**
 * Canonical image framing geometry shared by the editor and every export path.
 *
 * `focus` is the desired centre of the visible crop in source-image space.
 * The crop is clamped at source edges, so a top-focused cover keeps its title
 * while a centred image behaves like ordinary `object-fit: cover`.
 */

export interface ImageFocus {
  x: number;
  y: number;
}

export interface SourceCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoverPlacement {
  crop: SourceCrop;
  /** Full source bitmap placement inside the clipped destination frame. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function coverCropRect(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  zoom = 1,
  focus: ImageFocus = { x: 0.5, y: 0.5 },
): SourceCrop {
  const iw = Math.max(0, finiteOr(sourceWidth, 0));
  const ih = Math.max(0, finiteOr(sourceHeight, 0));
  const fw = Math.max(0, finiteOr(frameWidth, 0));
  const fh = Math.max(0, finiteOr(frameHeight, 0));
  if (iw <= 0 || ih <= 0 || fw <= 0 || fh <= 0) {
    return {
      x: 0,
      y: 0,
      width: iw,
      height: ih,
    };
  }

  const effectiveZoom = Math.max(1, finiteOr(zoom, 1));
  const scale = Math.max(fw / iw, fh / ih) * effectiveZoom;
  const width = fw / scale;
  const height = fh / scale;
  const fx = clamp(finiteOr(focus.x, 0.5), 0, 1);
  const fy = clamp(finiteOr(focus.y, 0.5), 0, 1);

  return {
    x: clamp(fx * iw - width / 2, 0, Math.max(0, iw - width)),
    y: clamp(fy * ih - height / 2, 0, Math.max(0, ih - height)),
    width,
    height,
  };
}

/**
 * Position the complete source bitmap so clipping the destination frame shows
 * exactly {@link coverCropRect}. This replaces CSS `object-position`, whose
 * percentage semantics differ from the editor's crop-centre semantics.
 */
export function coverPlacement(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  zoom = 1,
  focus: ImageFocus = { x: 0.5, y: 0.5 },
): CoverPlacement {
  const crop = coverCropRect(
    sourceWidth,
    sourceHeight,
    frameWidth,
    frameHeight,
    zoom,
    focus,
  );
  if (crop.width <= 0 || crop.height <= 0) {
    return { crop, x: 0, y: 0, width: frameWidth, height: frameHeight };
  }

  const scale = frameWidth / crop.width;
  return {
    crop,
    x: -crop.x * scale,
    y: -crop.y * scale,
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  };
}

/**
 * Crop visible inside the trim portion of an illustration that is framed
 * against a larger trim-plus-bleed rectangle.
 *
 * This is the editor counterpart of expanding the image frame into bleed at
 * export time: the user sees the exact centre slice that remains after cutting.
 */
export function coverCropRectWithInsets(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  insets: FrameInsets,
  zoom = 1,
  focus: ImageFocus = { x: 0.5, y: 0.5 },
): SourceCrop {
  const left = Math.max(0, finiteOr(insets.left, 0));
  const right = Math.max(0, finiteOr(insets.right, 0));
  const top = Math.max(0, finiteOr(insets.top, 0));
  const bottom = Math.max(0, finiteOr(insets.bottom, 0));
  const fullWidth = frameWidth + left + right;
  const fullHeight = frameHeight + top + bottom;
  const full = coverCropRect(
    sourceWidth,
    sourceHeight,
    fullWidth,
    fullHeight,
    zoom,
    focus,
  );
  if (fullWidth <= 0 || fullHeight <= 0) return full;
  return {
    x: full.x + (full.width * left) / fullWidth,
    y: full.y + (full.height * top) / fullHeight,
    width: (full.width * frameWidth) / fullWidth,
    height: (full.height * frameHeight) / fullHeight,
  };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
