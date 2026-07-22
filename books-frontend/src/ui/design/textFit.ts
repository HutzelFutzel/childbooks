/**
 * Resolution-independent text fitting built on the shared {@link layoutTextBox}
 * engine. Because both font size and box geometry scale with page height, we
 * measure against a virtual page height and the result is valid at any zoom.
 */
import type { TextBox } from "../../core/types";
import { getPreset } from "./presets";
import { layoutTextBox } from "./konva/textLayout";

const VH = 1000;

/**
 * Smallest font (as a fraction of page height) auto-fit will shrink to before it
 * gives up and lets the box clip. Keeps text readable; overflow past this point
 * is surfaced with an indicator instead of unreadable glyphs.
 */
export const MIN_FONT_PCT = 0.018;

/**
 * Inner content rect for a box. Padding is a fraction of the box's *smaller*
 * dimension (min of width/height) so it reads consistently regardless of the
 * box aspect ratio — this matches the Konva and DOM renderers.
 *
 * `measureH` only bounds the measurement area (use a large value to measure
 * unbounded content height); the padding basis always uses the box's real size.
 */
function innerFor(box: TextBox, pageAspect: number, measureH = box.rect.h * VH) {
  const preset = getPreset(box.presetId);
  const w = box.rect.w * pageAspect * VH;
  const hReal = box.rect.h * VH;
  const pad = (box.padding ?? preset.padding) * Math.min(w, hReal);
  return {
    x: pad,
    y: pad,
    w: Math.max(1, w - 2 * pad),
    h: Math.max(1, measureH - 2 * pad),
    pad,
    w0: w,
  };
}

function measure(box: TextBox, baseSize: number, inner: { x: number; y: number; w: number; h: number }) {
  const words = layoutTextBox(box, baseSize, inner);
  let top = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;
  for (const wd of words) {
    top = Math.min(top, wd.y);
    bottom = Math.max(bottom, wd.y + wd.lineHeight);
    right = Math.max(right, wd.x + wd.width);
  }
  if (!Number.isFinite(top)) return { height: 0, width: 0 };
  return { height: bottom - top, width: right - inner.x };
}

/** Largest fontSizePct whose laid-out text fits the box (height + width). */
export function fitFontSizePct(box: TextBox, pageAspect: number): number {
  const inner = innerFor(box, pageAspect);
  let lo = 0.01;
  let hi = 0.4;
  let best = 0.01;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const m = measure(box, mid * VH, inner);
    if (m.height <= inner.h && m.width <= inner.w) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Number(best.toFixed(4));
}

/**
 * Effective base font size (px) for a box, honoring auto-fit.
 *
 * By default auto-fit only *shrinks* the author's chosen `fontSizePct` to avoid
 * clipping — it never grows text beyond the intended size. With `autoFitGrow`
 * the font instead fills the box in both directions (grow *and* shrink), which
 * is handy for titles/captions. Shrinking stops at {@link MIN_FONT_PCT}; below
 * that the text is allowed to overflow (and the editor shows an overflow
 * indicator) rather than becoming unreadable.
 */
export function effectiveBaseSize(box: TextBox, pageAspect: number, pageHeight: number): number {
  let pct = box.fontSizePct;
  if (box.autoFit) {
    const fit = Math.max(MIN_FONT_PCT, fitFontSizePct(box, pageAspect));
    pct = box.autoFitGrow ? fit : Math.min(pct, fit);
  }
  return pct * pageHeight;
}

/**
 * Whether the text overflows the box at the given base font size (px).
 * Used to surface a non-destructive overflow affordance in the editor.
 */
export function isTextOverflowing(box: TextBox, pageAspect: number, baseSize: number): boolean {
  const inner = innerFor(box, pageAspect);
  const m = measure(box, baseSize, inner);
  const slack = baseSize * 0.05;
  return m.height > inner.h + slack || m.width > inner.w + slack;
}

/** Box height (normalized to page) needed to contain the text at its font. */
export function fitBoxHeightPct(box: TextBox, pageAspect: number): number {
  const inner = innerFor(box, pageAspect, 1e6);
  const m = measure(box, box.fontSizePct * VH, inner);
  const boxH = m.height + 2 * inner.pad;
  return Math.min(0.98, Math.max(0.04, boxH / VH));
}

/**
 * Smallest box *width* (normalized to page width) that still fits the text
 * without clipping any single word — i.e. the widest word laid out on its own
 * line, plus padding. Used to stop a resize from squeezing the box narrower than
 * its content. Measured in the module's virtual-height space so the result is
 * zoom-independent.
 */
export function minContentWidthPct(box: TextBox, pageAspect: number): number {
  // Measure against a very wide box so words never pre-wrap; the widest laid-out
  // word then tells us the tightest column that avoids mid-word clipping.
  const wide: TextBox = { ...box, rect: { ...box.rect, w: 4 } };
  const inner = innerFor(wide, pageAspect, 1e6);
  const words = layoutTextBox(wide, box.fontSizePct * VH, inner);
  let widest = 0;
  for (const wd of words) widest = Math.max(widest, wd.width);
  const pageWidth = pageAspect * VH;
  const pad = box.padding !== undefined ? box.padding : getPreset(box.presetId).padding;
  // Padding is a fraction of the box's smaller side; approximate with the width.
  const needed = widest + 2 * pad * (widest || pageWidth);
  return Math.min(0.98, Math.max(0.05, needed / pageWidth));
}
