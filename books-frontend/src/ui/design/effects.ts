/**
 * Shared rendering of {@link ElementEffects} for both the live Konva canvas and
 * the print/DOM output, so what you edit equals what prints.
 */
import type { ElementEffects } from "../../core/types";
import { parseColor, toRgbaString } from "./color";

export interface KonvaShadowProps {
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowOpacity: number;
  shadowForStrokeEnabled?: boolean;
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

/** CSS `filter` string mirroring the effects for DOM/print, or undefined. */
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

/** Default shadow used when toggling the effect on. */
export function defaultShadow(): NonNullable<ElementEffects["shadow"]> {
  return { color: "#000000", blur: 0.02, offsetX: 0.004, offsetY: 0.008, opacity: 0.45 };
}
