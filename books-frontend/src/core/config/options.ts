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
  /** Short card blurb in the setup wizard (superseded by ageWriting catalog when configured). */
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
  /** Short phrase injected into image prompts when no full description is set. */
  promptHint: string;
  /** Full art-direction paragraph for image-generation prompts. */
  promptDescription: string;
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
    promptDescription:
      "Children's picture-book illustration in soft watercolor on textured paper. Use transparent layered washes with gentle color bleeding at the edges; avoid hard outlines and flat digital fills. Palette: muted pastels — dusty rose, soft sky blue, warm cream, sage green, with occasional deeper accents for focal points. Lighting is diffuse and warm, like late-morning sunlight through a window. Characters have simplified, rounded forms with expressive but not hyper-detailed faces; proportions slightly storybook-stylized, never photorealistic. Backgrounds suggest environment with loose brushwork rather than sharp architectural detail. Mood: calm, tender, dreamy, safe. Avoid: harsh shadows, neon colors, glossy 3D rendering, heavy black ink lines, photorealism, scary or grotesque imagery.",
    swatch: "from-sky-200 via-rose-100 to-amber-100",
  },
  {
    id: "papercut",
    label: "Paper Cut Collage",
    description: "Layered cut-paper shapes with subtle shadows.",
    promptHint:
      "layered cut-paper collage illustration, flat shapes, subtle drop shadows, textured paper, bold simple forms",
    promptDescription:
      "Layered cut-paper collage illustration with visible paper grain and subtle drop shadows between layers. Shapes are bold, flat, and geometric — hand-cut edges with slight imperfections, not vector-perfect curves. Limited depth: 3–6 paper layers max, each a distinct color block. Palette: saturated but harmonious — teal, coral, mustard, navy, cream — with high contrast for readability at a distance. Characters built from simple paper shapes; facial features minimal (dots, small curves). Environments read as stacked paper planes (hills, trees, buildings as silhouettes). Mood: playful, tactile, craft-like, cheerful. Avoid: gradients, painterly brushstrokes, 3D rendering, fine cross-hatching, muddy low-contrast palettes, realistic textures.",
    swatch: "from-emerald-200 via-teal-100 to-cyan-200",
  },
  {
    id: "crayon",
    label: "Crayon & Doodle",
    description: "Handdrawn crayon textures with a childlike charm.",
    promptHint:
      "hand-drawn crayon and colored pencil children's illustration, scribbly textures, warm childlike charm",
    promptDescription:
      "Hand-drawn children's illustration using crayon and colored pencil on off-white paper. Visible waxy texture, uneven fill, and slightly scribbly line work — charmingly imperfect, as if drawn by a talented child. Outlines are medium-weight and slightly wobbly; coloring often extends past the lines. Palette: warm primary and secondary colors — red, yellow, blue, orange, green — with white paper showing through in places. Characters are friendly, exaggerated, and approachable with big eyes and simple bodies. Backgrounds are sparse or loosely sketched. Mood: spontaneous, warm, intimate, humorous. Avoid: polished digital art, smooth gradients, airbrush effects, anime style, hyper-detailed realism, dark or frightening tones.",
    swatch: "from-orange-200 via-yellow-100 to-lime-200",
  },
  {
    id: "3d-cute",
    label: "Cute 3D",
    description: "Rounded, glossy 3D characters with soft lighting.",
    promptHint:
      "cute rounded 3D rendered characters, soft global illumination, glossy clay material, pixar-like, shallow depth of field",
    promptDescription:
      "Cute rounded 3D rendered characters in a Pixar-adjacent children's style. Soft global illumination, gentle ambient occlusion, shallow depth of field. Materials feel like smooth matte clay or soft plastic — no hard metallic or glass surfaces unless the scene requires it. Characters have large heads, big expressive eyes, small noses, and simplified limbs; always friendly and non-threatening. Palette: bright but soft — lavender, peach, mint, sky blue, warm white — with cohesive color grading across the scene. Environments are stylized miniature sets with rounded edges and simplified props. Mood: bubbly, optimistic, modern, inviting. Avoid: uncanny realism, sharp angular designs, horror lighting, gritty textures, low-poly game aesthetic, text or logos in the scene.",
    swatch: "from-violet-200 via-fuchsia-100 to-pink-200",
  },
  {
    id: "flat-vector",
    label: "Flat Vector",
    description: "Clean modern flat shapes with bright color blocks.",
    promptHint:
      "clean flat vector illustration, bold geometric shapes, bright color blocks, minimal shading, modern",
    promptDescription:
      "Clean modern flat vector illustration with bold geometric shapes and minimal shading. No gradients or only very subtle ones; color blocks separated by crisp edges or thin consistent outlines. Palette: bright, contemporary primaries and secondaries with one accent color per scene for hierarchy. Characters use simple shapes — circles, rounded rectangles — with clear silhouettes readable at thumbnail size. Backgrounds are simplified and uncluttered; decorative elements are abstract or icon-like. Mood: fresh, energetic, inclusive, design-forward. Avoid: painterly textures, watercolor washes, 3D depth, heavy shadows, photorealism, cluttered detail, vintage storybook ornamentation.",
    swatch: "from-indigo-200 via-blue-100 to-sky-200",
  },
  {
    id: "storybook-classic",
    label: "Classic Storybook",
    description: "Rich, painterly, timeless fairy-tale illustration.",
    promptHint:
      "classic painterly storybook illustration, rich detail, warm timeless fairy-tale mood, fine brushwork",
    promptDescription:
      "Timeless painterly storybook illustration in the tradition of classic fairy-tale art. Rich but controlled detail: fine brushwork, warm naturalistic lighting, and a sense of depth through atmospheric perspective. Palette: deep jewel tones and earth colors — burgundy, forest green, gold, amber, twilight blue — with warm highlights on faces and focal objects. Characters are expressive with readable emotions; clothing and settings carry period-agnostic storybook charm (not tied to a specific historical era). Backgrounds are lush and immersive but composition always guides the eye to the narrative moment. Mood: wonder, warmth, adventure, timeless magic. Avoid: flat vector simplification, neon colors, modern UI aesthetics, anime/manga proportions, photorealistic photography, horror or visceral imagery.",
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
