/**
 * Place Canva-style selection toolbars above the selection when possible,
 * flipping below when the preferred slot would hit the viewport edge or a
 * marked obstacle (page chips, add dock, etc.).
 *
 * Mark obstacles with `data-floating-bar-obstacle` in the DOM.
 */

export type ViewportRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type FloatingBarSide = "above" | "below";

export type FloatingBarPlacement = {
  /** Viewport X of the bar center. */
  x: number;
  /** Attachment edge Y (element top when above, element bottom when below). */
  y: number;
  side: FloatingBarSide;
  /** Gap between bar and selection edge (px). */
  gap: number;
};

const DEFAULT_BAR_HEIGHT = 44;
/** Conservative estimate for initial placement; FloatingBarPortal remeasures. */
const DEFAULT_BAR_HALF_WIDTH = 280;
const DEFAULT_GAP = 10;
const DEFAULT_MARGIN = 8;

function overlaps(a: ViewportRect, b: ViewportRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Collect DOM obstacles that floating bars should avoid. */
export function queryFloatingBarObstacles(
  root: ParentNode = typeof document !== "undefined" ? document : (null as unknown as ParentNode),
): ViewportRect[] {
  if (!root || typeof document === "undefined") return [];
  return Array.from(root.querySelectorAll("[data-floating-bar-obstacle]")).map((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}

function slotRect(
  centerX: number,
  top: number,
  halfWidth: number,
  height: number,
): ViewportRect {
  return {
    left: centerX - halfWidth,
    right: centerX + halfWidth,
    top,
    bottom: top + height,
  };
}

function blockedBy(
  slot: ViewportRect,
  viewport: ViewportRect,
  obstacles: ViewportRect[],
): boolean {
  if (slot.top < viewport.top || slot.bottom > viewport.bottom) return true;
  return obstacles.some((o) => overlaps(slot, o));
}

/**
 * Prefer above the selection; flip below when that slot clips the viewport
 * or intersects an obstacle. X is clamped so wide bars stay on-screen.
 */
export function placeFloatingBar(opts: {
  anchor: ViewportRect;
  barHeight?: number;
  barHalfWidth?: number;
  gap?: number;
  margin?: number;
  obstacles?: ViewportRect[];
  /** Viewport size; defaults to `window`. */
  viewportWidth?: number;
  viewportHeight?: number;
}): FloatingBarPlacement {
  const barHeight = opts.barHeight ?? DEFAULT_BAR_HEIGHT;
  const barHalfWidth = opts.barHalfWidth ?? DEFAULT_BAR_HALF_WIDTH;
  const gap = opts.gap ?? DEFAULT_GAP;
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const obstacles = opts.obstacles ?? [];
  const vw = opts.viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1024);
  const vh = opts.viewportHeight ?? (typeof window !== "undefined" ? window.innerHeight : 768);

  const viewport: ViewportRect = {
    left: margin,
    top: margin,
    right: vw - margin,
    bottom: vh - margin,
  };

  const midX = (opts.anchor.left + opts.anchor.right) / 2;
  const minX = margin + barHalfWidth;
  const maxX = vw - margin - barHalfWidth;
  const clampedX = minX <= maxX ? clamp(midX, minX, maxX) : vw / 2;

  const aboveTop = opts.anchor.top - gap - barHeight;
  const belowTop = opts.anchor.bottom + gap;
  const aboveSlot = slotRect(clampedX, aboveTop, barHalfWidth, barHeight);
  const belowSlot = slotRect(clampedX, belowTop, barHalfWidth, barHeight);

  const aboveBlocked = blockedBy(aboveSlot, viewport, obstacles);
  const belowBlocked = blockedBy(belowSlot, viewport, obstacles);

  let side: FloatingBarSide = "above";
  if (aboveBlocked && !belowBlocked) side = "below";
  else if (aboveBlocked && belowBlocked) {
    // Both tight — pick the side with more free vertical room.
    const roomAbove = opts.anchor.top - viewport.top;
    const roomBelow = viewport.bottom - opts.anchor.bottom;
    side = roomBelow > roomAbove ? "below" : "above";
  }

  return {
    x: clampedX,
    y: side === "above" ? opts.anchor.top : opts.anchor.bottom,
    side,
    gap,
  };
}

/** Portal wrapper class + style for a placed floating bar. */
export function floatingBarPortalProps(placement: FloatingBarPlacement): {
  className: string;
  style: { left: number; top: number };
} {
  const above = placement.side === "above";
  return {
    className: above
      ? "fixed z-80 -translate-x-1/2 -translate-y-full"
      : "fixed z-80 -translate-x-1/2",
    style: {
      left: placement.x,
      top: above ? placement.y - placement.gap : placement.y + placement.gap,
    },
  };
}
