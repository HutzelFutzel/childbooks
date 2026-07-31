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
  const lines: { toks: Tok[]; height: number; lastOfParagraph: boolean }[] = [];

  for (let p = 0; p < box.paragraphs.length; p++) {
    const para = box.paragraphs[p];
    let line: Tok[] = [];
    let lineWidth = 0;
    let maxFont = 0;

    // `lastOfParagraph` is only true for the flush that ends the paragraph
    // (not one forced by wrapping) — justify uses this to leave a paragraph's
    // final line unstretched, same as every other text editor.
    const flush = (lastOfParagraph = false) => {
      lines.push({ toks: line, height: box.lineHeight * (maxFont || baseSize), lastOfParagraph });
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

      // Break the span into word / whitespace runs so wrapping works *within* a
      // span, not only between spans. Without this, a paragraph stored as one
      // span (e.g. after inline editing merges same-style characters) could not
      // wrap and collapsed onto a single overflowing line.
      const parts = span.text.match(/\s+|\S+/g) ?? [];
      for (const part of parts) {
        const space = /^\s+$/.test(part);
        const width = c.measureText(part).width;

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
          text: part,
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
    }
    flush(true); // every paragraph ends a line (keeps empty paragraphs spaced)
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

    // Canvas has no native justify, so we stretch the gaps between words
    // ourselves. Only interior (wrapped) lines with more than one word are
    // stretched — a paragraph's last line (or any single-line paragraph)
    // stays left-aligned instead of being force-spread edge to edge, matching
    // Word/Docs/InDesign convention.
    const spaceToks = ln.toks.slice(0, lastReal + 1).filter((t) => t.space);
    const justify = align === "justify" && !ln.lastOfParagraph && spaceToks.length > 0;
    const extraPerSpace = justify ? Math.max(0, inner.w - contentWidth) / spaceToks.length : 0;

    // "justify" (and an unstretched justify line) both start flush left, same
    // as "left"; only "right"/"center" shift the line's starting position.
    let x =
      align === "right"
        ? inner.x + inner.w - contentWidth
        : align === "center"
          ? inner.x + (inner.w - contentWidth) / 2
          : inner.x;

    for (const tok of ln.toks) {
      tok.x = x;
      tok.y = y;
      tok.lineHeight = ln.height;
      x += tok.width + (justify && tok.space ? extraPerSpace : 0);
      const { space, ...word } = tok;
      void space;
      out.push(word);
    }
    y += ln.height;
  }

  return out;
}
