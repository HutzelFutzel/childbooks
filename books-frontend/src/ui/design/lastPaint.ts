/**
 * Sticky paint for newly added shapes and custom text boxes. Geometric shapes
 * and speech bubbles remember separately so a pink star does not become a pink
 * bubble; custom page vs cover text stay separate from story/title roles.
 */
import { COVER_BACK_ID, COVER_FRONT_ID } from "../../core/types";
import type {
  BookDesign,
  LastCustomTextPaint,
  LastCustomTextScope,
  LastShapePaint,
  LastShapeTextPaint,
  ShapeElement,
  ShapeText,
  TextBox,
} from "../../core/types";
import { applyTextBoxPatchToShape, readableShapeInk, shapeTextDefaults } from "./shapeText";
import { hasCorner, isBubble, shapeStyleDefaults } from "./shapes";

const SHAPE_PAINT_KEYS = [
  "fill",
  "stroke",
  "strokeWidth",
  "opacity",
  "effects",
  "corner",
  "text",
] as const satisfies readonly (keyof ShapeElement)[];

const TEXT_PAINT_KEYS = [
  "presetId",
  "fontFamily",
  "fontSizePct",
  "color",
  "align",
  "vAlign",
  "lineHeight",
  "fill",
  "stroke",
  "padding",
  "pattern",
  "effects",
  "backdropBlur",
] as const satisfies readonly (keyof TextBox)[];

export function patchHasShapePaint(patch: Partial<ShapeElement>): boolean {
  return SHAPE_PAINT_KEYS.some((key) => key in patch);
}

export function patchHasTextPaint(patch: Partial<TextBox>): boolean {
  return TEXT_PAINT_KEYS.some((key) => key in patch);
}

function shapeTextPaintOf(text: ShapeText): LastShapeTextPaint {
  const paint: LastShapeTextPaint = {
    fontFamily: text.fontFamily,
    fontSizePct: text.fontSizePct,
    color: text.color,
    align: text.align,
    vAlign: text.vAlign,
    lineHeight: text.lineHeight,
  };
  if (text.padding !== undefined) paint.padding = text.padding;
  return paint;
}

export function shapePaintOf(shape: ShapeElement): LastShapePaint {
  const paint: LastShapePaint = { fill: shape.fill };
  if (shape.stroke !== undefined) paint.stroke = shape.stroke;
  if (shape.strokeWidth !== undefined) paint.strokeWidth = shape.strokeWidth;
  if (shape.opacity !== undefined) paint.opacity = shape.opacity;
  if (shape.effects) paint.effects = structuredClone(shape.effects);
  if (shape.corner !== undefined) paint.corner = shape.corner;
  if (shape.text) paint.text = shapeTextPaintOf(shape.text);
  return paint;
}

export function shapeStyleForNew(
  kind: ShapeElement["kind"],
  last?: LastShapePaint | null,
): Omit<ShapeElement, "id" | "rect" | "z" | "kind"> {
  const base = shapeStyleDefaults(kind);
  if (!last) return base;
  return {
    ...base,
    fill: last.fill,
    stroke: last.stroke ?? base.stroke,
    strokeWidth: last.strokeWidth ?? base.strokeWidth,
    opacity: last.opacity ?? base.opacity,
    ...(last.effects ? { effects: structuredClone(last.effects) } : {}),
    ...(hasCorner(kind) && last.corner !== undefined ? { corner: last.corner } : {}),
  };
}

/** Seed inner type for a first double-click. Copy look, not words. */
export function shapeTextForNew(
  shape: Pick<ShapeElement, "kind" | "fill">,
  fonts: { fontFamily: string; fontSizePct: number },
  last?: LastShapePaint | null,
): ShapeText {
  const base = shapeTextDefaults(shape, fonts);
  const text = last?.text;
  if (!text) return base;
  return {
    ...base,
    fontFamily: text.fontFamily,
    fontSizePct: text.fontSizePct,
    color: readableShapeInk(shape.fill, text.color),
    align: text.align,
    vAlign: text.vAlign,
    lineHeight: text.lineHeight,
    ...(text.padding !== undefined ? { padding: text.padding } : {}),
  };
}

/** Inner type from the last shape that had it — bubbles and stars share this. */
export function lastShapeTextFor(
  design: BookDesign | null | undefined,
): LastShapeTextPaint | undefined {
  return (
    design?.lastShapeStyle?.text ??
    design?.lastShapeStyle?.geometric?.text ??
    design?.lastShapeStyle?.bubble?.text
  );
}

/**
 * Last inner type to seed onto `shape`, independent of whether that family has
 * a remembered fill yet (a styled bubble still types the next rectangle).
 */
export function lastTextPaintFor(
  design: BookDesign | null | undefined,
  shape: Pick<ShapeElement, "kind" | "fill">,
): LastShapePaint | undefined {
  const text = lastShapeTextFor(design);
  if (!text) return undefined;
  return { fill: shape.fill, text };
}

/** So a first style click on a new shape merges onto last-used type, not book defaults. */
export function withSeededShapeText(
  shape: ShapeElement,
  fonts: { fontFamily: string; fontSizePct: number },
  last?: LastShapePaint | null,
): ShapeElement {
  if (shape.text) return shape;
  return { ...shape, text: shapeTextForNew(shape, fonts, last) };
}

export function patchedShapeText(
  shape: ShapeElement,
  patch: Partial<TextBox>,
  fonts: { fontFamily: string; fontSizePct: number },
  last?: LastShapePaint | null,
): ShapeText {
  return applyTextBoxPatchToShape(withSeededShapeText(shape, fonts, last), patch, fonts);
}

export function lastShapePaintFor(
  design: BookDesign | null | undefined,
  kind: ShapeElement["kind"],
): LastShapePaint | undefined {
  const family = isBubble(kind) ? design?.lastShapeStyle?.bubble : design?.lastShapeStyle?.geometric;
  if (!family) return undefined;
  const text = lastShapeTextFor(design);
  return text ? { ...family, text } : family;
}

export function rememberShapePaint(design: BookDesign, shape: ShapeElement): void {
  const family = isBubble(shape.kind) ? "bubble" : "geometric";
  const prev = design.lastShapeStyle?.[family];
  const next = shapePaintOf(shape);
  // Recoloring a decorative (no-text) shape must not forget the last inner type.
  if (!next.text && prev?.text) next.text = prev.text;
  const sharedText = next.text ?? design.lastShapeStyle?.text;
  if (sharedText && !next.text) next.text = sharedText;
  design.lastShapeStyle = {
    ...design.lastShapeStyle,
    [family]: next,
    ...(sharedText ? { text: sharedText } : {}),
  };
}

export function customTextScope(pageId: string, box: Pick<TextBox, "role">): LastCustomTextScope | null {
  if (box.role) return null;
  return pageId === COVER_FRONT_ID || pageId === COVER_BACK_ID ? "custom-cover" : "custom-page";
}

export function textPaintOf(box: TextBox): LastCustomTextPaint {
  const paint: LastCustomTextPaint = {
    presetId: box.presetId,
    fontFamily: box.fontFamily,
    fontSizePct: box.fontSizePct,
    color: box.color,
    align: box.align,
    vAlign: box.vAlign,
    lineHeight: box.lineHeight,
  };
  if (box.fill !== undefined) paint.fill = box.fill;
  if (box.stroke !== undefined) paint.stroke = box.stroke;
  if (box.padding !== undefined) paint.padding = box.padding;
  if (box.pattern) paint.pattern = structuredClone(box.pattern);
  if (box.effects) paint.effects = structuredClone(box.effects);
  if (box.backdropBlur !== undefined) paint.backdropBlur = box.backdropBlur;
  return paint;
}

export function applyLastCustomText(box: TextBox, last: LastCustomTextPaint): TextBox {
  return {
    ...box,
    presetId: last.presetId,
    fontFamily: last.fontFamily,
    fontSizePct: last.fontSizePct,
    color: last.color,
    align: last.align,
    vAlign: last.vAlign,
    lineHeight: last.lineHeight,
    fill: last.fill,
    stroke: last.stroke,
    padding: last.padding,
    pattern: last.pattern ? structuredClone(last.pattern) : undefined,
    effects: last.effects ? structuredClone(last.effects) : undefined,
    backdropBlur: last.backdropBlur,
  };
}

export function rememberCustomTextPaint(design: BookDesign, pageId: string, box: TextBox): void {
  const scope = customTextScope(pageId, box);
  if (!scope) return;
  design.lastCustomTextStyle = {
    ...design.lastCustomTextStyle,
    [scope]: textPaintOf(box),
  };
}
