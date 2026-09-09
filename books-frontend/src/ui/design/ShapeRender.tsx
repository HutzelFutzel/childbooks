/**
 * Renders a single {@link ShapeElement}. Two surfaces share the same SVG path
 * from {@link shapePath} so the interactive editor and the print output match:
 *   - `KonvaShape` for the live, editable canvas (react-konva).
 *   - `ShapeSvg` for the print/DOM book.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Konva from "konva";
import { Group, Path, Rect, Text } from "react-konva";
import type { ShapeElement } from "../../core/types";
import { loadFont } from "../typography/fonts";
import { konvaShadow } from "./effects";
import { layoutTextBox } from "./konva/textLayout";
import type { KonvaTextBoxHandle } from "./konva/KonvaTextBox";
import { shapeTextAsBox } from "./shapeText";
import { shapePath } from "./shapes";
import { TextBoxView } from "./TextBoxView";
import { effectiveBaseSize } from "./textFit";

function strokePx(shape: ShapeElement, pageHeight: number): number {
  return Math.max(0, (shape.strokeWidth ?? 0) * pageHeight);
}

/** Konva contents for a shape (positioned by the owning <Group> in PageStage). */
export const KonvaShape = forwardRef<
  KonvaTextBoxHandle,
  {
    shape: ShapeElement;
    w: number;
    h: number;
    pageHeight: number;
    pageAspect: number;
    hideText?: boolean;
  }
>(function KonvaShape({ shape, w, h, pageHeight, pageAspect, hideText = false }, ref) {
  const d = shapePath(shape.kind, w, h, shape);
  const sw = strokePx(shape, pageHeight);
  const shadow = konvaShadow(shape.effects, pageHeight) ?? undefined;
  const blurPx = (shape.effects?.blur ?? 0) * pageHeight;
  const pathRef = useRef<Konva.Path>(null);

  const [live, setLive] = useState({ sx: 1, sy: 1 });
  const pendingRef = useRef({ sx: 1, sy: 1 });
  const rafRef = useRef<number | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setLiveScale(sx = 1, sy = 1) {
        const safeX = Number.isFinite(sx) && Math.abs(sx) > 1e-6 ? sx : 1;
        const safeY = Number.isFinite(sy) && Math.abs(sy) > 1e-6 ? sy : 1;
        pendingRef.current = { sx: safeX, sy: safeY };
        if (rafRef.current != null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const next = pendingRef.current;
          setLive((prev) =>
            prev.sx === next.sx && prev.sy === next.sy ? prev : next,
          );
        });
      },
    }),
    [],
  );

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  useEffect(() => {
    const node = pathRef.current;
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

  const box = shape.text ? shapeTextAsBox(shape) : null;
  useEffect(() => {
    if (!box) return;
    const families = new Set<string>([box.fontFamily]);
    box.paragraphs.forEach((p) => p.spans.forEach((s) => s.fontFamily && families.add(s.fontFamily)));
    families.forEach((f) => loadFont(f));
  }, [box]);

  const { sx, sy } = live;
  const wL = w * sx;
  const hL = h * sy;
  const liveBox = box
    ? { ...box, rect: { ...box.rect, w: box.rect.w * sx, h: box.rect.h * sy } }
    : null;
  const baseSize = liveBox ? effectiveBaseSize(liveBox, pageAspect, pageHeight) : 0;
  const pad = liveBox ? (liveBox.padding ?? 0) * Math.min(wL, hL) : 0;
  const inner = { x: pad, y: pad, w: Math.max(0, wL - 2 * pad), h: Math.max(0, hL - 2 * pad) };
  const words = liveBox && !hideText ? layoutTextBox(liveBox, baseSize, inner) : [];

  return (
    <>
      {/* Invisible hit/drag surface covering the bounding box. */}
      <Rect width={w} height={h} fill="#fff" opacity={0} />
      <Path
        ref={pathRef}
        data={d}
        fill={shape.fill}
        stroke={sw > 0 ? shape.stroke : undefined}
        strokeWidth={sw}
        opacity={shape.opacity ?? 1}
        lineJoin="round"
        listening={false}
        {...shadow}
      />
      {words.length > 0 && (
        <Group scaleX={1 / sx} scaleY={1 / sy} listening={false}>
          <Group clip={{ x: 0, y: 0, width: wL, height: hL }}>
            {words.map((word, idx) => (
              <Text
                key={idx}
                x={word.x}
                y={word.y}
                text={word.text}
                fontFamily={word.fontFamily}
                fontSize={word.fontSize}
                fontStyle={word.fontStyle}
                textDecoration={
                  [word.underline ? "underline" : "", word.strike ? "line-through" : ""]
                    .filter(Boolean)
                    .join(" ")
                }
                fill={word.fill}
                height={word.lineHeight}
                verticalAlign="middle"
                listening={false}
              />
            ))}
          </Group>
        </Group>
      )}
    </>
  );
});

/** Print/DOM rendering of a shape, sized to its pixel box. */
export function ShapeSvg({
  shape,
  w,
  h,
  pageHeight,
  aspect,
}: {
  shape: ShapeElement;
  w: number;
  h: number;
  pageHeight: number;
  /** Page width/height — drives shrink-to-fit the same as text boxes. */
  aspect: number;
}) {
  const d = shapePath(shape.kind, w, h, shape);
  const sw = strokePx(shape, pageHeight);
  const box = shape.text ? shapeTextAsBox(shape) : null;
  return (
    <div style={{ position: "relative", width: w, height: h, overflow: "hidden" }}>
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
      {box && (
        <TextBoxView
          box={box}
          pageHeight={pageHeight}
          w={w}
          h={h}
          aspect={aspect}
        />
      )}
    </div>
  );
}
