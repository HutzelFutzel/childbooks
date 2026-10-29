/**
 * Pure color math for the branding-driven theme.
 *
 * The admin picks a single `primary` and `accent` hex; from each we derive a
 * full 50–900 ramp (so every existing `bg-brand-*` / `text-accent-*` utility
 * keeps working) and an accessible foreground (dark ink vs white) for text on
 * the brand color. No React here — safe to run on the server (layout.tsx) so
 * the palette is injected before first paint with no flash.
 */
import type { BrandingConfig } from "../../core/config/branding";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp8(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function parseHex(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6) return null;
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clamp8(c).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
/** Indigo near-black (ink-900) — mixing toward this keeps dark stops from going flat/grey. */
const NEAR_BLACK: Rgb = { r: 20, g: 22, b: 58 };

/**
 * How far each stop is mixed toward white (<500) or near-black (>500). 500 is
 * the untouched base color, so `primary` reads as the brand's "true" color.
 */
const RAMP: Record<number, { toward: "white" | "black"; t: number }> = {
  50: { toward: "white", t: 0.95 },
  100: { toward: "white", t: 0.87 },
  200: { toward: "white", t: 0.73 },
  300: { toward: "white", t: 0.55 },
  400: { toward: "white", t: 0.3 },
  500: { toward: "white", t: 0 },
  600: { toward: "black", t: 0.15 },
  700: { toward: "black", t: 0.32 },
  800: { toward: "black", t: 0.48 },
  900: { toward: "black", t: 0.64 },
};

export type ColorRamp = Record<number, string>;

export const RAMP_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Build a 50–900 ramp from one base hex (falls back if the hex is invalid). */
export function buildRamp(baseHex: string, fallback = "#f96a4d"): ColorRamp {
  const base = parseHex(baseHex) ?? parseHex(fallback)!;
  const out: ColorRamp = {};
  for (const stop of RAMP_STOPS) {
    const cfg = RAMP[stop];
    out[stop] = toHex(mix(base, cfg.toward === "white" ? WHITE : NEAR_BLACK, cfg.t));
  }
  return out;
}

/** WCAG relative luminance (0..1). */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const DARK_FOREGROUND = "#14163a";

/** WCAG contrast ratio between two colors, 1..21. */
export function contrastBetween(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A readable foreground (dark ink or white) for text on the given background.
 *
 * Notice why a naive luminance comparison (`contrast(bg, dark) > contrast(bg, white)`)
 * fails on warm coral/terracotta (`#e04f2e`, `L ≈ 0.258`): dark ink `#14163a`
 * barely beats white at 4.8:1 on `brand-600`, then drops below WCAG AA (to
 * ~3.8:1) on hovered `brand-700`, and visually clashes ("muddy dark blue on
 * red-orange").
 *
 * So we only switch to dark ink when the background is genuinely light enough
 * (`L >= 0.42`, e.g. golden amber `#f79b04` or pastel yellows/mints) that dark
 * ink clears 7:1+ across both rest and hover states. On mid/saturated brand
 * colors like coral (`#f96a4d`), we use crisp white `#ffffff` and pair it with
 * a subtle text-protection shadow on filled buttons so white text meets the
 * recommended contrast without altering the brand color.
 */
export function readableOn(bgHex: string, fallback = "#ffffff"): string {
  const rgb = parseHex(bgHex);
  if (!rgb) return fallback;
  return luminance(rgb) >= 0.42 ? DARK_FOREGROUND : "#ffffff";
}

/**
 * The CSS custom properties that theme the whole app from branding. Returned as
 * a style object so it can be spread onto `<html>` (inline styles beat the
 * stylesheet `:root` defaults with no ordering/flash issues).
 */
export function brandingThemeVars(branding: BrandingConfig): Record<string, string> {
  const brand = buildRamp(branding.colors.primary, "#f96a4d");
  const accent = buildRamp(branding.colors.accent, "#f79b04");
  const vars: Record<string, string> = {};
  for (const stop of RAMP_STOPS) {
    vars[`--color-brand-${stop}`] = brand[stop];
    vars[`--color-accent-${stop}`] = accent[stop];
  }
  // Foreground for filled brand surfaces (buttons/badges use the 600 stop).
  vars["--color-brand-foreground"] = readableOn(brand[600]);
  vars["--color-accent-foreground"] = readableOn(accent[500]);
  return vars;
}
