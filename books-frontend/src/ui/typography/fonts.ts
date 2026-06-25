/**
 * Curated, self-hosted Google Fonts (via @fontsource) for book typography.
 * Each font's CSS is lazily imported on first use so we don't ship every face.
 * We load weight 400 and rely on the browser's faux-bold/italic for variants,
 * which keeps the bundle small and works offline (incl. the Tauri build).
 */

export type FontCategory = "rounded" | "sans" | "serif" | "hand";

export interface FontDef {
  /** Stable id (matches the @fontsource package name). */
  id: string;
  /** CSS font-family name. */
  family: string;
  label: string;
  category: FontCategory;
  /** Lazily injects the font's @font-face CSS. */
  load: () => Promise<unknown>;
}

export const CATEGORY_LABEL: Record<FontCategory, string> = {
  rounded: "Rounded & friendly",
  sans: "Clean & modern",
  serif: "Classic book",
  hand: "Handwritten",
};

export const FONTS: FontDef[] = [
  // Rounded & friendly
  { id: "nunito", family: "Nunito", label: "Nunito", category: "rounded", load: () => import("@fontsource/nunito/400.css") },
  { id: "quicksand", family: "Quicksand", label: "Quicksand", category: "rounded", load: () => import("@fontsource/quicksand/400.css") },
  { id: "varela-round", family: "Varela Round", label: "Varela Round", category: "rounded", load: () => import("@fontsource/varela-round/400.css") },
  { id: "baloo-2", family: "Baloo 2", label: "Baloo 2", category: "rounded", load: () => import("@fontsource/baloo-2/400.css") },
  { id: "fredoka", family: "Fredoka", label: "Fredoka", category: "rounded", load: () => import("@fontsource/fredoka/400.css") },
  { id: "comfortaa", family: "Comfortaa", label: "Comfortaa", category: "rounded", load: () => import("@fontsource/comfortaa/400.css") },
  { id: "itim", family: "Itim", label: "Itim", category: "rounded", load: () => import("@fontsource/itim/400.css") },
  { id: "chewy", family: "Chewy", label: "Chewy", category: "rounded", load: () => import("@fontsource/chewy/400.css") },

  // Clean & modern sans
  { id: "inter", family: "Inter", label: "Inter", category: "sans", load: () => import("@fontsource/inter/400.css") },
  { id: "poppins", family: "Poppins", label: "Poppins", category: "sans", load: () => import("@fontsource/poppins/400.css") },
  { id: "lexend", family: "Lexend", label: "Lexend (easy reading)", category: "sans", load: () => import("@fontsource/lexend/400.css") },
  { id: "atkinson-hyperlegible", family: "Atkinson Hyperlegible", label: "Atkinson Hyperlegible", category: "sans", load: () => import("@fontsource/atkinson-hyperlegible/400.css") },
  { id: "dm-sans", family: "DM Sans", label: "DM Sans", category: "sans", load: () => import("@fontsource/dm-sans/400.css") },
  { id: "mulish", family: "Mulish", label: "Mulish", category: "sans", load: () => import("@fontsource/mulish/400.css") },
  { id: "rubik", family: "Rubik", label: "Rubik", category: "sans", load: () => import("@fontsource/rubik/400.css") },
  { id: "work-sans", family: "Work Sans", label: "Work Sans", category: "sans", load: () => import("@fontsource/work-sans/400.css") },

  // Classic book serif
  { id: "merriweather", family: "Merriweather", label: "Merriweather", category: "serif", load: () => import("@fontsource/merriweather/400.css") },
  { id: "lora", family: "Lora", label: "Lora", category: "serif", load: () => import("@fontsource/lora/400.css") },
  { id: "bitter", family: "Bitter", label: "Bitter", category: "serif", load: () => import("@fontsource/bitter/400.css") },
  { id: "literata", family: "Literata", label: "Literata", category: "serif", load: () => import("@fontsource/literata/400.css") },
  { id: "playfair-display", family: "Playfair Display", label: "Playfair Display", category: "serif", load: () => import("@fontsource/playfair-display/400.css") },
  { id: "bree-serif", family: "Bree Serif", label: "Bree Serif", category: "serif", load: () => import("@fontsource/bree-serif/400.css") },
  { id: "pt-serif", family: "PT Serif", label: "PT Serif", category: "serif", load: () => import("@fontsource/pt-serif/400.css") },
  { id: "eb-garamond", family: "EB Garamond", label: "EB Garamond", category: "serif", load: () => import("@fontsource/eb-garamond/400.css") },
  { id: "libre-baskerville", family: "Libre Baskerville", label: "Libre Baskerville", category: "serif", load: () => import("@fontsource/libre-baskerville/400.css") },
  { id: "crimson-pro", family: "Crimson Pro", label: "Crimson Pro", category: "serif", load: () => import("@fontsource/crimson-pro/400.css") },

  // Handwritten / playful
  { id: "caveat", family: "Caveat", label: "Caveat", category: "hand", load: () => import("@fontsource/caveat/400.css") },
  { id: "patrick-hand", family: "Patrick Hand", label: "Patrick Hand", category: "hand", load: () => import("@fontsource/patrick-hand/400.css") },
  { id: "comic-neue", family: "Comic Neue", label: "Comic Neue", category: "hand", load: () => import("@fontsource/comic-neue/400.css") },
  { id: "indie-flower", family: "Indie Flower", label: "Indie Flower", category: "hand", load: () => import("@fontsource/indie-flower/400.css") },
  { id: "architects-daughter", family: "Architects Daughter", label: "Architects Daughter", category: "hand", load: () => import("@fontsource/architects-daughter/400.css") },
  { id: "gochi-hand", family: "Gochi Hand", label: "Gochi Hand", category: "hand", load: () => import("@fontsource/gochi-hand/400.css") },
  { id: "schoolbell", family: "Schoolbell", label: "Schoolbell", category: "hand", load: () => import("@fontsource/schoolbell/400.css") },
  { id: "short-stack", family: "Short Stack", label: "Short Stack", category: "hand", load: () => import("@fontsource/short-stack/400.css") },
  { id: "shantell-sans", family: "Shantell Sans", label: "Shantell Sans", category: "hand", load: () => import("@fontsource/shantell-sans/400.css") },
  { id: "gaegu", family: "Gaegu", label: "Gaegu", category: "hand", load: () => import("@fontsource/gaegu/400.css") },
];

const byId = new Map(FONTS.map((f) => [f.id, f]));
const byFamily = new Map(FONTS.map((f) => [f.family, f]));
const loaded = new Set<string>();

export function getFont(idOrFamily: string): FontDef | undefined {
  return byId.get(idOrFamily) ?? byFamily.get(idOrFamily);
}

/** Lazily inject a font's CSS (idempotent). Accepts an id or family name. */
export function loadFont(idOrFamily: string): void {
  const font = getFont(idOrFamily);
  if (!font || loaded.has(font.id)) return;
  loaded.add(font.id);
  void font.load().catch(() => loaded.delete(font.id));
}

/** A safe CSS font-family stack for a chosen family. */
export function fontStack(family: string): string {
  const font = byFamily.get(family) ?? byId.get(family);
  const name = font?.family ?? family;
  const generic =
    font?.category === "serif"
      ? "Georgia, serif"
      : font?.category === "hand"
        ? "cursive"
        : "system-ui, sans-serif";
  return `"${name}", ${generic}`;
}

export const DEFAULT_FONT_ID = "nunito";

/**
 * Age-appropriate defaults: younger readers get larger text. Returned size is a
 * fraction of the page height (used by the normalized overlay renderer).
 */
export function defaultFontForAge(ageRangeId: string): { family: string; sizePct: number } {
  switch (ageRangeId) {
    case "0-2":
      return { family: "Baloo 2", sizePct: 0.085 };
    case "3-5":
      return { family: "Nunito", sizePct: 0.065 };
    case "6-8":
      return { family: "Lora", sizePct: 0.05 };
    case "9-12":
      return { family: "Literata", sizePct: 0.04 };
    default:
      return { family: "Nunito", sizePct: 0.06 };
  }
}
