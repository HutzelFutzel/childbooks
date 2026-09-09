import type { NormRect } from "../../core/types";

export type PrintGuideKind = "safe" | "gutter" | "barcode" | "logo" | "fold";

export type PrintGuideHot = {
  kind: PrintGuideKind;
  /** Which page half (pair stages). Fold has no page. */
  page?: 0 | 1;
};

export type PrintGuidesRects = {
  safe: NormRect;
  gutter: { x: number; w: number } | null;
  barcode?: NormRect | null;
  logo?: NormRect | null;
};

const STROKE_HIT_PX = 10;
const FOLD_HIT_PX = 7;

export function printGuideTooltip(kind: PrintGuideKind): { title: string; body: string } {
  switch (kind) {
    case "safe":
      return {
        title: "Safety margin",
        body: "Keep faces, titles, and important details inside this box. Printers trim slightly, so anything outside can be cut off.",
      };
    case "gutter":
      return {
        title: "Binding gutter",
        body: "This strip disappears into the spine. Keep words out of it so they stay readable in the printed book.",
      };
    case "barcode":
      return {
        title: "Barcode area",
        body: "Reserved for the printer's barcode. Don't put important art or text here.",
      };
    case "logo":
      return {
        title: "Studio logo",
        body: "Reserved for the back-cover logo on the printed book.",
      };
    case "fold":
      return {
        title: "Page fold",
        body: "The two pages meet here. Keep faces and titles clear of the centre line.",
      };
  }
}

function inRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

function nearRectStroke(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  tol: number,
): boolean {
  const outer = inRect(px, py, x - tol, y - tol, w + tol * 2, h + tol * 2);
  const inner = inRect(px, py, x + tol, y + tol, Math.max(0, w - tol * 2), Math.max(0, h - tol * 2));
  return outer && !inner;
}

/** Which print guide is under a stage-local point, or null. */
export function hitTestPrintGuide(
  px: number,
  py: number,
  W: number,
  H: number,
  left: PrintGuidesRects | null | undefined,
  right: PrintGuidesRects | null | undefined,
  showFold: boolean,
): PrintGuideHot | null {
  const hasRight = Boolean(right);
  const surfaceW = hasRight ? W / 2 : W;
  const pages: { g: PrintGuidesRects; page: 0 | 1; x0: number }[] = [];
  if (left) pages.push({ g: left, page: 0, x0: 0 });
  if (right) pages.push({ g: right, page: 1, x0: surfaceW });

  for (const { g, page, x0 } of pages) {
    if (g.barcode && inRect(px, py, x0 + g.barcode.x * surfaceW, g.barcode.y * H, g.barcode.w * surfaceW, g.barcode.h * H)) {
      return { kind: "barcode", page };
    }
    if (g.logo && inRect(px, py, x0 + g.logo.x * surfaceW, g.logo.y * H, g.logo.w * surfaceW, g.logo.h * H)) {
      return { kind: "logo", page };
    }
  }
  for (const { g, page, x0 } of pages) {
    if (g.gutter && inRect(px, py, x0 + g.gutter.x * surfaceW, 0, g.gutter.w * surfaceW, H)) {
      return { kind: "gutter", page };
    }
  }
  if (showFold && Math.abs(px - W / 2) <= FOLD_HIT_PX) {
    return { kind: "fold" };
  }
  for (const { g, page, x0 } of pages) {
    if (
      nearRectStroke(
        px,
        py,
        x0 + g.safe.x * surfaceW,
        g.safe.y * H,
        g.safe.w * surfaceW,
        g.safe.h * H,
        STROKE_HIT_PX,
      )
    ) {
      return { kind: "safe", page };
    }
  }
  return null;
}
