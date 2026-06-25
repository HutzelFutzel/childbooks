import type { TextBox } from "../../../core/types";
import { fontStack } from "../../typography/fonts";

/** A single word/space run, positioned in the box's local pixel space. */
export interface PositionedWord {
  /** Paragraph + span index, for click-to-select-a-word. */
  p: number;
  i: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  /** Konva fontStyle: "normal" | "bold" | "italic" | "italic bold". */
  fontStyle: string;
  underline: boolean;
  strike: boolean;
  fill: string;
  width: number;
  /** Height of the line this word belongs to (drives vertical centering). */
  lineHeight: number;
}

interface Tok extends PositionedWord {
  space: boolean;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    measureCtx = c.getContext("2d");
  }
  return measureCtx!;
}

function konvaFontStyle(bold?: boolean, italic?: boolean): string {
  if (bold && italic) return "italic bold";
  if (bold) return "bold";
  if (italic) return "italic";
  return "normal";
}

/**
 * Lay out a text box's paragraphs/spans into positioned words within the inner
 * (padded) content area. Mirrors the DOM renderer's wrapping/alignment so the
 * Konva editor and the print output stay visually consistent.
 *
 * All inputs/outputs are in the box's local pixel space.
 */
export function layoutTextBox(
  box: TextBox,
  baseSize: number,
  inner: { x: number; y: number; w: number; h: number },
): PositionedWord[] {
  const c = ctx();
  const lines: { toks: Tok[]; height: number }[] = [];

  for (let p = 0; p < box.paragraphs.length; p++) {
    const para = box.paragraphs[p];
    let line: Tok[] = [];
    let lineWidth = 0;
    let maxFont = 0;

    const flush = () => {
      lines.push({ toks: line, height: box.lineHeight * (maxFont || baseSize) });
      line = [];
      lineWidth = 0;
      maxFont = 0;
    };

    for (let i = 0; i < para.spans.length; i++) {
      const span = para.spans[i];
      const fontSize = baseSize * (span.sizeMul ?? 1);
      const family = fontStack(span.fontFamily ?? box.fontFamily);
      const style = konvaFontStyle(span.bold, span.italic);
      c.font = `${style === "normal" ? "" : style + " "}${fontSize}px ${family}`;
      const width = c.measureText(span.text).width;
      const space = /^\s+$/.test(span.text);

      if (!space && line.length > 0 && lineWidth + width > inner.w) {
        // Drop a trailing space before wrapping so alignment stays correct.
        while (line.length && line[line.length - 1].space) {
          lineWidth -= line.pop()!.width;
        }
        flush();
      }
      if (space && line.length === 0) continue; // no leading spaces

      line.push({
        p,
        i,
        text: span.text,
        x: 0,
        y: 0,
        fontSize,
        fontFamily: family,
        fontStyle: style,
        underline: !!span.underline,
        strike: !!span.strike,
        fill: span.color ?? box.color,
        width,
        lineHeight: 0,
        space,
      });
      lineWidth += width;
      maxFont = Math.max(maxFont, fontSize);
    }
    flush(); // every paragraph ends a line (keeps empty paragraphs spaced)
  }

  const totalHeight = lines.reduce((s, l) => s + l.height, 0);
  const startY =
    box.vAlign === "top"
      ? inner.y
      : box.vAlign === "bottom"
        ? inner.y + (inner.h - totalHeight)
        : inner.y + (inner.h - totalHeight) / 2;

  const out: PositionedWord[] = [];
  let y = startY;
  for (const ln of lines) {
    // Content width ignores trailing spaces so alignment is visually centered.
    let lastReal = -1;
    for (let k = ln.toks.length - 1; k >= 0; k--) {
      if (!ln.toks[k].space) {
        lastReal = k;
        break;
      }
    }
    let contentWidth = 0;
    for (let k = 0; k <= lastReal; k++) contentWidth += ln.toks[k].width;

    const para = box.paragraphs[ln.toks[0]?.p ?? 0];
    const align = para?.align ?? box.align;
    let x =
      align === "left"
        ? inner.x
        : align === "right"
          ? inner.x + inner.w - contentWidth
          : inner.x + (inner.w - contentWidth) / 2;

    for (const tok of ln.toks) {
      tok.x = x;
      tok.y = y;
      tok.lineHeight = ln.height;
      x += tok.width;
      const { space, ...word } = tok;
      void space;
      out.push(word);
    }
    y += ln.height;
  }

  return out;
}
