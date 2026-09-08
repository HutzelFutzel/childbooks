/**
 * **Fractional grid regions** — the authoring vocabulary for "which part of the
 * surface is this?".
 *
 * A region of a page (or of a whole spread) is expressed as a span over a
 * columns × rows grid: the top-left tile of a 2 × 2 grid, the outer two fifths
 * of the width, the bottom three quarters. That is what a person picks in a
 * layout editor, and it is small enough to serialize, validate and label.
 *
 * The grid is deliberately NOT the stored form of a layout's geometry. It
 * resolves to a {@link NormRect}, which is what everything downstream already
 * speaks (`layouts.ts` slots, `computePageGuides`, the design editor, the
 * illustration prompt, the PDF export). Rects stay canonical for two reasons:
 * a grid cannot express a rect (`outer-text` uses `w: 0.32`, which is no clean
 * fraction), and two representations of one fact drift. So a grid is an INPUT
 * that produces geometry, never a second copy of it.
 *
 * Nothing here knows about books, image models, React or Firestore — it is
 * arithmetic on fractions, shared verbatim by the frontend and the backend.
 */
import type { NormRect } from "../design";

/**
 * A rectangular span over a `columns` × `rows` grid, in grid cells.
 *
 * Zero-based, so `{ column: 0, row: 0, columnSpan: 1, rowSpan: 1 }` on a 2 × 2
 * grid is the top-left quarter. Denominators are not restricted to a blessed
 * set: halves through fifths are what the presets offer, but sixths, sevenths
 * and tenths are the same arithmetic and need no code change.
 */
export interface GridArea {
  columns: number;
  rows: number;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

/** Which surface a grid is measured against (a spread is two pages wide). */
export type GridSurface = "page" | "spread";

/**
 * Upper bound on grid subdivisions. Not a geometric limit — the arithmetic is
 * exact at any denominator — but a region finer than this stops being pickable
 * in an editor and stops being printable at a useful size.
 */
export const MAX_GRID_DIVISIONS = 12;

/** The whole surface, as a grid area. */
export function fullGridArea(): GridArea {
  return { columns: 1, rows: 1, column: 0, row: 0, columnSpan: 1, rowSpan: 1 };
}

// ---- Validation ------------------------------------------------------------

/**
 * Why this area is not usable, in plain language ( empty when it is fine).
 *
 * Returned as a list rather than a boolean because these are the messages an
 * admin form shows next to the field they broke.
 */
export function gridAreaProblems(area: GridArea): string[] {
  const problems: string[] = [];
  const { columns, rows, column, row, columnSpan, rowSpan } = area;

  for (const [name, value] of [
    ["columns", columns],
    ["rows", rows],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_GRID_DIVISIONS) {
      problems.push(`"${name}" must be a whole number between 1 and ${MAX_GRID_DIVISIONS}.`);
    }
  }
  for (const [name, value] of [
    ["columnSpan", columnSpan],
    ["rowSpan", rowSpan],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      problems.push(`"${name}" must be a whole number of at least 1.`);
    }
  }
  for (const [name, value] of [
    ["column", column],
    ["row", row],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      problems.push(`"${name}" must be a whole number of at least 0.`);
    }
  }
  if (problems.length > 0) return problems;

  if (column + columnSpan > columns) {
    problems.push("The region runs off the right edge of the grid.");
  }
  if (row + rowSpan > rows) {
    problems.push("The region runs off the bottom edge of the grid.");
  }
  return problems;
}

export function isValidGridArea(area: GridArea): boolean {
  return gridAreaProblems(area).length === 0;
}

/**
 * Coerce stored/untrusted input into a usable area, or null when it can't be.
 *
 * Returns null rather than a clamped guess: a region that was meant to be the
 * left two fifths and arrives malformed should surface as a broken layout, not
 * silently become a differently-shaped picture in someone's book.
 */
export function normalizeGridArea(input: unknown): GridArea | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const num = (key: string, fallback: number): number =>
    typeof raw[key] === "number" && Number.isFinite(raw[key] as number)
      ? Math.round(raw[key] as number)
      : fallback;
  const area: GridArea = {
    columns: num("columns", 1),
    rows: num("rows", 1),
    column: num("column", 0),
    row: num("row", 0),
    columnSpan: num("columnSpan", 1),
    rowSpan: num("rowSpan", 1),
  };
  return isValidGridArea(area) ? area : null;
}

// ---- Geometry --------------------------------------------------------------

/**
 * The area as a normalized rectangle (0..1 of the surface).
 *
 * This is the whole point of the module: past this call nothing downstream
 * knows or cares that the rectangle came from a grid.
 */
export function gridRect(area: GridArea): NormRect {
  return {
    x: area.column / area.columns,
    y: area.row / area.rows,
    w: area.columnSpan / area.columns,
    h: area.rowSpan / area.rows,
  };
}

/**
 * Width ÷ height of a rectangle drawn on a surface of the given aspect.
 *
 * `surfaceAspect` is the aspect of the whole surface the rect is normalized
 * against — a single page's trim ratio, or twice that for a spread. A
 * half-width, full-height band on a square page is therefore 1:2, not 1:1.
 */
export function rectAspect(rect: NormRect, surfaceAspect: number): number {
  if (rect.h <= 0 || rect.w <= 0 || surfaceAspect <= 0) return 1;
  return (rect.w * surfaceAspect) / rect.h;
}

/** The aspect a picture filling this area must be generated at. */
export function gridAreaAspect(area: GridArea, surfaceAspect: number): number {
  return rectAspect(gridRect(area), surfaceAspect);
}

/**
 * The aspect of a whole surface, from a single page's trim.
 *
 * The one place the "a spread is two pages wide" doubling lives, so a caller
 * cannot forget it and generate a spread at page shape.
 */
export function surfaceAspect(pageAspect: number, surface: GridSurface): number {
  return surface === "spread" ? pageAspect * 2 : pageAspect;
}

/** Physical size of the area in inches, for print-resolution and fit checks. */
export function gridAreaInches(
  area: GridArea,
  trim: { widthIn: number; heightIn: number },
  surface: GridSurface = "page",
): { widthIn: number; heightIn: number } {
  const rect = gridRect(area);
  const surfaceWidthIn = trim.widthIn * (surface === "spread" ? 2 : 1);
  return {
    widthIn: rect.w * surfaceWidthIn,
    heightIn: rect.h * trim.heightIn,
  };
}

// ---- Labels ----------------------------------------------------------------

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** `2/5`, and `1/2` for an area authored as `2/4` — equivalent spans read alike. */
export function fractionLabel(span: number, divisions: number): string {
  if (span >= divisions) return "full";
  const d = gcd(span, divisions) || 1;
  return `${span / d}/${divisions / d}`;
}

/**
 * Where the span sits on its axis. Only flush and centred spans get a word;
 * anything else is described by its fraction alone, because "second of five
 * from the left" is not a phrase a picker should print.
 */
function positionWord(
  start: number,
  span: number,
  divisions: number,
  axis: "x" | "y",
): string | null {
  if (span >= divisions) return null;
  const end = start + span;
  if (start === 0) return axis === "x" ? "left" : "top";
  if (end === divisions) return axis === "x" ? "right" : "bottom";
  if (start === divisions - end) return axis === "x" ? "centre" : "middle";
  return null;
}

/**
 * A human label for the area — what a preset button says and what an admin
 * sees on a region. Generated, so a new denominator needs no new copy.
 */
export function describeGridArea(area: GridArea): string {
  const full = area.columnSpan >= area.columns && area.rowSpan >= area.rows;
  if (full) return "Full surface";

  const parts: string[] = [];
  if (area.columnSpan < area.columns) {
    const word = positionWord(area.column, area.columnSpan, area.columns, "x");
    parts.push(
      `${word ? `${word} ` : ""}${fractionLabel(area.columnSpan, area.columns)} of the width`,
    );
  }
  if (area.rowSpan < area.rows) {
    const word = positionWord(area.row, area.rowSpan, area.rows, "y");
    parts.push(
      `${word ? `${word} ` : ""}${fractionLabel(area.rowSpan, area.rows)} of the height`,
    );
  }
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `2/5 × 3/4` — the compact form, for dense tables and tooltips. */
export function gridAreaFractions(area: GridArea): string {
  return `${fractionLabel(area.columnSpan, area.columns)} × ${fractionLabel(area.rowSpan, area.rows)}`;
}

// ---- Presets ---------------------------------------------------------------

export interface GridPreset {
  /** Stable id, safe to store as a non-authoritative provenance hint. */
  id: string;
  label: string;
  area: GridArea;
}

/**
 * Denominators the shipped presets are generated over. Adding sixths or tenths
 * is this array — the resolver, the labels and the aspect maths are already
 * denominator-agnostic.
 */
export const PRESET_DIVISIONS: readonly number[] = [2, 3, 4, 5];

/** Square tile grids offered whole (every cell of a 2 × 2 and a 3 × 3). */
const PRESET_TILE_GRIDS: readonly number[] = [2, 3];

function areaKey(area: GridArea): string {
  const r = gridRect(area);
  // Keyed by resolved geometry, so `2/4` and `1/2` collapse to one preset.
  return [r.x, r.y, r.w, r.h].map((n) => n.toFixed(6)).join(":");
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The offered regions, generated rather than enumerated by hand.
 *
 * Per axis and per denominator, every span gets its flush-start, flush-end and
 * (where it divides evenly) centred position — which is the set a person
 * actually reaches for: outer thirds, inner two fifths, a bottom quarter. Tile
 * grids add the two-dimensional cells. Duplicates that resolve to the same
 * rectangle are dropped, so equivalent fractions appear once.
 */
export function buildGridPresets(
  divisions: readonly number[] = PRESET_DIVISIONS,
  tileGrids: readonly number[] = PRESET_TILE_GRIDS,
): GridPreset[] {
  const out: GridPreset[] = [];
  const seen = new Set<string>();

  const add = (area: GridArea) => {
    const problems = gridAreaProblems(area);
    if (problems.length > 0) return;
    const key = areaKey(area);
    if (seen.has(key)) return;
    seen.add(key);
    const label = describeGridArea(area);
    out.push({ id: slug(label), label, area });
  };

  add(fullGridArea());

  for (const d of divisions) {
    for (let span = 1; span < d; span++) {
      const remainder = d - span;
      const starts = new Set<number>([0, remainder]);
      if (remainder % 2 === 0) starts.add(remainder / 2);
      for (const start of starts) {
        // Columns: a band down the page. Rows: a band across it.
        add({ columns: d, rows: 1, column: start, row: 0, columnSpan: span, rowSpan: 1 });
        add({ columns: 1, rows: d, column: 0, row: start, columnSpan: 1, rowSpan: span });
      }
    }
  }

  for (const d of tileGrids) {
    for (let row = 0; row < d; row++) {
      for (let column = 0; column < d; column++) {
        add({ columns: d, rows: d, column, row, columnSpan: 1, rowSpan: 1 });
      }
    }
  }

  return out;
}

/** The shipped preset library. */
export const GRID_PRESETS: GridPreset[] = buildGridPresets();

export function gridPreset(id: string): GridPreset | undefined {
  return GRID_PRESETS.find((p) => p.id === id);
}

/**
 * The preset whose geometry matches this area exactly, if any.
 *
 * Lets a picker re-open a stored rect-derived area on the right button without
 * the area itself having to remember which button produced it.
 */
export function matchGridPreset(area: GridArea): GridPreset | undefined {
  const key = areaKey(area);
  return GRID_PRESETS.find((p) => areaKey(p.area) === key);
}
