/**
 * Structural page layouts.
 *
 * A `BookLayout` is *structural*: it says exactly where the editable text sits
 * on a page, what the image model must do to leave room for it, and how big the
 * artwork should be generated. The design editor seeds text from the plan, the
 * illustration pipeline compiles the same plan into prompt facts, and the image
 * request derives its dimensions from it — so the words, the art and the page
 * can never disagree.
 *
 * The unit of authorship is a {@link LayoutSpec}: a serializable list of slots
 * per page side. Slots are authored in SAFE-AREA space (0..1 of the page's
 * printable safe rectangle) rather than raw page fractions, so one spec stays
 * correct across trims whose half-inch margin is a different fraction of the
 * page. Artwork rectangles are in PAGE space, because art bleeds to the trim.
 *
 * Layouts whose geometry depends on runtime state (text length, alternating
 * pages) can implement {@link BookLayout} directly; everything else is data,
 * which is what makes admin-authored layouts possible later without a rewrite.
 *
 * Four shipped layouts, two families:
 *   - overlay (`full-bleed`) — words sit on the picture in a calm band
 *   - split (`inset-art`) — words sit next to the picture on the page colour
 * Each layout locks to one family so the picker is a real choice, not a mode
 * toggle. Adding another is purely additive: register a spec here and seeding,
 * prompts, image sizing, gating and the picker all follow from it. Overlay
 * calm regions are compiled from each text slot's grid; split layouts never
 * ask for a painted band. Screenplay copy is compiled the same way.
 */
import type { HAlign, NormRect, PageBackground, VAlign } from "../design";
import type { BookSize } from "../config/options";
import {
  complementGridArea,
  describeGridAreaForPrompt,
  gridAreaProblems,
  gridRect,
  type GridArea,
} from "./grid";
import { complementRect, describeRegion, describeRegions, unionRect } from "./regionText";
import { DEFAULT_TREATMENT_ID, getTreatment, resolveTreatmentForModel, type RegionTreatment } from "./treatments";

/** Which physical side of the book a page sits on — drives the outer edge. */
export type PageSide = "left" | "right" | "spread";

export const PAGE_SIDES: PageSide[] = ["left", "right", "spread"];

/**
 * How the artwork relates to the page.
 *   - `full-bleed` — art covers the whole page; the text region must be kept
 *     calm by the model (soft constraint, verified after generation).
 *   - `inset-art`  — art is generated at the shape of the region it occupies
 *     and placed beside the text (hard guarantee, no reliance on compliance).
 */
export type CompositionMode = "full-bleed" | "inset-art";

export const COMPOSITION_MODES: CompositionMode[] = ["full-bleed", "inset-art"];

export const COMPOSITION_MODE_LABELS: Record<CompositionMode, string> = {
  "full-bleed": "Art fills the page",
  "inset-art": "Art beside the text",
};

export type SlotRole = "text" | "art" | "decor";

/** Which piece of the book's content feeds a text slot. */
export type SlotSource = "spread-text" | "book-title" | "book-subtitle";

/** One region of a page: where it is, what goes in it, how it's styled. */
export interface LayoutSlot {
  /** Stable within the layout — text boxes are tagged with it so a layout
   *  change can move exactly the boxes it owns and leave the user's alone. */
  id: string;
  role: SlotRole;
  /** Rect in SAFE-AREA space (0..1 of the page's safe rectangle). */
  rect: NormRect;
  /**
   * Grid the rect was authored from, when it is a clean fraction. Overlay
   * prompts name this area so the model reserves the same band the slot uses.
   */
  grid?: GridArea;
  source?: SlotSource;
  /** Text preset id (see `ui/design/presets`). */
  presetId?: string;
  align?: HAlign;
  vAlign?: VAlign;
  /** How the artwork behind this slot is treated (see `./treatments`). */
  treatmentId?: string;
  /** Display name in the layers panel / admin. */
  label?: string;
}

/** Constraints that decide whether a layout can be used at all. */
export interface LayoutRequirements {
  /** Coarse page shapes this layout is designed for. Omitted ⇒ any. */
  shapes?: BookSize[];
  /** Exact trims, keyed like `trimKey()` ("8.5x11"). `allow` is authoritative. */
  trims?: { allow?: string[]; deny?: string[] };
  /** Readability floor: the narrowest text column this layout tolerates. */
  minTextColumnIn?: number;
  /** Readability floor: the shortest full-width text band this layout tolerates. */
  minTextBandIn?: number;
  /** Inset art only — refuse letterbox slivers. */
  minArtAspect?: number;
  maxArtAspect?: number;
}

/** A serializable layout: slots per side, plus everything gating needs. */
export interface LayoutSpec {
  id: string;
  label: string;
  description: string;
  defaultMode: CompositionMode;
  supportedModes: CompositionMode[];
  premium?: boolean;
  /** Picker order (lower first). Admin overlay can override. */
  order?: number;
  requirements?: LayoutRequirements;
  /**
   * Optional extra screenplay note. Placement (calm bands vs inset art) is
   * compiled from the spec's geometry in {@link compileScreenplayGuidance}, so
   * a new layout does not need a hand-written "leave the outer edge empty".
   */
  screenplayGuidance?: string;
  /** Optional bespoke prompt template key (falls back to the shared one). */
  promptKey?: string;
  /** Slots per page side, in SAFE-AREA space. */
  slots: Record<PageSide, LayoutSlot[]>;
  /** Explicit art rect per side (PAGE space); derived from slots when absent. */
  artRect?: Partial<Record<PageSide, NormRect>>;
}

export interface LayoutContext {
  side: PageSide;
  /** The page's normalized safe rectangle (from `computePageGuides`). */
  safe: NormRect;
  /** Page surface aspect (width/height), doubled for spreads. */
  aspect: number;
  /** Single-page trim in inches. */
  trim: { widthIn: number; heightIn: number };
  isCover: boolean;
  mode: CompositionMode;
  /** Characters of text to place — lets a layout choose a roomier band. */
  textLength?: number;
}

/** A slot resolved onto the page surface. */
export interface ResolvedSlot extends LayoutSlot {
  /** The slot rect in PAGE space (0..1 of the page surface). */
  pageRect: NormRect;
  treatment: RegionTreatment;
}

export interface LayoutPlan {
  layoutId: string;
  mode: CompositionMode;
  side: PageSide;
  slots: ResolvedSlot[];
  /** Where the artwork sits, in PAGE space. Full page for `full-bleed`. */
  artRect: NormRect;
  /** Page fill visible where the artwork doesn't reach (inset modes). */
  background?: PageBackground;
}

export interface BookLayout {
  id: string;
  label: string;
  description: string;
  defaultMode: CompositionMode;
  supportedModes: CompositionMode[];
  premium?: boolean;
  order?: number;
  requirements?: LayoutRequirements;
  screenplayGuidance: string;
  promptKey?: string;
  /** The authoring spec, when this layout is data-driven. */
  spec?: LayoutSpec;
  plan(ctx: LayoutContext): LayoutPlan;
}

const FULL_PAGE: NormRect = { x: 0, y: 0, w: 1, h: 1 };

/** Map a safe-area rect onto the page surface. */
export function safeToPage(rect: NormRect, safe: NormRect): NormRect {
  return {
    x: safe.x + rect.x * safe.w,
    y: safe.y + rect.y * safe.h,
    w: rect.w * safe.w,
    h: rect.h * safe.h,
  };
}

/**
 * Where inset artwork can go, given the page-space regions text occupies.
 *
 * Returns null when the text doesn't hug an edge — a layout with a floating
 * text block genuinely cannot be rendered as inset art, and saying so here is
 * what lets {@link validateLayouts} catch a spec that claims otherwise.
 */
export function deriveArtRect(textRects: NormRect[]): NormRect | null {
  return complementRect(unionRect(textRects));
}

/** Build a `BookLayout` from a serializable spec. */
export function layoutFromSpec(spec: LayoutSpec): BookLayout {
  const layout: BookLayout = {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    defaultMode: spec.defaultMode,
    supportedModes: spec.supportedModes,
    premium: spec.premium,
    order: spec.order,
    requirements: spec.requirements,
    screenplayGuidance: "",
    promptKey: spec.promptKey,
    spec,
    plan(ctx: LayoutContext): LayoutPlan {
      const slots = (spec.slots[ctx.side] ?? []).map<ResolvedSlot>((slot) => {
        const rect = slot.grid ? gridRect(slot.grid) : slot.rect;
        return {
          ...slot,
          rect,
          pageRect: safeToPage(rect, ctx.safe),
          treatment: getTreatment(slot.treatmentId ?? DEFAULT_TREATMENT_ID),
        };
      });
      const mode = spec.supportedModes.includes(ctx.mode) ? ctx.mode : spec.defaultMode;
      const textRects = slots
        .filter((s) => s.role === "text" || s.role === "decor")
        .map((s) => s.pageRect);
      const artRect =
        mode === "inset-art"
          ? spec.artRect?.[ctx.side] ?? deriveArtRect(textRects) ?? FULL_PAGE
          : FULL_PAGE;
      return { layoutId: spec.id, mode, side: ctx.side, slots, artRect };
    },
  };
  layout.screenplayGuidance = compileScreenplayGuidance(layout);
  return layout;
}

// ---- Registered layouts ----------------------------------------------------

const OUTER_COLUMN: Record<PageSide, GridArea> = {
  left: { columns: 3, rows: 1, column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
  right: { columns: 3, rows: 1, column: 2, row: 0, columnSpan: 1, rowSpan: 1 },
  // A spread is twice as wide, so one page-third is one sixth of the surface.
  spread: { columns: 6, rows: 1, column: 0, row: 0, columnSpan: 1, rowSpan: 1 },
};

const BOTTOM_BAND: Record<PageSide, GridArea> = {
  left: { columns: 1, rows: 4, column: 0, row: 3, columnSpan: 1, rowSpan: 1 },
  right: { columns: 1, rows: 4, column: 0, row: 3, columnSpan: 1, rowSpan: 1 },
  spread: { columns: 1, rows: 4, column: 0, row: 3, columnSpan: 1, rowSpan: 1 },
};

const COLUMN_REQUIREMENTS: LayoutRequirements = {
  minTextColumnIn: 1.8,
  minArtAspect: 0.4,
  maxArtAspect: 3.2,
};

const BAND_REQUIREMENTS: LayoutRequirements = {
  minTextBandIn: 1.2,
  minArtAspect: 0.4,
  maxArtAspect: 3.2,
};

function storySlots(
  areas: Record<PageSide, GridArea>,
  treatmentId: string,
): Record<PageSide, LayoutSlot[]> {
  const slot = (area: GridArea): LayoutSlot => ({
    id: "body",
    role: "text",
    label: "Story text",
    grid: area,
    rect: gridRect(area),
    source: "spread-text",
    presetId: "plain",
    align: "center",
    vAlign: "center",
    treatmentId,
  });
  return {
    left: [slot(areas.left)],
    right: [slot(areas.right)],
    spread: [slot(areas.spread)],
  };
}

/**
 * Overlay · outer column. Words sit ON the picture along the outer edge —
 * left on left-hand pages, right on right-hand pages.
 *
 * Rects are safe-area relative: `x: 0` is the printable left edge, so the
 * column sits flush with the margin on every trim.
 */
const OUTER_TEXT_SPEC: LayoutSpec = {
  id: "outer-text",
  label: "Text on the outer edge",
  description:
    "Words sit in a calm column along the outer edge of each page — on the illustration, not beside it.",
  defaultMode: "full-bleed",
  supportedModes: ["full-bleed"],
  order: 10,
  requirements: COLUMN_REQUIREMENTS,
  slots: storySlots(OUTER_COLUMN, "calm"),
};

/**
 * Overlay · bottom band. Words sit ON the picture across the lower quarter.
 */
const OVERLAY_BOTTOM_SPEC: LayoutSpec = {
  id: "overlay-bottom",
  label: "Text across the picture",
  description:
    "Words sit in a calm band along the bottom of the page, on top of the full-page illustration.",
  defaultMode: "full-bleed",
  supportedModes: ["full-bleed"],
  order: 20,
  requirements: BAND_REQUIREMENTS,
  slots: storySlots(BOTTOM_BAND, "calm"),
};

/**
 * Split · side by side. Same outer column as `outer-text`, but the picture
 * stops where the words begin.
 */
const SPLIT_SIDE_SPEC: LayoutSpec = {
  id: "split-side",
  label: "Picture beside the words",
  description:
    "The illustration fills the inner part of the page; the story sits in a column on the outer edge, on the page colour.",
  defaultMode: "inset-art",
  supportedModes: ["inset-art"],
  order: 30,
  requirements: COLUMN_REQUIREMENTS,
  slots: storySlots(OUTER_COLUMN, "none"),
};

/**
 * Split · stacked. Same bottom band as `overlay-bottom`, but the picture
 * sits above the words instead of behind them.
 */
const SPLIT_STACK_SPEC: LayoutSpec = {
  id: "split-stack",
  label: "Picture above the words",
  description:
    "The illustration fills the top of the page; the story sits in a strip along the bottom, on the page colour.",
  defaultMode: "inset-art",
  supportedModes: ["inset-art"],
  order: 40,
  requirements: BAND_REQUIREMENTS,
  slots: storySlots(BOTTOM_BAND, "none"),
};

const OUTER_TEXT = layoutFromSpec(OUTER_TEXT_SPEC);
const OVERLAY_BOTTOM = layoutFromSpec(OVERLAY_BOTTOM_SPEC);
const SPLIT_SIDE = layoutFromSpec(SPLIT_SIDE_SPEC);
const SPLIT_STACK = layoutFromSpec(SPLIT_STACK_SPEC);

/** All registered structural layouts, keyed by id. */
export const BOOK_LAYOUTS: Record<string, BookLayout> = {
  [OUTER_TEXT.id]: OUTER_TEXT,
  [OVERLAY_BOTTOM.id]: OVERLAY_BOTTOM,
  [SPLIT_SIDE.id]: SPLIT_SIDE,
  [SPLIT_STACK.id]: SPLIT_STACK,
};

/** The default layout; also the fallback for legacy / unknown layout ids. */
export const DEFAULT_BOOK_LAYOUT_ID = OUTER_TEXT.id;

/** Layout ids available to everyone; premium ones need a plan entitlement. */
export const BASE_LAYOUT_IDS: string[] = Object.values(BOOK_LAYOUTS)
  .filter((l) => !l.premium)
  .map((l) => l.id);

/** Resolve a layout by id, falling back to the default (covers legacy ids too). */
export function getBookLayout(id: string | undefined | null): BookLayout {
  return (id && BOOK_LAYOUTS[id]) || BOOK_LAYOUTS[DEFAULT_BOOK_LAYOUT_ID];
}

/** Every registered layout, in registration order. */
export function allBookLayouts(): BookLayout[] {
  return Object.values(BOOK_LAYOUTS);
}

/**
 * Is `id` a real structural layout? Older projects store ids from the retired
 * schematic template list (e.g. "graphic-left-text-right"), which resolve to
 * the default — this distinguishes "chose the default" from "never chose".
 */
export function isKnownLayoutId(id: string | undefined | null): boolean {
  return Boolean(id && BOOK_LAYOUTS[id]);
}

// ---- Prompt facts ----------------------------------------------------------

/**
 * Everything the image prompt needs to know about the layout, compiled from the
 * plan's geometry. The layout supplies facts; the (admin-editable) prompt
 * template supplies the wording. Nothing here is hand-written prose about
 * position, so widening a column automatically rewrites the instruction.
 */
export interface LayoutPromptFacts {
  mode: CompositionMode;
  /** Regions the artwork must keep calm, already described in words. */
  calmRegions: string;
  /** Where the focal action should go. */
  focalRegion: string;
  /** Treatment instruction for the calm regions, if any. */
  treatmentInstruction: string;
  /** Inset art only: the aspect the frame should be composed for. */
  artAspectLabel: string;
  hasCalmBand: boolean;
  isInsetArt: boolean;
}

/** Human-readable aspect for a rect on a surface of the given aspect ratio. */
export function artAspectLabel(artRect: NormRect, surfaceAspect: number): string {
  const ratio = (artRect.w * surfaceAspect) / artRect.h;
  if (ratio >= 1.6) return "wide landscape";
  if (ratio >= 1.15) return "landscape";
  if (ratio > 0.87) return "square";
  if (ratio > 0.62) return "portrait";
  return "tall portrait";
}

/**
 * Overlay text that the image model should keep clear. Split/inset art and
 * "untouched" / geometric treatments do not reserve a painted band.
 */
function slotWantsCalmBand(slot: ResolvedSlot): boolean {
  if (slot.role !== "text" && slot.role !== "decor") return false;
  const treatment = slot.treatment;
  if (treatment.id === "none" || treatment.mechanism === "geometry") return false;
  return true;
}

export function layoutPromptFacts(
  plan: LayoutPlan,
  surfaceAspect: number,
  opts?: { negativeSpaceControl?: "weak" | "strong" },
): LayoutPromptFacts {
  const isInsetArt = plan.mode === "inset-art";
  const calmSlots = isInsetArt ? [] : plan.slots.filter(slotWantsCalmBand);
  const rects = calmSlots.map((s) => s.pageRect);
  const hasCalmBand = calmSlots.length > 0;
  const grids = calmSlots.map((s) => s.grid).filter((g): g is GridArea => Boolean(g));
  const namedFromGrid = hasCalmBand && grids.length === calmSlots.length && grids.length > 0;
  // One grid's complement is itself a grid fraction. Several slots (or a
  // floating tile) have no single complementary cell — fall back to the
  // largest remaining rectangle so a new multi-slot overlay still names a
  // focal region without a new prompt branch.
  const focalGrid =
    namedFromGrid && grids.length === 1 && grids[0] ? complementGridArea(grids[0]) : null;
  const focal = complementRect(unionRect(rects));

  // The treatment describes only how the region should look; where it is comes
  // from the geometry above, so the two clauses don't restate each other.
  // Weak models skip the painted instruction — they get the location only.
  const treatment = resolveTreatmentForModel(
    calmSlots[0]?.treatment ?? getTreatment(DEFAULT_TREATMENT_ID),
    opts?.negativeSpaceControl ?? "strong",
  );
  const fragment =
    hasCalmBand && treatment.mechanism === "prompt" ? (treatment.promptFragment ?? "") : "";

  return {
    mode: plan.mode,
    calmRegions: !hasCalmBand
      ? ""
      : namedFromGrid
        ? grids.map(describeGridAreaForPrompt).join(" and ")
        : describeRegions(rects),
    focalRegion: !hasCalmBand
      ? ""
      : focalGrid
        ? describeGridAreaForPrompt(focalGrid)
        : focal
          ? describeRegion(focal)
          : "",
    treatmentInstruction: fragment,
    artAspectLabel: isInsetArt ? artAspectLabel(plan.artRect, surfaceAspect) : "",
    hasCalmBand,
    isInsetArt,
  };
}

/**
 * Screenplay instruction compiled from the layout's own plan, so a new layout
 * does not need a hand-written "keep the outer edge empty".
 *
 * Deliberately does not name left/right/bottom fractions: the screenplay is
 * often drafted before the reader picks a layout, and illustration prompts
 * already compile the exact band from {@link layoutPromptFacts}.
 */
export function compileScreenplayGuidance(
  layout: BookLayout,
  mode: CompositionMode = layout.defaultMode,
): string {
  const plan = layout.plan({
    side: "left",
    safe: { x: 0, y: 0, w: 1, h: 1 },
    aspect: 1,
    trim: { widthIn: 8, heightIn: 8 },
    isCover: false,
    mode,
  });
  const facts = layoutPromptFacts(plan, 1);
  const noteRule =
    "Each page's layoutNote is camera, staging and mood only. Do not mention where story text sits, calm bands, outer edges, or negative space for words — the illustration step applies the layout from its own geometry.";
  const placement =
    facts.isInsetArt || !facts.hasCalmBand
      ? "The illustration sits in its own region of the page, separate from the words. Do not leave a calm band in the artwork — the words are not on the picture."
      : "The story text is laid over the illustration. Describe the scene, characters and setting; do not invent a particular empty band for the words.";
  return `Text is ALWAYS a separate, editable overlay — never baked into the illustration. ${placement} ${noteRule} Never request text rendered inside the artwork.`;
}

// ---- Validation ------------------------------------------------------------

/**
 * Catalog invariants. Run by `scripts/print-invariants.ts` so "added a trim,
 * quietly broke a layout" is a build failure rather than a customer's book.
 */
export function validateLayouts(): string[] {
  const problems: string[] = [];
  for (const layout of allBookLayouts()) {
    const spec = layout.spec;
    if (!spec) continue;

    if (!spec.supportedModes.includes(spec.defaultMode)) {
      problems.push(`Layout "${spec.id}" defaults to a mode it doesn't support.`);
    }

    for (const side of PAGE_SIDES) {
      const slots = spec.slots[side] ?? [];
      const ids = new Set<string>();
      for (const slot of slots) {
        if (ids.has(slot.id)) problems.push(`Layout "${spec.id}" repeats slot id "${slot.id}" on ${side}.`);
        ids.add(slot.id);
        if (slot.grid) {
          for (const problem of gridAreaProblems(slot.grid)) {
            problems.push(`Layout "${spec.id}" slot "${slot.id}" (${side}): ${problem}`);
          }
        } else if (spec.defaultMode === "full-bleed" && slot.role === "text") {
          problems.push(
            `Layout "${spec.id}" overlay text slot "${slot.id}" (${side}) has no grid, so the calm-band prompt cannot name a fraction.`,
          );
        }
        const { x, y, w, h } = slot.rect;
        if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) {
          problems.push(`Layout "${spec.id}" slot "${slot.id}" (${side}) is outside the safe area.`);
        }
      }

      // A spec that advertises inset art must actually have room for it.
      if (spec.supportedModes.includes("inset-art") && !spec.artRect?.[side]) {
        const safe: NormRect = { x: 0.06, y: 0.06, w: 0.88, h: 0.88 };
        const rects = slots
          .filter((s) => s.role === "text" || s.role === "decor")
          .map((s) => safeToPage(s.rect, safe));
        if (rects.length > 0 && !deriveArtRect(rects)) {
          problems.push(
            `Layout "${spec.id}" claims inset-art support but its ${side} text doesn't hug a page edge, so there's no room for inset artwork.`,
          );
        }
      }
    }
  }
  return problems;
}
