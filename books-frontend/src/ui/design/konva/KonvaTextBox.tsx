import { useEffect, useRef } from "react";
import Konva from "konva";
import { Group, Rect, Text } from "react-konva";
import type { TextBox } from "../../../core/types";
import { loadFont } from "../../typography/fonts";
import { konvaShadow } from "../effects";
import { getPreset } from "../presets";
import { chromeFor } from "./chrome";
import { layoutTextBox } from "./textLayout";
import { usePatternImage } from "./usePatternImage";
import type { SpanRef } from "../TextBoxView";

/**
 * Renders a single text box's contents (hit area, chrome, pattern, and richly
 * styled words) in the box's local pixel space. The owning `<Group>` in
 * `PageStage` provides position/rotation/drag; this component is purely
 * presentational + word selection.
 */
export function KonvaTextBox({
  box,
  w,
  h,
  baseSize,
  pageHeight,
  selectedSpan,
  hideText = false,
  showOverflow = false,
  liveScaleX = 1,
  liveScaleY = 1,
}: {
  box: TextBox;
  w: number;
  h: number;
  baseSize: number;
  pageHeight: number;
  selectedSpan?: SpanRef | null;
  /** Hide the rendered words (kept chrome) while editing in a DOM overlay. */
  hideText?: boolean;
  /** Surface a non-destructive overflow affordance (editor only). */
  showOverflow?: boolean;
  /**
   * Live transform scale of the owning group while the box is being resized.
   * The words are laid out at the *visual* (scaled) box size and rendered in a
   * counter-scaled group, so glyphs keep a constant size and reflow live while
   * the chrome scales — no end-of-drag "snap".
   */
  liveScaleX?: number;
  liveScaleY?: number;
}) {
  const preset = getPreset(box.presetId);
  const colors = {
    fill: box.fill ?? preset.defaults.fill,
    stroke: box.stroke ?? preset.defaults.stroke,
    text: box.color,
  };
  const pattern = usePatternImage(box.pattern);

  useEffect(() => {
    const families = new Set<string>([box.fontFamily]);
    box.paragraphs.forEach((p) => p.spans.forEach((s) => s.fontFamily && families.add(s.fontFamily)));
    families.forEach((f) => loadFont(f));
  }, [box.fontFamily, box.paragraphs]);

  // Lay text out against the *visual* (live-scaled) box, then counter-scale the
  // word group so glyphs stay constant while the box is being resized.
  const wL = w * liveScaleX;
  const hL = h * liveScaleY;
  const pad = (box.padding ?? preset.padding) * Math.min(wL, hL);
  const inner = { x: pad, y: pad, w: Math.max(0, wL - 2 * pad), h: Math.max(0, hL - 2 * pad) };
  const words = layoutTextBox(box, baseSize, inner);

  // Detect content that exceeds the clipped box so we can hint at it instead of
  // silently cutting the text off.
  let contentBottom = -Infinity;
  let contentRight = -Infinity;
  for (const wd of words) {
    contentBottom = Math.max(contentBottom, wd.y + wd.lineHeight);
    contentRight = Math.max(contentRight, wd.x + wd.width);
  }
  const slack = baseSize * 0.05;
  const overflowing =
    showOverflow &&
    !hideText &&
    Number.isFinite(contentBottom) &&
    (contentBottom > inner.y + inner.h + slack || contentRight > inner.x + inner.w + slack);

  const shadowed = box.presetId === "shadowed";
  const effectShadow = konvaShadow(box.effects, pageHeight);
  const presetShadow = shadowed
    ? {
        shadowColor: "black",
        shadowOpacity: 0.55,
        shadowBlur: baseSize * 0.18,
        shadowOffsetY: baseSize * 0.05,
      }
    : null;
  const shadowProps = effectShadow ?? presetShadow;

  // Soft "frosted" blur of the whole box (chrome + background + words). Konva
  // needs an offscreen cache to run a filter; we skip it mid-resize (the cache
  // would rebuild every frame) and re-apply once the box settles.
  const contentRef = useRef<Konva.Group>(null);
  const blurPx = (box.effects?.blur ?? 0) * pageHeight;
  const canBlur = blurPx > 0 && liveScaleX === 1 && liveScaleY === 1 && !hideText;
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
  }, [canBlur, blurPx, w, h, box, baseSize, selectedSpan]);

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

      {/* Counter-scale so words keep constant size while the chrome scales
          during a live resize (identity when not resizing). */}
      <Group scaleX={1 / liveScaleX} scaleY={1 / liveScaleY}>
      {/* Text, clipped to the box to mirror CSS overflow: hidden. */}
      <Group clipFunc={(ctx) => ctx.rect(0, 0, wL, hL)} visible={!hideText}>
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
                // Words never capture pointer events: presses fall through to the
                // box's hit surface / group so the whole body can be dragged and
                // selected. Per-range styling is done in the inline editor.
                listening={false}
                {...(shadowProps ?? {})}
              />
            </Group>
          );
        })}
      </Group>

      {overflowing && (
        <>
          {/* Soft fade hinting at clipped content, then a dashed amber ring +
              chevron so the user knows to fit/resize rather than guess. */}
          <Rect
            x={0}
            y={Math.max(0, hL - Math.min(hL * 0.28, baseSize * 1.4))}
            width={wL}
            height={Math.min(hL * 0.28, baseSize * 1.4)}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 0, y: Math.min(hL * 0.28, baseSize * 1.4) }}
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
            x={wL - baseSize * 1.2}
            y={hL - baseSize * 1.1}
            text={"\u25BE"}
            fontSize={baseSize * 0.9}
            fill="#b45309"
            listening={false}
          />
        </>
      )}
      </Group>
      </Group>
    </>
  );
}
