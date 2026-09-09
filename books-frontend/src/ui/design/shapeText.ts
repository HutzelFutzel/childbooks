/**
 * Copy nested in a decorative shape. Layout reuses the text-box engine so the
 * Konva editor, the inline editor, and print stay aligned.
 */
import { textFromParagraphs } from "../../core/design";
import type {
  ShapeElement,
  ShapeKind,
  ShapeText,
  TextBox,
} from "../../core/types";
import { parseColor } from "./color";

export const SHAPE_TEXT_PADDING = 0.12;

const ROUNDISH: ShapeKind[] = [
  "circle",
  "ellipse",
  "bubble-round",
  "bubble-thought",
  "heart",
  "star",
];

export function shapeTextPadFrac(shape: Pick<ShapeElement, "kind" | "text">): number {
  const base = shape.text?.padding ?? SHAPE_TEXT_PADDING;
  return base + (ROUNDISH.includes(shape.kind) ? 0.06 : 0);
}

/** Dark ink on light fills, white on dark — so a first double-click is readable. */
export function contrastInk(fill: string): string {
  return luminanceOnWhite(fill) > 0.55 ? "#1f2430" : "#ffffff";
}

function luminanceOnWhite(color: string): number {
  const { r, g, b, a } = parseColor(color);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum * a + (1 - a);
}

/**
 * Keep a preferred ink when it still reads on `fill`; otherwise the same
 * light/dark pick {@link contrastInk} would make for a first double-click.
 */
export function readableShapeInk(fill: string, preferred?: string): string {
  const fallback = contrastInk(fill);
  if (!preferred) return fallback;
  const fillIsLight = luminanceOnWhite(fill) > 0.55;
  const preferredIsLight = luminanceOnWhite(preferred) > 0.55;
  return fillIsLight === preferredIsLight ? fallback : preferred;
}

export function shapeTextDefaults(
  shape: Pick<ShapeElement, "kind" | "fill">,
  fonts: { fontFamily: string; fontSizePct: number },
): ShapeText {
  return {
    paragraphs: [{ spans: [{ text: "" }] }],
    fontFamily: fonts.fontFamily,
    fontSizePct: Math.min(fonts.fontSizePct, 0.042),
    color: contrastInk(shape.fill),
    align: "center",
    vAlign: "center",
    lineHeight: 1.2,
    padding: SHAPE_TEXT_PADDING,
  };
}

export function shapeTextIsEmpty(text: Pick<ShapeText, "paragraphs"> | undefined): boolean {
  return !text || !textFromParagraphs(text.paragraphs).trim();
}

/** Presentational text box for layout / print / the inline editor. */
export function shapeTextAsBox(
  shape: ShapeElement,
  text: ShapeText = shape.text ?? shapeTextDefaults(shape, { fontFamily: "Georgia", fontSizePct: 0.036 }),
): TextBox {
  return {
    id: shape.id,
    rect: shape.rect,
    rotation: shape.rotation,
    z: shape.z,
    presetId: "plain",
    fontFamily: text.fontFamily,
    fontSizePct: text.fontSizePct,
    color: text.color,
    align: text.align,
    vAlign: text.vAlign,
    lineHeight: text.lineHeight,
    paragraphs: text.paragraphs,
    padding: shapeTextPadFrac({ ...shape, text }),
    locked: shape.locked,
    hidden: shape.hidden,
  };
}

export function applyTextBoxPatchToShape(
  shape: ShapeElement,
  patch: Partial<TextBox>,
  fonts: { fontFamily: string; fontSizePct: number },
): ShapeText {
  const current = shape.text ?? shapeTextDefaults(shape, fonts);
  return {
    ...current,
    ...(patch.paragraphs !== undefined ? { paragraphs: patch.paragraphs } : {}),
    ...(patch.fontFamily !== undefined ? { fontFamily: patch.fontFamily } : {}),
    ...(patch.fontSizePct !== undefined ? { fontSizePct: patch.fontSizePct } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.align !== undefined ? { align: patch.align } : {}),
    ...(patch.vAlign !== undefined ? { vAlign: patch.vAlign } : {}),
    ...(patch.lineHeight !== undefined ? { lineHeight: patch.lineHeight } : {}),
    ...(patch.padding !== undefined ? { padding: patch.padding } : {}),
  };
}
