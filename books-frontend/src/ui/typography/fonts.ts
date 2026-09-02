/**
 * Curated, self-hosted Google Fonts (via @fontsource) for book typography.
 * Each font's CSS is lazily imported on first use so we don't ship every face.
 * We load weight 400 and rely on the browser's faux-bold/italic for variants,
 * which keeps the bundle small and works offline (incl. the Tauri build).
 */
import {
  getBookLanguage,
  type BookLanguagesConfig,
  type FontCoverageProfile,
} from "../../core/config/bookLanguages";

export type FontCategory = "display" | "rounded" | "sans" | "serif" | "hand";

export interface FontDef {
  /** Stable id (matches the @fontsource package name). */
  id: string;
  /** CSS font-family name. */
  family: string;
  label: string;
  category: FontCategory;
  /** Coverage shipped by the exact CSS import used below, not the upstream family in general. */
  coverage: readonly FontCoverageProfile[];
  /** Lazily injects the font's @font-face CSS. */
  load: () => Promise<unknown>;
}

export const CATEGORY_LABEL: Record<FontCategory, string> = {
  display: "Titles & covers",
  rounded: "Rounded & friendly",
  sans: "Clean & modern",
  serif: "Classic book",
  hand: "Handwritten",
};

/** Preferred order in font pickers. */
export const FONT_CATEGORY_ORDER: FontCategory[] = [
  "display",
  "rounded",
  "sans",
  "serif",
  "hand",
];

const BASE_FONTS: Omit<FontDef, "coverage">[] = [
  // Titles & covers (display — best for covers/chapter titles, not long body)
  { id: "luckiest-guy", family: "Luckiest Guy", label: "Luckiest Guy", category: "display", load: () => import("@fontsource/luckiest-guy/400.css") },
  { id: "lilita-one", family: "Lilita One", label: "Lilita One", category: "display", load: () => import("@fontsource/lilita-one/400.css") },
  { id: "paytone-one", family: "Paytone One", label: "Paytone One", category: "display", load: () => import("@fontsource/paytone-one/400.css") },
  { id: "alfa-slab-one", family: "Alfa Slab One", label: "Alfa Slab One", category: "display", load: () => import("@fontsource/alfa-slab-one/400.css") },
  { id: "grandstander", family: "Grandstander", label: "Grandstander", category: "display", load: () => import("@fontsource/grandstander/400.css") },
  { id: "sniglet", family: "Sniglet", label: "Sniglet", category: "display", load: () => import("@fontsource/sniglet/400.css") },
  { id: "bubblegum-sans", family: "Bubblegum Sans", label: "Bubblegum Sans", category: "display", load: () => import("@fontsource/bubblegum-sans/400.css") },
  // latin-only: full 400.css also pulls a large Japanese subset
  { id: "cherry-bomb-one", family: "Cherry Bomb One", label: "Cherry Bomb One", category: "display", load: () => import("@fontsource/cherry-bomb-one/latin-400.css") },
  { id: "boogaloo", family: "Boogaloo", label: "Boogaloo", category: "display", load: () => import("@fontsource/boogaloo/400.css") },

  // Rounded & friendly
  { id: "nunito", family: "Nunito", label: "Nunito", category: "rounded", load: () => import("@fontsource/nunito/400.css") },
  { id: "nunito-sans", family: "Nunito Sans", label: "Nunito Sans", category: "rounded", load: () => import("@fontsource/nunito-sans/400.css") },
  { id: "quicksand", family: "Quicksand", label: "Quicksand", category: "rounded", load: () => import("@fontsource/quicksand/400.css") },
  { id: "varela-round", family: "Varela Round", label: "Varela Round", category: "rounded", load: () => import("@fontsource/varela-round/400.css") },
  { id: "baloo-2", family: "Baloo 2", label: "Baloo 2", category: "rounded", load: () => import("@fontsource/baloo-2/400.css") },
  { id: "fredoka", family: "Fredoka", label: "Fredoka", category: "rounded", load: () => import("@fontsource/fredoka/400.css") },
  { id: "comfortaa", family: "Comfortaa", label: "Comfortaa", category: "rounded", load: () => import("@fontsource/comfortaa/400.css") },
  { id: "itim", family: "Itim", label: "Itim", category: "rounded", load: () => import("@fontsource/itim/400.css") },
  { id: "chewy", family: "Chewy", label: "Chewy", category: "rounded", load: () => import("@fontsource/chewy/400.css") },
  { id: "sour-gummy", family: "Sour Gummy", label: "Sour Gummy", category: "rounded", load: () => import("@fontsource/sour-gummy/400.css") },
  // latin-only: full package is CJK-heavy (~42MB of files)
  { id: "m-plus-rounded-1c", family: "M PLUS Rounded 1c", label: "M PLUS Rounded 1c", category: "rounded", load: () => import("@fontsource/m-plus-rounded-1c/latin-400.css") },

  // Clean & modern sans
  { id: "inter", family: "Inter", label: "Inter", category: "sans", load: () => import("@fontsource/inter/400.css") },
  { id: "poppins", family: "Poppins", label: "Poppins", category: "sans", load: () => import("@fontsource/poppins/400.css") },
  { id: "lexend", family: "Lexend", label: "Lexend (easy reading)", category: "sans", load: () => import("@fontsource/lexend/400.css") },
  { id: "atkinson-hyperlegible", family: "Atkinson Hyperlegible", label: "Atkinson Hyperlegible", category: "sans", load: () => import("@fontsource/atkinson-hyperlegible/400.css") },
  { id: "andika", family: "Andika", label: "Andika (early reader)", category: "sans", load: () => import("@fontsource/andika/400.css") },
  { id: "dm-sans", family: "DM Sans", label: "DM Sans", category: "sans", load: () => import("@fontsource/dm-sans/400.css") },
  { id: "mulish", family: "Mulish", label: "Mulish", category: "sans", load: () => import("@fontsource/mulish/400.css") },
  { id: "rubik", family: "Rubik", label: "Rubik", category: "sans", load: () => import("@fontsource/rubik/400.css") },
  { id: "work-sans", family: "Work Sans", label: "Work Sans", category: "sans", load: () => import("@fontsource/work-sans/400.css") },
  { id: "outfit", family: "Outfit", label: "Outfit", category: "sans", load: () => import("@fontsource/outfit/400.css") },
  { id: "figtree", family: "Figtree", label: "Figtree", category: "sans", load: () => import("@fontsource/figtree/400.css") },

  // Classic book serif
  { id: "merriweather", family: "Merriweather", label: "Merriweather", category: "serif", load: () => import("@fontsource/merriweather/400.css") },
  { id: "lora", family: "Lora", label: "Lora", category: "serif", load: () => import("@fontsource/lora/400.css") },
  { id: "bitter", family: "Bitter", label: "Bitter", category: "serif", load: () => import("@fontsource/bitter/400.css") },
  { id: "literata", family: "Literata", label: "Literata", category: "serif", load: () => import("@fontsource/literata/400.css") },
  { id: "fraunces", family: "Fraunces", label: "Fraunces", category: "serif", load: () => import("@fontsource/fraunces/400.css") },
  { id: "alegreya", family: "Alegreya", label: "Alegreya", category: "serif", load: () => import("@fontsource/alegreya/400.css") },
  { id: "source-serif-4", family: "Source Serif 4", label: "Source Serif 4", category: "serif", load: () => import("@fontsource/source-serif-4/400.css") },
  { id: "newsreader", family: "Newsreader", label: "Newsreader", category: "serif", load: () => import("@fontsource/newsreader/400.css") },
  { id: "playfair-display", family: "Playfair Display", label: "Playfair Display", category: "serif", load: () => import("@fontsource/playfair-display/400.css") },
  { id: "cormorant-garamond", family: "Cormorant Garamond", label: "Cormorant Garamond", category: "serif", load: () => import("@fontsource/cormorant-garamond/400.css") },
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
  { id: "gloria-hallelujah", family: "Gloria Hallelujah", label: "Gloria Hallelujah", category: "hand", load: () => import("@fontsource/gloria-hallelujah/400.css") },
  { id: "kalam", family: "Kalam", label: "Kalam", category: "hand", load: () => import("@fontsource/kalam/400.css") },
  { id: "shadows-into-light", family: "Shadows Into Light", label: "Shadows Into Light", category: "hand", load: () => import("@fontsource/shadows-into-light/400.css") },
  { id: "homemade-apple", family: "Homemade Apple", label: "Homemade Apple", category: "hand", load: () => import("@fontsource/homemade-apple/400.css") },
  { id: "sacramento", family: "Sacramento", label: "Sacramento", category: "hand", load: () => import("@fontsource/sacramento/400.css") },
  { id: "covered-by-your-grace", family: "Covered By Your Grace", label: "Covered By Your Grace", category: "hand", load: () => import("@fontsource/covered-by-your-grace/400.css") },
];

/**
 * Packages without a latin-ext face, plus the two families intentionally
 * imported as latin-only to avoid their much larger CJK payloads.
 */
const WESTERN_ONLY_FONT_IDS = new Set([
  "boogaloo",
  "chewy",
  "comic-neue",
  "gaegu",
  "gochi-hand",
  "homemade-apple",
  "schoolbell",
  "short-stack",
  "cherry-bomb-one",
  "m-plus-rounded-1c",
]);

export const FONTS: FontDef[] = BASE_FONTS.map((font) => ({
  ...font,
  coverage: WESTERN_ONLY_FONT_IDS.has(font.id)
    ? ["western-latin"]
    : ["western-latin", "extended-latin"],
}));

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

export function fontSupportsBookLanguage(font: FontDef, languageId?: string | null): boolean {
  return font.coverage.includes(getBookLanguage(languageId).fontProfile);
}

/** Certified fonts, narrowed further by the admin's offer set when present. */
export function fontsForBookLanguage(
  languageId?: string | null,
  config?: BookLanguagesConfig | null,
): FontDef[] {
  const language = getBookLanguage(languageId);
  const certified = FONTS.filter((font) => font.coverage.includes(language.fontProfile));
  const offered = config?.overrides[language.id]?.fontIds;
  if (!offered) return certified;
  const ids = new Set(offered);
  return certified.filter((font) => ids.has(font.id));
}

/** Age-appropriate default body family for a book's language. */
export function defaultFontForAge(
  ageRangeId: string,
  languageId?: string | null,
  config?: BookLanguagesConfig | null,
): { family: string } {
  const language = getBookLanguage(languageId);
  const configuredId = config?.overrides[language.id]?.defaultBodyFontId;
  const configured = configuredId ? getFont(configuredId) : undefined;
  const configuredFamily =
    configured && fontSupportsBookLanguage(configured, language.id) ? configured.family : undefined;
  switch (ageRangeId) {
    case "0-2":
      return { family: configuredFamily ?? "Baloo 2" };
    case "3-5":
      return { family: configuredFamily ?? "Nunito" };
    case "6-8":
      return { family: configuredFamily ?? "Lora" };
    case "9-12":
      return { family: configuredFamily ?? "Literata" };
    default:
      return { family: configuredFamily ?? "Nunito" };
  }
}
