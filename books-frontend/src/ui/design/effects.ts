/**
 * Shared rendering of {@link ElementEffects} for both the live Konva canvas and
 * the print/DOM output, so what you edit equals what prints.
 */
import type { ElementEffects, ShadowTarget, TextBox } from "../../core/types";
import { parseColor, toRgbaString } from "./color";

export interface KonvaShadowProps {
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowOpacity: number;
  shadowForStrokeEnabled?: boolean;
}

/** Resolve text-box shadow target; legacy (missing) → `text`. */
export function resolveShadowTarget(effects: ElementEffects | undefined): ShadowTarget {
  return effects?.shadow?.target ?? "text";
}

export function shadowCastsOnBox(effects: ElementEffects | undefined): boolean {
  if (!effects?.shadow) return false;
  const t = resolveShadowTarget(effects);
  return t === "box" || t === "both";
}

export function shadowCastsOnText(effects: ElementEffects | undefined): boolean {
  if (!effects?.shadow) return false;
  const t = resolveShadowTarget(effects);
  return t === "text" || t === "both";
}

/** Konva shadow props (in page pixels) for an element, or null when no shadow. */
export function konvaShadow(
  effects: ElementEffects | undefined,
  pageHeight: number,
): KonvaShadowProps | null {
  const s = effects?.shadow;
  if (!s) return null;
  return {
    shadowColor: s.color,
    shadowBlur: Math.max(0, s.blur * pageHeight),
    shadowOffsetX: s.offsetX * pageHeight,
    shadowOffsetY: s.offsetY * pageHeight,
    shadowOpacity: s.opacity,
    shadowForStrokeEnabled: false,
  };
}

function withAlpha(color: string, opacity: number): string {
  const c = parseColor(color);
  return toRgbaString({ ...c, a: c.a * opacity });
}

/**
 * CSS `filter` for shapes/images: drop-shadow + optional gaussian blur of the
 * whole element. Text boxes should use the split helpers below instead.
 */
export function cssFilter(
  effects: ElementEffects | undefined,
  pageHeight: number,
): string | undefined {
  const parts: string[] = [];
  const s = effects?.shadow;
  if (s) {
    parts.push(
      `drop-shadow(${s.offsetX * pageHeight}px ${s.offsetY * pageHeight}px ${
        s.blur * pageHeight
      }px ${withAlpha(s.color, s.opacity)})`,
    );
  }
  if (effects?.blur) parts.push(`blur(${effects.blur * pageHeight}px)`);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * Backdrop (frosted glass) blur amount for a text box, in page-height fraction.
 * Prefers {@link TextBox.backdropBlur}; falls back to legacy `effects.blur`.
 */
export function effectiveBackdropBlur(box: TextBox): number {
  return box.backdropBlur ?? box.effects?.blur ?? 0;
}

/** CSS `backdrop-filter` for the text-box plate, or undefined when off. */
export function cssBackdropBlur(box: TextBox, pageHeight: number): string | undefined {
  const amt = effectiveBackdropBlur(box);
  if (!(amt > 0)) return undefined;
  return `blur(${amt * pageHeight}px)`;
}

/** Glyph drop-shadow for text-box `target: text | both`. */
export function cssTextDropShadow(
  effects: ElementEffects | undefined,
  pageHeight: number,
): string | undefined {
  if (!shadowCastsOnText(effects)) return undefined;
  const s = effects!.shadow!;
  return `drop-shadow(${s.offsetX * pageHeight}px ${s.offsetY * pageHeight}px ${
    s.blur * pageHeight
  }px ${withAlpha(s.color, s.opacity)})`;
}

/**
 * CSS `box-shadow` for text-box `target: box | both`. Casts from the border box
 * even when the fill is fully transparent (unlike `filter: drop-shadow`).
 */
export function cssBoxShadow(
  effects: ElementEffects | undefined,
  pageHeight: number,
): string | undefined {
  if (!shadowCastsOnBox(effects)) return undefined;
  const s = effects!.shadow!;
  return `${s.offsetX * pageHeight}px ${s.offsetY * pageHeight}px ${
    s.blur * pageHeight
  }px ${withAlpha(s.color, s.opacity)}`;
}

/**
 * Corner radius for the text-box shadow plate, matched to Konva/CSS chrome
 * approximations so box shadows follow the plate shape.
 */
export function textBoxPlateRadius(presetId: string, w: number, h: number): number {
  switch (presetId) {
    case "solid":
      return 16;
    case "card":
      return 18;
    case "outline":
      return 16;
    case "badge":
      return Math.min(w, h) / 2;
    case "sticker":
      return 20;
    case "bubble":
      return 22;
    case "highlight":
      return 6;
    case "frame":
      return 6;
    case "note":
      return 8;
    case "cloud":
      return Math.min(w, h) * 0.5;
    case "tape":
      return 4;
    default:
      // plain / shadowed / ribbon — soft rect plate for lifting transparent boxes
      return 8;
  }
}

/** Default shadow used when toggling the effect on (new shadows prefer the box). */
export function defaultShadow(): NonNullable<ElementEffects["shadow"]> {
  return {
    color: "#000000",
    blur: 0.025,
    offsetX: 0.005,
    offsetY: 0.012,
    opacity: 0.55,
    target: "box",
  };
}
