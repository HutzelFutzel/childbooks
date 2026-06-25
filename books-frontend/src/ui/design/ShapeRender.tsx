/**
 * Renders a single {@link ShapeElement}. Two surfaces share the same SVG path
 * from {@link shapePath} so the interactive editor and the print output match:
 *   - `KonvaShape` for the live, editable canvas (react-konva).
 *   - `ShapeSvg` for the print/DOM book.
 */
import { useEffect, useRef } from "react";
import Konva from "konva";
import { Path, Rect } from "react-konva";
import type { ShapeElement } from "../../core/types";
import { konvaShadow } from "./effects";
import { shapePath } from "./shapes";

function strokePx(shape: ShapeElement, pageHeight: number): number {
  return Math.max(0, (shape.strokeWidth ?? 0) * pageHeight);
}

/** Konva contents for a shape (positioned by the owning <Group> in PageStage). */
export function KonvaShape({
  shape,
  w,
  h,
  pageHeight,
}: {
  shape: ShapeElement;
  w: number;
  h: number;
  pageHeight: number;
}) {
  const d = shapePath(shape.kind, w, h, shape);
  const sw = strokePx(shape, pageHeight);
  const shadow = konvaShadow(shape.effects, pageHeight) ?? undefined;
  const blurPx = (shape.effects?.blur ?? 0) * pageHeight;
  const ref = useRef<Konva.Path>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (blurPx > 0) {
      node.cache();
      node.filters([Konva.Filters.Blur]);
      node.blurRadius(blurPx);
    } else {
      node.filters([]);
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [blurPx, d, w, h, shape.fill, shape.stroke, sw]);

  return (
    <>
      {/* Invisible hit/drag surface covering the bounding box. */}
      <Rect width={w} height={h} fill="#fff" opacity={0} />
      <Path
        ref={ref}
        data={d}
        fill={shape.fill}
        stroke={sw > 0 ? shape.stroke : undefined}
        strokeWidth={sw}
        opacity={shape.opacity ?? 1}
        lineJoin="round"
        listening={false}
        {...shadow}
      />
    </>
  );
}

/** Print/DOM rendering of a shape, sized to its pixel box. */
export function ShapeSvg({
  shape,
  w,
  h,
  pageHeight,
}: {
  shape: ShapeElement;
  w: number;
  h: number;
  pageHeight: number;
}) {
  const d = shapePath(shape.kind, w, h, shape);
  const sw = strokePx(shape, pageHeight);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block", overflow: "visible", opacity: shape.opacity ?? 1 }}
    >
      <path
        d={d}
        fill={shape.fill}
        stroke={sw > 0 ? shape.stroke : "none"}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
    </svg>
  );
}
