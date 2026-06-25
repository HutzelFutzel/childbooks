import { useEffect } from "react";
import type { CSSProperties } from "react";
import type { TextBox } from "../../core/types";
import { fontStack, loadFont } from "../typography/fonts";
import { cssFilter } from "./effects";
import { getPreset } from "./presets";
import { PatternFill } from "./patterns";
import { effectiveBaseSize } from "./textFit";

export interface SpanRef {
  p: number;
  i: number;
}

/**
 * Renders a text box's chrome, optional pattern, and richly-styled paragraphs.
 * `pageHeight` (px) drives font sizing so it scales with the page.
 */
export function TextBoxView({
  box,
  pageHeight,
  w,
  h,
  aspect,
  selectedSpan,
  onSelectSpan,
}: {
  box: TextBox;
  pageHeight: number;
  /** Box pixel width/height (for padding + auto-fit parity with the canvas). */
  w: number;
  h: number;
  /** Page aspect (width/height) used for auto-fit measurement. */
  aspect: number;
  selectedSpan?: SpanRef | null;
  onSelectSpan?: (ref: SpanRef) => void;
}) {
  const preset = getPreset(box.presetId);
  const colors = {
    fill: box.fill ?? preset.defaults.fill,
    stroke: box.stroke ?? preset.defaults.stroke,
    text: box.color,
  };
  const baseSize = effectiveBaseSize(box, aspect, pageHeight);
  const pad = (box.padding ?? preset.padding) * Math.min(w, h);

  useEffect(() => {
    const families = new Set<string>([box.fontFamily]);
    box.paragraphs.forEach((p) => p.spans.forEach((s) => s.fontFamily && families.add(s.fontFamily)));
    families.forEach((f) => loadFont(f));
  }, [box.fontFamily, box.paragraphs]);

  const wrapStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent:
      box.vAlign === "top" ? "flex-start" : box.vAlign === "bottom" ? "flex-end" : "center",
    alignItems:
      box.align === "left" ? "flex-start" : box.align === "right" ? "flex-end" : "center",
    padding: pad,
    textAlign: box.align,
    color: colors.text,
    fontFamily: fontStack(box.fontFamily),
    fontSize: baseSize,
    lineHeight: box.lineHeight,
    overflow: "hidden",
    ...(preset.textStyle?.(colors) ?? {}),
  };

  const outerStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    opacity: box.effects?.opacity ?? 1,
    filter: cssFilter(box.effects, pageHeight),
  };

  return (
    <div style={outerStyle}>
      {preset.chrome?.(colors)}
      {box.pattern && <PatternFill config={box.pattern} />}
      <div style={wrapStyle}>
        {box.paragraphs.map((para, pi) => (
          <p key={pi} style={{ textAlign: para.align ?? box.align, margin: 0, width: "100%" }}>
            {para.spans.map((span, si) => {
              const selected = selectedSpan?.p === pi && selectedSpan?.i === si;
              return (
                <span
                  key={si}
                  onMouseDown={(e) => {
                    if (!onSelectSpan) return;
                    e.stopPropagation();
                    onSelectSpan({ p: pi, i: si });
                  }}
                  style={{
                    fontFamily: span.fontFamily ? fontStack(span.fontFamily) : undefined,
                    fontWeight: span.bold ? 700 : undefined,
                    fontStyle: span.italic ? "italic" : undefined,
                    textDecoration:
                      [span.underline ? "underline" : "", span.strike ? "line-through" : ""]
                        .filter(Boolean)
                        .join(" ") || undefined,
                    color: span.color,
                    fontSize: span.sizeMul ? baseSize * span.sizeMul : undefined,
                    cursor: onSelectSpan ? "text" : undefined,
                    outline: selected ? "2px solid rgba(99,102,241,0.8)" : undefined,
                    borderRadius: selected ? 3 : undefined,
                  }}
                >
                  {span.text}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </div>
  );
}
