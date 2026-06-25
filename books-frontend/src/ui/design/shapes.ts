/**
 * Pure geometry + catalog for decorative shapes and speech bubbles. Every shape
 * is described as a single SVG path string in the box's local pixel space so the
 * interactive Konva editor and the print/DOM renderer stay pixel-identical.
 */
import type { ShapeElement, ShapeKind } from "../../core/types";

export interface ShapeDef {
  id: ShapeKind;
  label: string;
}

/** Palette order shown in the "Add shape" menu. */
export const SHAPE_DEFS: ShapeDef[] = [
  { id: "rect", label: "Rectangle" },
  { id: "rounded-rect", label: "Rounded" },
  { id: "circle", label: "Circle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "triangle", label: "Triangle" },
  { id: "diamond", label: "Diamond" },
  { id: "star", label: "Star" },
  { id: "heart", label: "Heart" },
  { id: "arrow", label: "Arrow" },
  { id: "bubble-round", label: "Speech" },
  { id: "bubble-rect", label: "Box speech" },
  { id: "bubble-thought", label: "Thought" },
];

const BUBBLES: ShapeKind[] = ["bubble-round", "bubble-rect", "bubble-thought"];
const CORNERED: ShapeKind[] = ["rounded-rect", "bubble-rect"];

export function isBubble(kind: ShapeKind): boolean {
  return BUBBLES.includes(kind);
}
export function hasCorner(kind: ShapeKind): boolean {
  return CORNERED.includes(kind);
}
export function hasPoints(kind: ShapeKind): boolean {
  return kind === "star";
}

export function newShapeId(): string {
  return `sh_${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_FILL: Record<string, string> = {
  bubble: "rgba(255,255,255,1)",
};

/** Sensible starting style for a freshly-added shape (id/rect/z added by caller). */
export function shapeStyleDefaults(kind: ShapeKind): Omit<ShapeElement, "id" | "rect" | "z" | "kind"> {
  if (isBubble(kind)) {
    return {
      fill: DEFAULT_FILL.bubble,
      stroke: "rgba(15,23,42,0.9)",
      strokeWidth: 0.006,
      corner: kind === "bubble-rect" ? 0.18 : 0.42,
      // Tail aims just below-left of the bubble by default (toward a speaker).
      tailX: 0.3,
      tailY: 1.32,
      opacity: 1,
    };
  }
  return {
    fill: "rgba(99,102,241,0.85)",
    stroke: "rgba(15,23,42,0.9)",
    strokeWidth: 0,
    corner: 0.16,
    points: 5,
    opacity: 1,
  };
}

export interface ShapeGeomOpts {
  corner?: number;
  points?: number;
  tailX?: number;
  tailY?: number;
}

/** Default tail target (normalized) when a bubble has none stored. */
const DEFAULT_TAIL = { x: 0.3, y: 1.32 };

/** SVG path `d` for a shape, in local pixel space (0..w, 0..h). */
export function shapePath(kind: ShapeKind, w: number, h: number, opts: ShapeGeomOpts = {}): string {
  switch (kind) {
    case "rect":
      return `M 0 0 H ${r(w)} V ${r(h)} H 0 Z`;
    case "rounded-rect":
      return roundedRect(0, 0, w, h, corner(w, h, opts.corner ?? 0.16));
    case "circle": {
      const rad = Math.min(w, h) / 2;
      return ellipse(w / 2, h / 2, rad, rad);
    }
    case "ellipse":
      return ellipse(w / 2, h / 2, w / 2, h / 2);
    case "triangle":
      return `M ${r(w / 2)} 0 L ${r(w)} ${r(h)} L 0 ${r(h)} Z`;
    case "diamond":
      return `M ${r(w / 2)} 0 L ${r(w)} ${r(h / 2)} L ${r(w / 2)} ${r(h)} L 0 ${r(h / 2)} Z`;
    case "star":
      return star(w, h, opts.points ?? 5);
    case "heart":
      return heart(w, h);
    case "arrow":
      return arrow(w, h);
    case "bubble-round":
      return bubble(w, h, corner(w, h, opts.corner ?? 0.42), tail(opts));
    case "bubble-rect":
      return bubble(w, h, corner(w, h, opts.corner ?? 0.18), tail(opts));
    case "bubble-thought":
      return thought(w, h, tail(opts));
  }
}

function tail(opts: ShapeGeomOpts): { x: number; y: number } {
  return { x: opts.tailX ?? DEFAULT_TAIL.x, y: opts.tailY ?? DEFAULT_TAIL.y };
}

function r(n: number): string {
  return n.toFixed(2);
}

function corner(w: number, h: number, frac: number): number {
  return Math.max(0, Math.min(frac, 0.5)) * Math.min(w, h);
}

function roundedRect(x: number, y: number, w: number, h: number, rad: number): string {
  const k = Math.min(rad, w / 2, h / 2);
  return [
    `M ${r(x + k)} ${r(y)}`,
    `H ${r(x + w - k)}`,
    `A ${r(k)} ${r(k)} 0 0 1 ${r(x + w)} ${r(y + k)}`,
    `V ${r(y + h - k)}`,
    `A ${r(k)} ${r(k)} 0 0 1 ${r(x + w - k)} ${r(y + h)}`,
    `H ${r(x + k)}`,
    `A ${r(k)} ${r(k)} 0 0 1 ${r(x)} ${r(y + h - k)}`,
    `V ${r(y + k)}`,
    `A ${r(k)} ${r(k)} 0 0 1 ${r(x + k)} ${r(y)}`,
    "Z",
  ].join(" ");
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${r(cx - rx)} ${r(cy)} a ${r(rx)} ${r(ry)} 0 1 0 ${r(rx * 2)} 0 a ${r(rx)} ${r(ry)} 0 1 0 ${r(-rx * 2)} 0 Z`;
}

function star(w: number, h: number, points: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const inner = 0.42;
  const n = Math.max(3, Math.round(points));
  const step = Math.PI / n;
  let d = "";
  for (let i = 0; i < n * 2; i++) {
    const ratio = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + i * step;
    const x = cx + Math.cos(a) * (w / 2) * ratio;
    const y = cy + Math.sin(a) * (h / 2) * ratio;
    d += `${i === 0 ? "M" : "L"} ${r(x)} ${r(y)} `;
  }
  return `${d}Z`;
}

function heart(w: number, h: number): string {
  const sx = (x: number) => r(x * w);
  const sy = (y: number) => r(y * h);
  return [
    `M ${sx(0.5)} ${sy(0.94)}`,
    `C ${sx(0.5)} ${sy(0.94)} ${sx(0.04)} ${sy(0.56)} ${sx(0.04)} ${sy(0.3)}`,
    `C ${sx(0.04)} ${sy(0.1)} ${sx(0.3)} ${sy(0.04)} ${sx(0.5)} ${sy(0.28)}`,
    `C ${sx(0.7)} ${sy(0.04)} ${sx(0.96)} ${sy(0.1)} ${sx(0.96)} ${sy(0.3)}`,
    `C ${sx(0.96)} ${sy(0.56)} ${sx(0.5)} ${sy(0.94)} ${sx(0.5)} ${sy(0.94)}`,
    "Z",
  ].join(" ");
}

function arrow(w: number, h: number): string {
  return [
    `M 0 ${r(h * 0.3)}`,
    `H ${r(w * 0.6)}`,
    `V ${r(h * 0.08)}`,
    `L ${r(w)} ${r(h / 2)}`,
    `L ${r(w * 0.6)} ${r(h * 0.92)}`,
    `V ${r(h * 0.7)}`,
    `H 0`,
    "Z",
  ].join(" ");
}

type Edge = "top" | "right" | "bottom" | "left";

/** Which body edge a tail at the (normalized) target should sprout from. */
function pickEdge(tx: number, ty: number): Edge {
  const nx = (tx - 0.5) * 2;
  const ny = (ty - 0.5) * 2;
  if (Math.abs(nx) > Math.abs(ny)) return nx > 0 ? "right" : "left";
  return ny > 0 ? "bottom" : "top";
}

/**
 * Rounded-rectangle speech bubble whose tail is spliced directly into the body
 * outline (one continuous path → fill and stroke flow seamlessly, no seam). The
 * tail attaches to whichever edge is nearest the target and tapers to a point
 * at the target, which may sit outside the box so it can aim at a character.
 */
function bubble(w: number, h: number, rad: number, target: { x: number; y: number }): string {
  const k = Math.min(rad, w / 2, h / 2);
  const tip = { x: target.x * w, y: target.y * h };
  const edge = pickEdge(target.x, target.y);
  // Keep the tail base within the straight run of its edge (rounded corners
  // shorten that run), so the two base points never cross.
  const run = edge === "top" || edge === "bottom" ? w - 2 * k : h - 2 * k;
  const baseW = Math.max(2, Math.min(Math.min(w, h) * 0.26, run * 0.7));

  // Corner anchor points (clockwise from just past the top-left corner).
  const pts = {
    topL: { x: k, y: 0 },
    topR: { x: w - k, y: 0 },
    rightT: { x: w, y: k },
    rightB: { x: w, y: h - k },
    botR: { x: w - k, y: h },
    botL: { x: k, y: h },
    leftB: { x: 0, y: h - k },
    leftT: { x: 0, y: k },
  };
  const arc = (to: { x: number; y: number }) => `A ${r(k)} ${r(k)} 0 0 1 ${r(to.x)} ${r(to.y)}`;

  // For the tail edge, clamp the base centre so it stays on the straight run.
  const horiz = (lo: number, hi: number, c: number) =>
    Math.max(lo + baseW / 2, Math.min(hi - baseW / 2, c));

  const segTop = () => {
    if (edge !== "top") return `L ${r(pts.topR.x)} ${r(pts.topR.y)}`;
    const c = horiz(k, w - k, tip.x);
    return `L ${r(c - baseW / 2)} 0 L ${r(tip.x)} ${r(tip.y)} L ${r(c + baseW / 2)} 0 L ${r(pts.topR.x)} 0`;
  };
  const segRight = () => {
    if (edge !== "right") return `L ${r(pts.rightB.x)} ${r(pts.rightB.y)}`;
    const c = horiz(k, h - k, tip.y);
    return `L ${r(w)} ${r(c - baseW / 2)} L ${r(tip.x)} ${r(tip.y)} L ${r(w)} ${r(c + baseW / 2)} L ${r(w)} ${r(pts.rightB.y)}`;
  };
  const segBottom = () => {
    if (edge !== "bottom") return `L ${r(pts.botL.x)} ${r(pts.botL.y)}`;
    const c = horiz(k, w - k, tip.x);
    return `L ${r(c + baseW / 2)} ${r(h)} L ${r(tip.x)} ${r(tip.y)} L ${r(c - baseW / 2)} ${r(h)} L ${r(pts.botL.x)} ${r(h)}`;
  };
  const segLeft = () => {
    if (edge !== "left") return `L ${r(pts.leftT.x)} ${r(pts.leftT.y)}`;
    const c = horiz(k, h - k, tip.y);
    return `L 0 ${r(c + baseW / 2)} L ${r(tip.x)} ${r(tip.y)} L 0 ${r(c - baseW / 2)} L 0 ${r(pts.leftT.y)}`;
  };

  return [
    `M ${r(pts.topL.x)} ${r(pts.topL.y)}`,
    segTop(),
    arc(pts.rightT),
    segRight(),
    arc(pts.botR),
    segBottom(),
    arc(pts.leftB),
    segLeft(),
    arc(pts.topL),
    "Z",
  ].join(" ");
}

/**
 * Thought bubble: an elliptical body plus a trail of shrinking puffs marching
 * from the body edge toward the target. The puffs are intentionally separate
 * subpaths — that's the classic look.
 */
function thought(w: number, h: number, target: { x: number; y: number }): string {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const body = ellipse(cx, cy, rx, ry);

  const tx = target.x * w;
  const ty = target.y * h;
  let dx = tx - cx;
  let dy = ty - cy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  // Boundary point of the ellipse in the target direction.
  const tEdge = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
  const ex = cx + dx * tEdge;
  const ey = cy + dy * tEdge;
  const reach = Math.max(0, Math.hypot(tx - ex, ty - ey));

  const base = Math.min(w, h) * 0.1;
  const puffs = [
    { t: 0.12, r: base },
    { t: 0.45, r: base * 0.66 },
    { t: 0.82, r: base * 0.42 },
  ];
  const trail = puffs
    .map((p) => ellipse(ex + dx * (reach * p.t + p.r), ey + dy * (reach * p.t + p.r), p.r, p.r))
    .join(" ");
  return `${body} ${trail}`;
}
