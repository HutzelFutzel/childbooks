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
 * MVP ships one layout — `outer-text` — where the text hugs the OUTER edge of
 * each page over a calm band the illustration keeps clear. Adding another is
 * purely additive: register a spec here and seeding, prompts, image sizing,
 * gating and the picker all follow from it.
 */
import type { HAlign, NormRect, PageBackground, VAlign } from "../design";
import type { BookSize } from "../config/options";
import { complementRect, describeRegion, describeRegions, unionRect } from "./regionText";
import { DEFAULT_TREATMENT_ID, getTreatment, type RegionTreatment } from "./treatments";

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
  requirements?: LayoutRequirements;
  /** Instruction for the screenplay model, so the plan it writes matches. */
  screenplayGuidance: string;
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
  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    defaultMode: spec.defaultMode,
    supportedModes: spec.supportedModes,
    premium: spec.premium,
    requirements: spec.requirements,
    screenplayGuidance: spec.screenplayGuidance,
    promptKey: spec.promptKey,
    spec,
    plan(ctx: LayoutContext): LayoutPlan {
      const slots = (spec.slots[ctx.side] ?? []).map<ResolvedSlot>((slot) => ({
        ...slot,
        pageRect: safeToPage(slot.rect, ctx.safe),
        treatment: getTreatment(slot.treatmentId ?? DEFAULT_TREATMENT_ID),
      }));
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
}

// ---- Registered layouts ----------------------------------------------------

/**
 * Text hugs the outer edge. Left-hand pages put it on the left, right-hand
 * pages on the right, and a double spread — twice as wide — uses a narrower
 * column on its far-left outer edge.
 *
 * The rects are safe-area relative: `x: 0` is the printable left edge, so the
 * column sits flush with the margin on every trim rather than overhanging it
 * on some and floating on others.
 */
const OUTER_TEXT_SPEC: LayoutSpec = {
  id: "outer-text",
  label: "Text on the outer edge",
  description:
    "Words sit in a calm column along the outer edge of each page — left on left-hand pages, right on right-hand pages — beside the illustration.",
  defaultMode: "full-bleed",
  supportedModes: ["full-bleed", "inset-art"],
  requirements: {
    // A column narrower than this stops being readable at picture-book sizes.
    minTextColumnIn: 1.8,
    minArtAspect: 0.4,
    maxArtAspect: 3.2,
  },
  screenplayGuidance:
    "Every page keeps its text in a calm column along the OUTER edge (left on left-hand pages, right on right-hand pages), about one-third of the page width, beside the illustration. In each spread's layoutNote, note that the outer-edge third stays calm and text-safe.",
  slots: {
    left: [
      {
        id: "body",
        role: "text",
        label: "Story text",
        // Flush with the outer (left) margin, a third of the printable width.
        rect: { x: 0, y: 0, w: 0.32, h: 1 },
        source: "spread-text",
        presetId: "plain",
        align: "center",
        vAlign: "center",
        treatmentId: "calm",
      },
    ],
    right: [
      {
        id: "body",
        role: "text",
        label: "Story text",
        rect: { x: 0.68, y: 0, w: 0.32, h: 1 },
        source: "spread-text",
        presetId: "plain",
        align: "center",
        vAlign: "center",
        treatmentId: "calm",
      },
    ],
    spread: [
      {
        id: "body",
        role: "text",
        label: "Story text",
        // A spread is twice as wide, so the same inches are half the fraction.
        rect: { x: 0, y: 0, w: 0.17, h: 1 },
        source: "spread-text",
        presetId: "plain",
        align: "center",
        vAlign: "center",
        treatmentId: "calm",
      },
    ],
  },
};

const OUTER_TEXT = layoutFromSpec(OUTER_TEXT_SPEC);

/** All registered structural layouts, keyed by id. */
export const BOOK_LAYOUTS: Record<string, BookLayout> = {
  [OUTER_TEXT.id]: OUTER_TEXT,
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

export function layoutPromptFacts(plan: LayoutPlan, surfaceAspect: number): LayoutPromptFacts {
  const textSlots = plan.slots.filter((s) => s.role === "text" || s.role === "decor");
  const rects = textSlots.map((s) => s.pageRect);
  const isInsetArt = plan.mode === "inset-art";

  // Inset art physically excludes the text region, so there is nothing to keep
  // calm and no instruction to give — the guarantee is geometric.
  const hasCalmBand = !isInsetArt && rects.length > 0;
  const focal = complementRect(unionRect(rects));

  // The treatment describes only how the region should look; where it is comes
  // from the geometry above, so the two clauses don't restate each other.
  const treatment = textSlots[0]?.treatment;
  const fragment =
    hasCalmBand && treatment?.mechanism === "prompt" ? (treatment.promptFragment ?? "") : "";

  return {
    mode: plan.mode,
    calmRegions: hasCalmBand ? describeRegions(rects) : "",
    focalRegion: hasCalmBand && focal ? describeRegion(focal) : "",
    treatmentInstruction: fragment,
    artAspectLabel: isInsetArt ? artAspectLabel(plan.artRect, surfaceAspect) : "",
    hasCalmBand,
    isInsetArt,
  };
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
