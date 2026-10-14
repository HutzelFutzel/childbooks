/**
 * Deterministic measurements of a generated picture under the page's text.
 *
 * Two questions, both answered from pixels rather than by asking a model:
 *
 *   - Is the area where the words go calm enough to read on? ("busyness")
 *   - Which ink reads best there, and does it need help? (WCAG 2 contrast)
 *
 * Works on a small downscaled RGB copy of the image ({@link PixelGrid}); the
 * host produces it (sharp on the server, a canvas in the browser). Pure, so the
 * same numbers come out wherever it runs.
 */
import type { NormRect } from "../design";

/** A downscaled, opaque RGB copy of an image (3 bytes per pixel, row-major). */
export interface PixelGrid {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Longest side of the copy hosts should produce. */
export const PIXEL_GRID_SIZE = 256;

// ---- Luminance ---------------------------------------------------------------

const LINEAR = (() => {
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const s = i / 255;
    table[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }
  return table;
})();

/** WCAG relative luminance of an 8-bit sRGB color, 0..1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * LINEAR[r & 255] + 0.7152 * LINEAR[g & 255] + 0.0722 * LINEAR[b & 255];
}

/** WCAG contrast ratio between two relative luminances, 1..21. */
export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

function parseHexColor(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHexColor(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function hexLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex);
  return rgb ? relativeLuminance(rgb[0], rgb[1], rgb[2]) : null;
}

// ---- Region pixels -----------------------------------------------------------

interface RegionPixels {
  /** Perceptual (gamma-encoded) luma per pixel, 0..1 — what busyness reads. */
  luma: Float32Array;
  /** WCAG relative luminance per pixel — what contrast reads. */
  lum: Float32Array;
  cols: number;
  rows: number;
  mean: [number, number, number];
}

function regionPixels(grid: PixelGrid, rect: NormRect): RegionPixels | null {
  const x0 = Math.max(0, Math.floor(rect.x * grid.width));
  const y0 = Math.max(0, Math.floor(rect.y * grid.height));
  const x1 = Math.min(grid.width, Math.ceil((rect.x + rect.w) * grid.width));
  const y1 = Math.min(grid.height, Math.ceil((rect.y + rect.h) * grid.height));
  const cols = x1 - x0;
  const rows = y1 - y0;
  if (cols < 2 || rows < 2) return null;
  const luma = new Float32Array(cols * rows);
  const lum = new Float32Array(cols * rows);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const o = ((y0 + y) * grid.width + (x0 + x)) * 3;
      const r = grid.data[o];
      const g = grid.data[o + 1];
      const b = grid.data[o + 2];
      const i = y * cols + x;
      luma[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lum[i] = relativeLuminance(r, g, b);
      sr += r;
      sg += g;
      sb += b;
    }
  }
  const n = cols * rows;
  return { luma, lum, cols, rows, mean: [sr / n, sg / n, sb / n] };
}

// ---- Busyness ----------------------------------------------------------------

/** A luma step this large between neighbours counts as an edge. */
const EDGE_STEP = 0.08;
/** Luma standard deviation treated as fully busy. */
const FULL_DEVIATION = 0.25;
/** Share of edge pixels treated as fully busy. */
const FULL_EDGES = 0.35;

function busynessOf(luma: Float32Array, cols: number, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let sq = 0;
  let edges = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = luma[y * cols + x];
      sum += v;
      sq += v * v;
      n++;
      const right = x + 1 < x1 ? Math.abs(luma[y * cols + x + 1] - v) : 0;
      const down = y + 1 < y1 ? Math.abs(luma[(y + 1) * cols + x] - v) : 0;
      if (Math.max(right, down) > EDGE_STEP) edges++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  const deviation = Math.sqrt(Math.max(0, sq / n - mean * mean));
  const dev = Math.min(1, deviation / FULL_DEVIATION);
  const edge = Math.min(1, edges / n / FULL_EDGES);
  return 0.5 * dev + 0.5 * edge;
}

export interface BusynessReading {
  /** 0 (flat) .. 1 (very busy); compared against `maxTextRegionBusyness`. */
  busyness: number;
  /** The whole region on its own. */
  overall: number;
  /** The busiest quarter-by-quarter tile — catches a face in one corner of a wide band. */
  worstTile: number;
}

/**
 * How busy the picture is inside `rect`: luma spread plus edge density over
 * the whole region, and over a 4×4 tiling so one figure in a corner of a large
 * band is not averaged away.
 */
export function regionBusyness(grid: PixelGrid, rect: NormRect): BusynessReading | null {
  const px = regionPixels(grid, rect);
  if (!px) return null;
  const overall = busynessOf(px.luma, px.cols, 0, 0, px.cols, px.rows);
  const tilesX = Math.min(4, Math.floor(px.cols / 4)) || 1;
  const tilesY = Math.min(4, Math.floor(px.rows / 4)) || 1;
  let worstTile = 0;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = Math.floor((tx * px.cols) / tilesX);
      const x1 = Math.floor(((tx + 1) * px.cols) / tilesX);
      const y0 = Math.floor((ty * px.rows) / tilesY);
      const y1 = Math.floor(((ty + 1) * px.rows) / tilesY);
      worstTile = Math.max(worstTile, busynessOf(px.luma, px.cols, x0, y0, x1, y1));
    }
  }
  const busyness = Math.max(overall, 0.8 * worstTile);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { busyness: round(busyness), overall: round(overall), worstTile: round(worstTile) };
}

// ---- Ink ---------------------------------------------------------------------

/** WCAG AA for body text. */
export const BODY_CONTRAST = 4.5;
/** WCAG AA for large text, and the floor below which a plate is needed. */
export const LARGE_CONTRAST = 3;
/** The worst share of pixels a reading must survive (the 10th percentile). */
const CONTRAST_PERCENTILE = 0.1;

export const DARK_INK = "#1f2430";
export const LIGHT_INK = "#ffffff";

export type InkTreatment = "none" | "shadow" | "scrim";

export interface InkChoice {
  /** Text color, `#rrggbb`. */
  color: string;
  tone: "dark" | "light";
  /** Contrast against the worst 10% of the pixels under the text. */
  contrast: number;
  /**
   * What the words need beyond the color: nothing, a soft opposite-tone
   * shadow (≥ 3:1 but under the target), or a translucent plate (< 3:1).
   */
  treatment: InkTreatment;
}

function percentileContrast(lum: Float32Array, inkLum: number): number {
  const ratios = new Float32Array(lum.length);
  for (let i = 0; i < lum.length; i++) ratios[i] = contrastRatio(lum[i], inkLum);
  ratios.sort();
  return ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * CONTRAST_PERCENTILE))];
}

function mixToward(mean: [number, number, number], target: [number, number, number], t: number): string {
  return toHexColor(
    mean[0] + (target[0] - mean[0]) * t,
    mean[1] + (target[1] - mean[1]) * t,
    mean[2] + (target[2] - mean[2]) * t,
  );
}

/**
 * Where a story text box sits on the picture, in the picture's own 0..1 space.
 *
 * The box is a share of its layout slot (centred in it) and the picture is
 * drawn at `pictureScale` about the page centre, so a slot rectangle in page
 * space has to be narrowed and then mapped inward before it is read against
 * the pixels — otherwise the strip of page color beside the picture would be
 * judged as if it were art. The result is clipped to the picture; null when
 * the box lies wholly outside it.
 */
export function textRectOnPicture(
  slot: NormRect,
  opts: { pictureScale: number; widthShare: number },
): NormRect | null {
  const share = Math.min(1, Math.max(0.1, opts.widthShare));
  const scale = Math.min(1, Math.max(0.01, opts.pictureScale));
  const w = slot.w * share;
  const x = slot.x + (slot.w - w) / 2;
  const inset = (1 - scale) / 2;
  const toPicture = (v: number) => (v - inset) / scale;
  const x0 = Math.max(0, toPicture(x));
  const y0 = Math.max(0, toPicture(slot.y));
  const x1 = Math.min(1, toPicture(x + w));
  const y1 = Math.min(1, toPicture(slot.y + slot.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The ink that reads best over `rect`, judged by WCAG contrast against the
 * worst 10% of the pixels there — a mean would let a bright patch hide under
 * dark text.
 *
 * Tries a dark and a light ink tinted toward the picture's own colors first
 * (they sit in the art instead of on it), and falls back to the neutral pair
 * when a tint can't reach the target.
 */
export function chooseInk(
  grid: PixelGrid,
  rect: NormRect,
  opts?: { target?: number; dark?: string; light?: string },
): InkChoice | null {
  const px = regionPixels(grid, rect);
  if (!px) return null;
  const target = opts?.target ?? BODY_CONTRAST;
  const dark = opts?.dark ?? DARK_INK;
  const light = opts?.light ?? LIGHT_INK;
  const candidates: { color: string; tone: "dark" | "light" }[] = [
    { color: mixToward(px.mean, parseHexColor(dark) ?? [31, 36, 48], 0.85), tone: "dark" },
    { color: mixToward(px.mean, parseHexColor(light) ?? [255, 255, 255], 0.9), tone: "light" },
    { color: dark, tone: "dark" },
    { color: light, tone: "light" },
  ];
  const scored = candidates.map((c) => ({
    ...c,
    contrast: percentileContrast(px.lum, hexLuminance(c.color) ?? 0),
  }));
  const highest = (list: typeof scored) =>
    list.reduce((a, b) => (b.contrast > a.contrast ? b : a));
  const tinted = scored.slice(0, 2).filter((c) => c.contrast >= target);
  const neutral = scored.slice(2).filter((c) => c.contrast >= target);
  const pick =
    tinted.length > 0 ? highest(tinted) : neutral.length > 0 ? highest(neutral) : highest(scored);
  const contrast = Math.round(pick.contrast * 100) / 100;
  return {
    color: pick.color,
    tone: pick.tone,
    contrast,
    treatment: contrast >= target ? "none" : contrast >= LARGE_CONTRAST ? "shadow" : "scrim",
  };
}
