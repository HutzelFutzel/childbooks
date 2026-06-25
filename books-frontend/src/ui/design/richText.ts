/**
 * Bridges the {@link TextParagraph} model and a `contentEditable` surface so the
 * inline editor can preserve per-range styling (bold/italic/underline/strike/
 * color/size) across edits, and apply new styling to arbitrary selections.
 */
import type { TextParagraph, TextSpan } from "../../core/types";

interface Style {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  sizeMul?: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function spanStyleCss(span: TextSpan): string {
  const parts: string[] = [];
  if (span.bold) parts.push("font-weight:700");
  if (span.italic) parts.push("font-style:italic");
  const deco = [span.underline ? "underline" : "", span.strike ? "line-through" : ""]
    .filter(Boolean)
    .join(" ");
  if (deco) parts.push(`text-decoration:${deco}`);
  if (span.color) parts.push(`color:${span.color}`);
  if (span.sizeMul && span.sizeMul !== 1) parts.push(`font-size:${span.sizeMul}em`);
  return parts.join(";");
}

/** Render paragraphs as HTML blocks (one <div> per paragraph) for editing. */
export function paragraphsToHtml(paragraphs: TextParagraph[]): string {
  const blocks = paragraphs.length ? paragraphs : [{ spans: [{ text: "" }] }];
  return blocks
    .map((p) => {
      const inner = p.spans
        .map((s) => {
          const css = spanStyleCss(s);
          const text = escapeHtml(s.text) || "";
          return css ? `<span style="${css}">${text}</span>` : text;
        })
        .join("");
      return `<div>${inner || "<br>"}</div>`;
    })
    .join("");
}

function mergeStyle(base: Style, el: HTMLElement): Style {
  const next: Style = { ...base };
  const tag = el.tagName;
  if (tag === "B" || tag === "STRONG") next.bold = true;
  if (tag === "I" || tag === "EM") next.italic = true;
  if (tag === "U") next.underline = true;
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.strike = true;

  const style = el.style;
  const fw = style.fontWeight;
  if (fw === "bold" || Number(fw) >= 600) next.bold = true;
  if (style.fontStyle === "italic") next.italic = true;
  const deco = `${style.textDecoration} ${style.textDecorationLine}`;
  if (deco.includes("underline")) next.underline = true;
  if (deco.includes("line-through")) next.strike = true;
  if (style.color) next.color = style.color;
  if (style.fontSize.endsWith("em")) {
    const v = parseFloat(style.fontSize);
    if (!Number.isNaN(v)) next.sizeMul = v;
  }
  return next;
}

function sameStyle(a: Style, b: Style): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    (a.color ?? "") === (b.color ?? "") &&
    (a.sizeMul ?? 1) === (b.sizeMul ?? 1)
  );
}

function toSpan(text: string, st: Style): TextSpan {
  const span: TextSpan = { text };
  if (st.bold) span.bold = true;
  if (st.italic) span.italic = true;
  if (st.underline) span.underline = true;
  if (st.strike) span.strike = true;
  if (st.color) span.color = st.color;
  if (st.sizeMul && st.sizeMul !== 1) span.sizeMul = st.sizeMul;
  return span;
}

/** Parse a contentEditable root back into paragraphs, preserving inline styles. */
export function editorToParagraphs(root: HTMLElement): TextParagraph[] {
  const paragraphs: TextParagraph[] = [];
  let current: { ch: string; st: Style }[] = [];

  const flush = () => {
    // Group consecutive equal-style characters into spans.
    const spans: TextSpan[] = [];
    for (const { ch, st } of current) {
      const last = spans[spans.length - 1];
      const lastSt = last ? styleOf(last) : null;
      if (last && lastSt && sameStyle(lastSt, st)) last.text += ch;
      else spans.push(toSpan(ch, st));
    }
    paragraphs.push({ spans: spans.length ? spans : [{ text: "" }] });
    current = [];
  };

  const walkInline = (node: Node, st: Style) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      for (const ch of text) current.push({ ch, st });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") return;
    const st2 = mergeStyle(st, el);
    el.childNodes.forEach((c) => walkInline(c, st2));
  };

  const blocks = Array.from(root.childNodes).filter(
    (n) => n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === "DIV",
  );

  if (blocks.length === 0) {
    // No block wrappers (e.g. a single line): treat root children as one block.
    root.childNodes.forEach((c) => walkInline(c, {}));
    flush();
  } else {
    for (const b of blocks) {
      b.childNodes.forEach((c) => walkInline(c, {}));
      flush();
    }
  }

  return paragraphs.length ? paragraphs : [{ spans: [{ text: "" }] }];
}

function styleOf(span: TextSpan): Style {
  return {
    bold: span.bold,
    italic: span.italic,
    underline: span.underline,
    strike: span.strike,
    color: span.color,
    sizeMul: span.sizeMul,
  };
}

export type InlineCommand = "bold" | "italic" | "underline" | "strikeThrough";

/** Apply a styling command to the current document selection (execCommand). */
export function applyInlineCommand(cmd: InlineCommand) {
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand(cmd);
}

/** Apply a foreground color to the current document selection. */
export function applyInlineColor(color: string) {
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand("foreColor", false, color);
}
