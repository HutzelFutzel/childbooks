/**
 * Static catalogs of user-selectable book options used by the setup wizard.
 * These are pure data so the same definitions can drive UI, prompt building,
 * and (later) the generation pipeline.
 */

export type ProviderId = "openai" | "google";
export type Modality = "text" | "image";
export type ModelTier = "economy" | "premium";

export type BookSize = "square" | "landscape" | "portrait";
export type GraphicsDensity = "one-per-page" | "multiple-per-page" | "combination";
export type SpreadUsage = "single" | "double" | "mixed";
export type TextHandling = "exact" | "creative";
export type TextPlacement = "separate" | "embedded";

export interface AgeRange {
  id: string;
  label: string;
  min: number;
  max: number;
  description: string;
}

export const AGE_RANGES: AgeRange[] = [
  { id: "0-2", label: "0–2 years", min: 0, max: 2, description: "Board-book simplicity: a few words per page, bold shapes." },
  { id: "3-5", label: "3–5 years", min: 3, max: 5, description: "Short sentences, playful rhythm, lots of imagery." },
  { id: "6-8", label: "6–8 years", min: 6, max: 8, description: "Early readers: richer plot, longer paragraphs." },
  { id: "9-12", label: "9–12 years", min: 9, max: 12, description: "Chapter-style storytelling with detailed scenes." },
];

export interface ArtStylePreset {
  id: string;
  label: string;
  description: string;
  /** Short phrase injected into image prompts. */
  promptHint: string;
  /** Tailwind gradient classes used for the example tile until real samples exist. */
  swatch: string;
}

export const ART_STYLE_PRESETS: ArtStylePreset[] = [
  {
    id: "watercolor",
    label: "Soft Watercolor",
    description: "Gentle washes, soft edges, dreamy pastel tones.",
    promptHint:
      "soft watercolor children's book illustration, gentle washes, visible paper texture, pastel palette, soft edges",
    swatch: "from-sky-200 via-rose-100 to-amber-100",
  },
  {
    id: "papercut",
    label: "Paper Cut Collage",
    description: "Layered cut-paper shapes with subtle shadows.",
    promptHint:
      "layered cut-paper collage illustration, flat shapes, subtle drop shadows, textured paper, bold simple forms",
    swatch: "from-emerald-200 via-teal-100 to-cyan-200",
  },
  {
    id: "crayon",
    label: "Crayon & Doodle",
    description: "Handdrawn crayon textures with a childlike charm.",
    promptHint:
      "hand-drawn crayon and colored pencil children's illustration, scribbly textures, warm childlike charm",
    swatch: "from-orange-200 via-yellow-100 to-lime-200",
  },
  {
    id: "3d-cute",
    label: "Cute 3D",
    description: "Rounded, glossy 3D characters with soft lighting.",
    promptHint:
      "cute rounded 3D rendered characters, soft global illumination, glossy clay material, pixar-like, shallow depth of field",
    swatch: "from-violet-200 via-fuchsia-100 to-pink-200",
  },
  {
    id: "flat-vector",
    label: "Flat Vector",
    description: "Clean modern flat shapes with bright color blocks.",
    promptHint:
      "clean flat vector illustration, bold geometric shapes, bright color blocks, minimal shading, modern",
    swatch: "from-indigo-200 via-blue-100 to-sky-200",
  },
  {
    id: "storybook-classic",
    label: "Classic Storybook",
    description: "Rich, painterly, timeless fairy-tale illustration.",
    promptHint:
      "classic painterly storybook illustration, rich detail, warm timeless fairy-tale mood, fine brushwork",
    swatch: "from-amber-200 via-orange-100 to-rose-200",
  },
];

export interface BookSizeOption {
  id: BookSize;
  label: string;
  description: string;
  /** Aspect ratio width:height of a single page. */
  aspect: number;
  /** Physical trim size of a single page, in inches (drives print/PDF export). */
  widthIn: number;
  heightIn: number;
}

export const BOOK_SIZES: BookSizeOption[] = [
  { id: "square", label: "Square", description: "1:1 — friendly and balanced, great for young readers.", aspect: 1, widthIn: 8.5, heightIn: 8.5 },
  { id: "landscape", label: "Landscape", description: "4:3 — wide scenes and panoramic spreads.", aspect: 4 / 3, widthIn: 10, heightIn: 7.5 },
  { id: "portrait", label: "Portrait", description: "3:4 — tall, classic picture-book feel.", aspect: 3 / 4, widthIn: 7.5, heightIn: 10 },
];

/** Resolution (dots per inch) used when rasterizing pages for export. */
export const EXPORT_DPI = 300;

/** Trim size (inches) for a single page of the given book size. */
export function pageTrimInches(size: BookSize): { widthIn: number; heightIn: number } {
  const opt = BOOK_SIZES.find((b) => b.id === size) ?? BOOK_SIZES[0];
  return { widthIn: opt.widthIn, heightIn: opt.heightIn };
}

/** Classify a page aspect ratio (w/h) into the coarse shape used for prompts/image sizing. */
export function bookSizeFromAspect(aspect: number): BookSize {
  if (aspect >= 1.12) return "landscape";
  if (aspect <= 0.9) return "portrait";
  return "square";
}

export interface GraphicsDensityOption {
  id: GraphicsDensity;
  label: string;
  description: string;
}

export const GRAPHICS_DENSITY: GraphicsDensityOption[] = [
  { id: "one-per-page", label: "One graphic per page", description: "A single illustration anchors each page." },
  { id: "multiple-per-page", label: "Multiple per page", description: "Several smaller graphics arranged on a page." },
  { id: "combination", label: "Smart combination", description: "Mix single and multi-graphic pages where it fits best." },
];

export interface SpreadUsageOption {
  id: SpreadUsage;
  label: string;
  description: string;
  /** Which book sizes this spread option makes sense for. */
  validSizes: BookSize[];
}

export const SPREAD_USAGE: SpreadUsageOption[] = [
  {
    id: "single",
    label: "Single pages",
    description: "Each illustration fills one page.",
    validSizes: ["square", "landscape", "portrait"],
  },
  {
    id: "double",
    label: "Double-page spreads",
    description: "Illustrations stretch across two facing pages.",
    // A single landscape page already reads wide; double spreads shine for square/portrait.
    validSizes: ["square", "portrait", "landscape"],
  },
  {
    id: "mixed",
    label: "Mixed",
    description: "Combine single pages and full spreads for pacing.",
    validSizes: ["square", "portrait", "landscape"],
  },
];

export interface TextHandlingOption {
  id: TextHandling;
  label: string;
  description: string;
}

export const TEXT_HANDLING: TextHandlingOption[] = [
  { id: "exact", label: "Use my text exactly", description: "Keep wording as written; only split across pages." },
  { id: "creative", label: "Allow creative edits", description: "Let the system adapt wording for age & rhythm." },
];

export interface TextPlacementOption {
  id: TextPlacement;
  label: string;
  description: string;
}

export const TEXT_PLACEMENT: TextPlacementOption[] = [
  { id: "separate", label: "Separate from graphics", description: "Text lives in its own editable layer beside or around the art." },
];

/**
 * Layout templates for the "separate" placement mode. Each describes how a page
 * (or spread) splits its area between text and graphics. `spread` indicates the
 * template is meant for a two-page layout.
 */
export interface LayoutTemplate {
  id: string;
  label: string;
  description: string;
  spread: boolean;
  /**
   * Premium layouts are only selectable on plans that unlock them (via
   * `PlanEntitlements.layouts`). Non-premium layouts are available to everyone.
   */
  premium?: boolean;
  /** A schematic of regions, used to render the example diagram. */
  regions: LayoutRegion[];
}

export interface LayoutRegion {
  kind: "text" | "graphic";
  /** Grid placement within a 2x2 (single) or 4x2 (spread) schematic, as fractions. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  {
    id: "auto",
    label: "Let the system decide",
    description: "Choose the best layout per page automatically.",
    spread: false,
    regions: [],
  },
  {
    id: "text-left-graphic-right",
    label: "Text left · Graphic right",
    description: "Classic spread: words on the left, art on the right.",
    spread: true,
    regions: [
      { kind: "text", x: 0, y: 0, w: 0.5, h: 1 },
      { kind: "graphic", x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  {
    id: "graphic-left-text-right",
    label: "Graphic left · Text right",
    description: "Art on the left page, words on the right.",
    spread: true,
    regions: [
      { kind: "graphic", x: 0, y: 0, w: 0.5, h: 1 },
      { kind: "text", x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  {
    id: "graphic-top-text-bottom",
    label: "Graphic top · Text bottom",
    description: "Illustration on top, caption beneath.",
    spread: false,
    regions: [
      { kind: "graphic", x: 0, y: 0, w: 1, h: 0.66 },
      { kind: "text", x: 0, y: 0.66, w: 1, h: 0.34 },
    ],
  },
  {
    id: "text-top-graphic-bottom",
    label: "Text top · Graphic bottom",
    description: "Caption on top, illustration beneath.",
    spread: false,
    regions: [
      { kind: "text", x: 0, y: 0, w: 1, h: 0.34 },
      { kind: "graphic", x: 0, y: 0.34, w: 1, h: 0.66 },
    ],
  },
  {
    id: "alternating",
    label: "Alternating sides",
    description: "Swap text/graphic sides every spread for rhythm.",
    spread: true,
    premium: true,
    regions: [
      { kind: "text", x: 0, y: 0, w: 0.5, h: 1 },
      { kind: "graphic", x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
];

/** Layout ids available to everyone; premium layouts require a plan entitlement. */
export const BASE_LAYOUT_IDS: string[] = LAYOUT_TEMPLATES.filter((l) => !l.premium).map((l) => l.id);

export function layoutsForPlacement(
  placement: TextPlacement,
  spreadUsage: SpreadUsage,
): LayoutTemplate[] {
  if (placement === "embedded") {
    // When text is embedded into art, only the "auto" option is meaningful.
    return LAYOUT_TEMPLATES.filter((l) => l.id === "auto");
  }
  return LAYOUT_TEMPLATES.filter((l) => {
    if (l.id === "auto") return true;
    if (spreadUsage === "single") return !l.spread;
    if (spreadUsage === "double") return l.spread;
    return true; // mixed: allow all
  });
}

export function spreadOptionsForSize(size: BookSize): SpreadUsageOption[] {
  return SPREAD_USAGE.filter((o) => o.validSizes.includes(size));
}
