import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Konva from "konva";
import { Group, Rect, Text } from "react-konva";
import type { TextBox } from "../../../core/types";
import { loadFont } from "../../typography/fonts";
import { konvaShadow } from "../effects";
import { getPreset } from "../presets";
import { effectiveBaseSize } from "../textFit";
import { chromeFor } from "./chrome";
import { layoutTextBox } from "./textLayout";
import { usePatternImage } from "./usePatternImage";
import type { SpanRef } from "../TextBoxView";

/** Imperative API so the parent can drive live resize without re-rendering itself. */
export interface KonvaTextBoxHandle {
  /**
   * Match the owning group's live Transformer scale. Re-layouts + auto-fits
   * text against the visual box and counter-scales so glyphs stay undistorted.
   * Pass `(1, 1)` (or omit) to clear.
   */
  setLiveScale: (sx?: number, sy?: number) => void;
}

/**
 * Renders a single text box's contents (hit area, chrome, pattern, and richly
 * styled words) in the box's local pixel space. The owning `<Group>` in
 * `PageStage` provides position/rotation/drag; this component is purely
 * presentational + word selection.
 *
 * Live resize state lives *here* (not in PageStage): updating it re-renders
 * only this subtree, so the Transformer's group attrs are never stomped.
 */
export const KonvaTextBox = forwardRef<
  KonvaTextBoxHandle,
  {
    box: TextBox;
    w: number;
    h: number;
    baseSize: number;
    pageHeight: number;
    /** Page width/height ratio — needed to auto-fit against a live-scaled rect. */
    pageAspect: number;
    selectedSpan?: SpanRef | null;
    /** Hide the rendered words (kept chrome) while editing in a DOM overlay. */
    hideText?: boolean;
    /** Surface a non-destructive overflow affordance (editor only). */
    showOverflow?: boolean;
  }
>(function KonvaTextBox(
  {
    box,
    w,
    h,
    baseSize,
    pageHeight,
    pageAspect,
    selectedSpan,
    hideText = false,
    showOverflow = false,
  },
  ref,
) {
  const preset = getPreset(box.presetId);
  const colors = {
    fill: box.fill ?? preset.defaults.fill,
    stroke: box.stroke ?? preset.defaults.stroke,
    text: box.color,
  };
  const pattern = usePatternImage(box.pattern);

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
        // Coalesce pointer-move storms to one layout per frame.
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
    const families = new Set<string>([box.fontFamily]);
    box.paragraphs.forEach((p) => p.spans.forEach((s) => s.fontFamily && families.add(s.fontFamily)));
    families.forEach((f) => loadFont(f));
  }, [box.fontFamily, box.paragraphs]);

  const { sx, sy } = live;
  const resizing = Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6;

  // Lay text out against the *visual* (scaled) box. During a height drag we
  // preview auto-fit the same way transform-end will commit it — so the font
  // shrinks/grows under the cursor instead of only snapping on release.
  const wL = w * sx;
  const hL = h * sy;
  const fitBox: TextBox = resizing
    ? {
        ...box,
        rect: { ...box.rect, w: box.rect.w * sx, h: box.rect.h * sy },
        autoFit: true,
        autoHeight: false,
      }
    : box;
  const liveBaseSize = resizing
    ? effectiveBaseSize(fitBox, pageAspect, pageHeight)
    : baseSize;

  const pad = (box.padding ?? preset.padding) * Math.min(wL, hL);
  const inner = { x: pad, y: pad, w: Math.max(0, wL - 2 * pad), h: Math.max(0, hL - 2 * pad) };
  const words = layoutTextBox(box, liveBaseSize, inner);

  // Detect content that exceeds the clipped box so we can hint at it instead of
  // silently cutting the text off.
  let contentBottom = -Infinity;
  let contentRight = -Infinity;
  for (const wd of words) {
    contentBottom = Math.max(contentBottom, wd.y + wd.lineHeight);
    contentRight = Math.max(contentRight, wd.x + wd.width);
  }
  const slack = liveBaseSize * 0.05;
  const overflowing =
    showOverflow &&
    !hideText &&
    !resizing &&
    Number.isFinite(contentBottom) &&
    (contentBottom > inner.y + inner.h + slack || contentRight > inner.x + inner.w + slack);

  const shadowed = box.presetId === "shadowed";
  const effectShadow = konvaShadow(box.effects, pageHeight);
  const presetShadow = shadowed
    ? {
        shadowColor: "black",
        shadowOpacity: 0.55,
        shadowBlur: liveBaseSize * 0.18,
        shadowOffsetY: liveBaseSize * 0.05,
      }
    : null;
  const shadowProps = effectShadow ?? presetShadow;

  // Soft "frosted" blur of the whole box (chrome + background + words). Konva
  // needs an offscreen cache to run a filter; we skip it mid-resize (the cache
  // would rebuild every frame) and re-apply once the box settles.
  const contentRef = useRef<Konva.Group>(null);
  const blurPx = (box.effects?.blur ?? 0) * pageHeight;
  const canBlur = blurPx > 0 && !resizing && !hideText;
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    if (canBlur) {
      node.cache();
      node.filters([Konva.Filters.Blur]);
      node.blurRadius(blurPx);
    } else {
      node.filters([]);
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [canBlur, blurPx, w, h, box, liveBaseSize, selectedSpan, resizing]);

  return (
    <>
      {/* Invisible hit/drag surface so the whole box reacts to clicks. */}
      <Rect width={w} height={h} fill="#fff" opacity={0} />

      <Group ref={contentRef} listening={false}>
        {chromeFor(box.presetId, w, h, colors)}

        {box.pattern && pattern && (
          <Rect
            width={w}
            height={h}
            fillPatternImage={pattern.image}
            fillPatternRepeat="repeat"
            fillPatternScale={{ x: box.pattern.scale || 1, y: box.pattern.scale || 1 }}
            fillPatternRotation={box.pattern.rotation || 0}
            opacity={box.pattern.opacity ?? 1}
            listening={false}
          />
        )}

        {/* Counter-scale: parent Group is scaled by the Transformer; invert that
            on the words so glyphs stay orthogonal while chrome stretches.
            Layout uses the visual (scaled) box + fitted font, so after
            counter-scale the on-screen type matches the live auto-fit size. */}
        <Group scaleX={1 / sx} scaleY={1 / sy}>
          <Group clip={{ x: 0, y: 0, width: wL, height: hL }} visible={!hideText}>
            {words.map((word, idx) => {
              const selected = selectedSpan?.p === word.p && selectedSpan?.i === word.i;
              return (
                <Group key={idx}>
                  {selected && (
                    <Rect
                      x={word.x - 1}
                      y={word.y}
                      width={word.width + 2}
                      height={word.lineHeight}
                      stroke="rgba(99,102,241,0.9)"
                      strokeWidth={1.5}
                      cornerRadius={3}
                      listening={false}
                    />
                  )}
                  <Text
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
                    {...(shadowProps ?? {})}
                  />
                </Group>
              );
            })}
          </Group>

          {overflowing && (
            <>
              <Rect
                x={0}
                y={Math.max(0, hL - Math.min(hL * 0.28, liveBaseSize * 1.4))}
                width={wL}
                height={Math.min(hL * 0.28, liveBaseSize * 1.4)}
                fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                fillLinearGradientEndPoint={{
                  x: 0,
                  y: Math.min(hL * 0.28, liveBaseSize * 1.4),
                }}
                fillLinearGradientColorStops={[0, "rgba(245,158,11,0)", 1, "rgba(245,158,11,0.16)"]}
                listening={false}
              />
              <Rect
                width={wL}
                height={hL}
                stroke="#f59e0b"
                strokeWidth={1.5}
                dash={[6, 4]}
                cornerRadius={4}
                listening={false}
              />
              <Text
                x={wL - liveBaseSize * 1.2}
                y={hL - liveBaseSize * 1.1}
                text={"\u25BE"}
                fontSize={liveBaseSize * 0.9}
                fill="#b45309"
                listening={false}
              />
            </>
          )}
        </Group>
      </Group>
    </>
  );
});
