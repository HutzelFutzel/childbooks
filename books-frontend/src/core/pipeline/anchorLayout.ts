/**
 * The reference-sheet layout contract.
 *
 * A sheet used to be whatever the model felt like producing — "multiple angles
 * (front, three-quarter, side, and back)" yields four panels sometimes and
 * eight others, in no fixed order. Everything downstream that wants to look at
 * a specific view (thumbnail crops, the height lineup) then has nothing to
 * address. So the layout is declared here, asked for explicitly as a grid, and
 * recorded on the generated image so a crop can find its cell later.
 *
 * The angle set depends on the body plan, because the standard
 * front/three-quarter/side/back turnaround assumes something that stands: it is
 * the wrong set of views for a fish, and the canonical identifying view of a
 * dog is its side profile, not its front.
 */
import type { AnchorSheetLayout, AnchorType, BodyPlan } from "../types";

export interface AnchorSheetSpec extends Omit<AnchorSheetLayout, "width" | "height"> {
  /** One view description per cell, in reading order. */
  views: string[];
  /** Generation canvas, "WxH". Chosen so cells stay roughly square. */
  size: string;
}

/** Every Cast reference uses one provider-safe landscape canvas. */
export const ANCHOR_SHEET_SIZE = "1536x1024";

const HEAD_FRONT = "a head-and-shoulders close-up from the front, neutral expression";

/**
 * Six cells for anything that stands upright. Two are spent on close-ups
 * rather than mirrored ±30°/±90° views: a mirrored side adds almost nothing for
 * a near-symmetric character, while the head close-ups both carry the identity
 * detail that matters most downstream and give the thumbnail crop a known home.
 */
const BIPEDAL: AnchorSheetSpec = {
  columns: 3,
  rows: 2,
  bodyCell: 0,
  headCell: 4,
  size: ANCHOR_SHEET_SIZE,
  views: [
    "the full body from the front, standing straight, arms relaxed at the sides",
    "the full body from a three-quarter front angle (turned about 45 degrees)",
    "the full body from the side, in profile",
    "the full body from directly behind",
    HEAD_FRONT,
    "a head-and-shoulders close-up from the front, smiling warmly",
  ],
};

const QUADRUPED: AnchorSheetSpec = {
  columns: 2,
  rows: 2,
  bodyCell: 0,
  headCell: 3,
  size: ANCHOR_SHEET_SIZE,
  views: [
    "the whole animal from the side, in profile, standing on all fours",
    "the whole animal from a three-quarter front angle, standing on all fours",
    "the whole animal from the front, standing on all fours",
    "a head close-up from the front",
  ],
};

const AVIAN: AnchorSheetSpec = {
  columns: 2,
  rows: 2,
  bodyCell: 0,
  headCell: 3,
  size: ANCHOR_SHEET_SIZE,
  views: [
    "the whole bird perched, seen from the side, in profile",
    "the whole bird perched, seen from a three-quarter front angle",
    "the whole bird in flight with wings fully spread, seen from the side",
    "a head close-up from the side",
  ],
};

const AQUATIC: AnchorSheetSpec = {
  columns: 2,
  rows: 2,
  bodyCell: 0,
  headCell: 3,
  size: ANCHOR_SHEET_SIZE,
  views: [
    "the whole body from the side, in profile",
    "the whole body from a three-quarter front angle",
    "the whole body seen from above",
    "a head close-up from the side",
  ],
};

const AMORPHOUS: AnchorSheetSpec = {
  columns: 2,
  rows: 2,
  bodyCell: 0,
  headCell: 3,
  size: ANCHOR_SHEET_SIZE,
  views: [
    "the whole subject from the front",
    "the whole subject from a three-quarter angle",
    "the whole subject from the side",
    "a close-up of its face or most distinctive feature",
  ],
};

const OBJECT: AnchorSheetSpec = {
  columns: 2,
  rows: 2,
  bodyCell: 0,
  size: ANCHOR_SHEET_SIZE,
  views: [
    "the item from the front",
    "the item from the side",
    "the item from a three-quarter angle",
    "the item seen from directly above",
  ],
};

/**
 * Places use the same landscape canvas contract as every other Cast reference.
 * A 2x2 grid gives each environment view enough width while keeping previews,
 * version thumbnails and provider requests dimensionally consistent.
 */
const PLACE: AnchorSheetSpec = {
  columns: 2,
  rows: 2,
  bodyCell: 0,
  size: ANCHOR_SHEET_SIZE,
  views: [
    "a wide establishing view of the whole space",
    "the reverse angle, looking back across the same space from the opposite side",
    "a closer view of the most important corner or detail of the space",
    "the entrance or exterior approach that most clearly identifies the same place",
  ],
};

const BY_BODY_PLAN: Record<BodyPlan, AnchorSheetSpec> = {
  bipedal: BIPEDAL,
  quadruped: QUADRUPED,
  avian: AVIAN,
  aquatic: AQUATIC,
  amorphous: AMORPHOUS,
};

/**
 * The sheet layout for an anchor. Characters without a body plan (anything
 * created before the analysis started emitting one) fall back to the upright
 * turnaround, which is right for the overwhelming majority of picture-book
 * characters.
 */
export function sheetSpecFor(anchor: {
  type: AnchorType;
  bodyPlan?: BodyPlan;
}): AnchorSheetSpec {
  if (anchor.type === "place") return PLACE;
  if (anchor.type === "object") return OBJECT;
  return BY_BODY_PLAN[anchor.bodyPlan ?? "bipedal"] ?? BIPEDAL;
}

/** Just the persisted part of a spec (what gets recorded on the image). */
export function layoutOf(spec: AnchorSheetSpec): AnchorSheetLayout {
  const [w, h] = spec.size.split("x").map((n) => Number(n) || 1024);
  return {
    columns: spec.columns,
    rows: spec.rows,
    width: w,
    height: h,
    bodyCell: spec.bodyCell,
    ...(spec.headCell !== undefined ? { headCell: spec.headCell } : {}),
  };
}

/** Aspect ratio (width / height) of one cell in a sheet. */
export function cellAspect(layout: AnchorSheetLayout): number {
  const w = layout.width / layout.columns;
  const h = layout.height / layout.rows;
  return h > 0 ? w / h : 1;
}

/**
 * Aspect ratio (width / height) of the WHOLE sheet canvas — as opposed to
 * {@link cellAspect}, which is one cell. Bipedal sheets render on a landscape
 * 1536x1024 canvas (three columns fit more comfortably wide than square), so a
 * preview that assumes a square sheet either crops off a column or letterboxes
 * oddly; callers showing the full, uncropped sheet blob (the main portrait,
 * version-history thumbs) need this instead of a hardcoded `1`.
 */
export function sheetAspect(layout: AnchorSheetLayout): number {
  return layout.height > 0 ? layout.width / layout.height : 1;
}

/** Human-readable grid shape for the prompt, e.g. "3 columns by 2 rows". */
export function gridShapeText(spec: AnchorSheetSpec): string {
  if (spec.columns === 1) return `a single column of ${spec.rows} cells stacked vertically`;
  if (spec.rows === 1) return `a single row of ${spec.columns} cells side by side`;
  return `${spec.columns} columns by ${spec.rows} rows`;
}

/** Numbered view list for the prompt, e.g. "(1) the full body from the front, ...". */
export function viewListText(spec: AnchorSheetSpec): string {
  return spec.views.map((v, i) => `(${i + 1}) ${v}`).join(", ");
}

/**
 * The normalized (0..1) rectangle of one cell in reading order. Geometry only —
 * we dictated the grid, so we can address cells directly instead of trying to
 * infer panel boundaries from the pixels.
 */
export function cellBox(
  layout: AnchorSheetLayout,
  cell: number,
): { x: number; y: number; width: number; height: number } {
  const col = cell % layout.columns;
  const row = Math.floor(cell / layout.columns);
  const w = 1 / layout.columns;
  const h = 1 / layout.rows;
  return { x: col * w, y: row * h, width: w, height: h };
}
