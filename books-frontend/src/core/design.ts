/**
 * Final Design layer: an app-owned overlay model for typography, text boxes,
 * background patterns and cover designs. All geometry is normalized to the
 * page (0..1) so it renders crisply at any zoom and exports cleanly.
 */

/** Any CSS color string, including rgba() with alpha. */
export type ColorValue = string;

/** A rectangle normalized to the page: x/y/w/h in 0..1. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A configurable, procedurally rendered background pattern. */
export interface PatternConfig {
  /** Pattern id from the pattern catalog. */
  patternId: string;
  /** Foreground (motif) color. */
  color: ColorValue;
  /** Background fill behind the motif (can be transparent). */
  background: ColorValue;
  /** Motif scale multiplier (0.25..4). */
  scale: number;
  /** Rotation in degrees. */
  rotation: number;
  /** Overall opacity 0..1. */
  opacity: number;
}

/** A run of text with optional per-word style overrides. */
export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: ColorValue;
  fontFamily?: string;
  /** Size multiplier relative to the box base size. */
  sizeMul?: number;
}

/**
 * Visual effects applicable to any element (text box, shape, image). Rendered
 * identically on the live canvas (Konva) and in print (CSS) so exports match.
 */
export interface ElementEffects {
  shadow?: {
    color: ColorValue;
    /** Blur radius as a fraction of page height. */
    blur: number;
    /** Offset as a fraction of page height. */
    offsetX: number;
    offsetY: number;
    opacity: number;
  };
  /** Gaussian blur of the element itself, as a fraction of page height. */
  blur?: number;
  /** Element opacity 0..1 (text & image elements). */
  opacity?: number;
}

export interface TextParagraph {
  spans: TextSpan[];
  align?: "left" | "center" | "right";
}

export type VAlign = "top" | "center" | "bottom";
export type HAlign = "left" | "center" | "right";

/** An editable, draggable text box placed on a page. */
export interface TextBox {
  id: string;
  rect: NormRect;
  /** Rotation in degrees. */
  rotation?: number;
  /** Stacking order. */
  z: number;
  /** One of the 15 design presets. */
  presetId: string;
  /** Base font family (CSS family name; fonts are self-hosted). */
  fontFamily: string;
  /** Base font size as a fraction of page height (e.g. 0.05 = 5%). */
  fontSizePct: number;
  color: ColorValue;
  align: HAlign;
  vAlign: VAlign;
  lineHeight: number;
  paragraphs: TextParagraph[];
  /** Preset color overrides (background / accent). */
  fill?: ColorValue;
  stroke?: ColorValue;
  /** Optional background pattern for the box. */
  pattern?: PatternConfig;
  /** Inner padding as a fraction of the smaller box dimension. */
  padding?: number;
  locked?: boolean;
  /** Optional display name (Layers panel). */
  name?: string;
  /** Hidden from the page (still listed in Layers). */
  hidden?: boolean;
  /** Shadow / blur effects. */
  effects?: ElementEffects;
  /** When true, font auto-shrinks to fit the box (never clips). */
  autoFit?: boolean;
  /**
   * When auto-fit is on, also *grow* the font to fill the box (not just shrink).
   * Off by default so body text keeps a constant reading size.
   */
  autoFitGrow?: boolean;
}

/** A decorative vector element: geometric shapes and speech bubbles. */
export type ShapeKind =
  | "rect"
  | "rounded-rect"
  | "circle"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "star"
  | "heart"
  | "arrow"
  | "bubble-round"
  | "bubble-rect"
  | "bubble-thought";

export interface ShapeElement {
  id: string;
  rect: NormRect;
  rotation?: number;
  z: number;
  kind: ShapeKind;
  fill: ColorValue;
  stroke?: ColorValue;
  /** Stroke width as a fraction of page height (so it scales with the page). */
  strokeWidth?: number;
  /** Corner radius (0..0.5 of the smaller side) for rounded-rect / rect bubbles. */
  corner?: number;
  /** Point count for stars. */
  points?: number;
  /**
   * Speech-bubble tail target, normalized to the box (0..1, may go slightly
   * outside to aim past the edge). The tail attaches to the nearest body edge
   * and points at this spot — i.e. toward the character who is speaking.
   */
  tailX?: number;
  tailY?: number;
  opacity?: number;
  locked?: boolean;
  /** Optional display name (Layers panel). */
  name?: string;
  /** Hidden from the page (still listed in Layers). */
  hidden?: boolean;
  /** Shadow / blur effects. */
  effects?: ElementEffects;
}

/**
 * A placed raster image: an uploaded asset, or the page's generated
 * illustration once the user repositions/scales it (kind "illustration",
 * which reads its bitmap from the page's current illustration blob).
 */
export interface ImageElement {
  id: string;
  rect: NormRect;
  rotation?: number;
  z: number;
  kind: "asset" | "illustration";
  /** Asset blob id (assets only; illustration pulls from the page blob). */
  blobId?: string;
  /** How the bitmap fills its rect. */
  fit: "cover" | "contain";
  opacity?: number;
  /** Corner radius as a fraction of the smaller side. */
  corner?: number;
  effects?: ElementEffects;
  locked?: boolean;
  name?: string;
  hidden?: boolean;
}

export interface PageBackground {
  color?: ColorValue;
  pattern?: PatternConfig;
}

export interface PageDesign {
  background?: PageBackground;
  textBoxes: TextBox[];
  /** Decorative shapes / speech bubbles, rendered interleaved with text by z. */
  shapes?: ShapeElement[];
  /** Placed images: uploaded assets + a repositioned generated illustration. */
  images?: ImageElement[];
}

export interface BookDesign {
  /** Default font for new boxes. */
  defaultFontFamily: string;
  /** Age-based default size as a fraction of page height. */
  defaultFontSizePct: number;
  /** Per-page design keyed by spread id (and cover ids). */
  pages: Record<string, PageDesign>;
}

export function createDefaultDesign(
  fontFamily: string,
  fontSizePct: number,
): BookDesign {
  return { defaultFontFamily: fontFamily, defaultFontSizePct: fontSizePct, pages: {} };
}

/** Plain-text helper: build a single paragraph from a string. */
export function paragraphsFromText(text: string): TextParagraph[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({ spans: [{ text: block }] }));
}

/**
 * Tokenize text into one span per word (keeping trailing spaces) so each word
 * can be styled individually. Blank lines split paragraphs.
 */
export function wordParagraphs(text: string): TextParagraph[] {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) return [{ spans: [{ text: "" }] }];
  return blocks.map((block) => {
    const words = block.split(/(\s+)/).filter((w) => w.length > 0);
    return { spans: words.map((w) => ({ text: w })) };
  });
}

/** Flatten paragraphs back to plain text (for editing in a textarea). */
export function textFromParagraphs(paragraphs: TextParagraph[]): string {
  return paragraphs
    .map((p) => p.spans.map((s) => s.text).join(""))
    .join("\n\n");
}
