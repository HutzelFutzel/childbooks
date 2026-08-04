/**
 * Core domain types for the Childbook Generator.
 * Pure data structures, serializable to JSON for local-first storage.
 */

import type {
  AgeRange,
  BookSize,
  GraphicsDensity,
  Modality,
  ModelTier,
  ProviderId,
  SpreadUsage,
  TextHandling,
  TextPlacement,
} from "./config/options";
import type { ReadingModeId } from "./config/ageWritingCatalog";
import type { VersionTree } from "./versioning";
import type { BookDesign } from "./design";
import { DEFAULT_BOOK_LAYOUT_ID, type CompositionMode } from "./book/layouts";

export type { ProviderId, Modality, ModelTier } from "./config/options";

/** A concrete model the user can pick, resolved from discovery + catalog. */
export interface ModelInfo {
  provider: ProviderId;
  /** API model id, e.g. "gpt-5.4" or "gemini-3-pro". */
  id: string;
  displayName: string;
  modality: Modality;
  tier: ModelTier;
  description?: string;
  /** Image-only: whether the model accepts reference images for consistency. */
  supportsReferenceImages?: boolean;
  /** Whether this entry was confirmed available via live discovery. */
  discovered: boolean;
}

export interface ModelSelection {
  provider: ProviderId;
  id: string;
}

export interface ArtStyleSelection {
  /** Preset id from ART_STYLE_PRESETS, or null when fully custom. */
  presetId: string | null;
  /** Optional free-text creative additions / overrides. */
  customDescription?: string;
}

/** Everything captured by the setup wizard. */
export interface BookConfig {
  storyText: string;
  textModel: ModelSelection | null;
  /**
   * Primary image model, used for page/cover illustrations (where editing
   * quality matters most). Also the fallback for anchor reference sheets.
   */
  imageModel: ModelSelection | null;
  /**
   * Optional separate image model for anchor reference sheets. Anchors are
   * generated far more often during setup, so a faster/cheaper model is a good
   * default here. Falls back to `imageModel` when unset.
   */
  anchorImageModel?: ModelSelection | null;
  artStyle: ArtStyleSelection;
  ageRangeId: string;
  /** How the book is read — required for 6–8 and 9–12 age bands. */
  readingModeId?: ReadingModeId | null;
  /**
   * Physical book product SKU (real trim + binding/format) chosen for print.
   * Source of truth for the page's physical size. See `core/book.ts`.
   */
  productSku: string;
  /**
   * Coarse page shape, derived from the product. Retained because image
   * generation and prompts reason about orientation, not exact inches.
   */
  bookSize: BookSize;
  graphicsDensity: GraphicsDensity;
  spreadUsage: SpreadUsage;
  textHandling: TextHandling;
  textPlacement: TextPlacement;
  /** Structural page layout id (see `core/book/layouts`). */
  layoutId: string;
  /**
   * How the artwork relates to the page: filling it (with the text region kept
   * calm) or generated beside the text. Unset ⇒ the layout's own default, so
   * older projects keep the full-bleed behaviour they were made with.
   */
  compositionMode?: CompositionMode;
  /**
   * Whether the reader has confirmed the physical book setup (size / format /
   * layout) in the Design step at least once. Until then, entering Design shows
   * the guided setup intro; afterwards it opens straight to the canvas and the
   * setup is reachable as a summary. Optional so older projects default to the
   * intro on their next Design visit.
   */
  designReady?: boolean;
}

export function createDefaultConfig(): BookConfig {
  return {
    storyText: "",
    textModel: null,
    imageModel: null,
    artStyle: { presetId: "watercolor" },
    ageRangeId: "3-5",
    readingModeId: null,
    // Default to the square hardcover product (see BOOK_PRODUCTS / Lulu catalog).
    productSku: "0850X0850FCPRECW080CW444GXX",
    bookSize: "square",
    // Simple, fixed layout for now: one illustration per single page with the
    // text laid out beside it (image on one side, words on the other). The
    // advanced graphics/text/layout knobs were removed from setup.
    graphicsDensity: "one-per-page",
    spreadUsage: "single",
    textHandling: "creative",
    textPlacement: "separate",
    layoutId: DEFAULT_BOOK_LAYOUT_ID,
  };
}

/**
 * The high-level mode a project is in.
 *   - `setup`  — first-run configuration (story + style), before the studio opens.
 *   - `studio` — the single unified workspace where everything is designed at once.
 */
export type ProjectStage = "setup" | "studio";

export const STAGE_ORDER: ProjectStage[] = ["setup", "studio"];

export const STAGE_LABELS: Record<ProjectStage, string> = {
  setup: "Setup",
  studio: "Studio",
};

/** A subject in the story that must stay visually consistent across the book. */
export type AnchorType = "character" | "place" | "object";
export type AnchorImportance = "high" | "medium" | "low";
export type AnchorMode = "creative" | "describe";

/**
 * The gross body layout of a character. Mechanically load-bearing rather than
 * descriptive: it selects which turnaround angles a reference sheet asks for
 * (front/three-quarter/side/back only makes sense for something that stands)
 * and whether the subject can stand on the height-comparison ground line.
 * `species` prose lives in the description; this is only the shape.
 */
export type BodyPlan = "bipedal" | "quadruped" | "avian" | "aquatic" | "amorphous";

export const BODY_PLANS: BodyPlan[] = [
  "bipedal",
  "quadruped",
  "avian",
  "aquatic",
  "amorphous",
];

/**
 * Body plans that stand upright on a ground line, so heights are comparable.
 * Birds are included — most picture-book birds (owls, ducks, penguins) are
 * drawn perched/standing, not mid-flight, so they compare the same way a
 * biped or quadruped does. Only `aquatic` (swims, no ground contact) and
 * `amorphous` (no defined footing) are excluded.
 */
export function standsOnGround(plan: BodyPlan | undefined): boolean {
  return plan === undefined || plan === "bipedal" || plan === "quadruped" || plan === "avian";
}

/** A stored, generated anchor image (the payload of a version-tree node). */
export interface AnchorImage {
  blobId: string;
  mimeType: string;
  /**
   * Related anchors (e.g. an object contained in this place, or a relative this
   * subject must resemble) whose images/text were used when generating this
   * image — so we can warn when one of those related anchors later changes.
   */
  references?: ReferenceUse[];
  /**
   * Square close-up crop of this sheet (head-and-shoulders for characters),
   * derived from the sheet's own pixels — never generated — so it can never
   * depict a different-looking subject than the reference it summarizes.
   * Absent on sheets rendered before thumbnails existed, or when the crop
   * failed; callers fall back to the full sheet.
   */
  thumbBlobId?: string;
  /**
   * Layout the sheet was rendered against, so a crop knows where each view
   * sits. Absent on sheets predating the fixed-grid contract.
   */
  layout?: AnchorSheetLayout;
}

/**
 * The grid a reference sheet was generated against. Stored per image (not per
 * anchor) because it is a property of those specific pixels: an older version
 * in the tree may have used a different layout, and reverting to it must still
 * crop correctly.
 */
export interface AnchorSheetLayout {
  columns: number;
  rows: number;
  /** Canvas the sheet was requested at, so a cell's aspect ratio is derivable. */
  width: number;
  height: number;
  /** Cell index (reading order) holding the head close-up, when the grid has one. */
  headCell?: number;
  /**
   * Cell index (reading order) holding the canonical whole-subject view — the
   * one that best identifies it standing on its own. Front for a biped, side
   * profile for a quadruped or fish. Used for the height lineup.
   */
  bodyCell: number;
}

/** Records which reference (anchor) version was used to render an illustration. */
export interface ReferenceUse {
  anchorId: string;
  /**
   * The anchor version-tree cursor id at generation time. Undefined when the
   * anchor had no generated image yet (described by text only) — still tracked
   * so the page goes stale once an image is created for it.
   */
  versionId?: string;
  /**
   * Signature of the anchor's descriptive fields (description / guidance / mode)
   * at generation time, so the page also goes stale when those text inputs
   * change even if the image version id did not.
   */
  signature?: string;
  /**
   * True when the anchor was used as TEXT context only (e.g. a "related"
   * anchor whose image is never passed to the model). Staleness then ignores
   * image-version changes and only tracks the text signature.
   */
  textOnly?: boolean;
}

/**
 * A subject actually depicted in a rendered illustration, bound to its anchor at
 * generation time. Captured by a post-render vision "binding pass" (which knows
 * ground truth — which references were fed in), so the anchor→region mapping is
 * authoritative and doesn't rely on fuzzy re-matching of descriptions later.
 * Enables reliable in-place edits/removals and duplicate detection.
 */
export interface DepictedSubject {
  /** The anchor this region depicts, or null for a detected non-anchor subject. */
  anchorId: string | null;
  /** Normalized (0..1, top-left origin) bounding box within THIS rendered image. */
  box: { x: number; y: number; width: number; height: number };
  /** Short disambiguating description captured at generation time. */
  brief?: string;
  /** Localizer confidence (0..1); absent when not reported. */
  confidence?: number;
}

/** Per-page text strategy. */
export type TextMode = "in-image" | "overlay";

/** The exact cover text baked into a typographic cover image. */
export interface BakedCoverText {
  title?: string;
  subtitle?: string;
  author?: string;
}

/** A generated page/cover illustration with provenance for staleness checks. */
export interface IllustrationImage extends AnchorImage {
  /** Reference versions used, so we can detect when a reference changed. */
  references?: ReferenceUse[];
  /** Text strategy this image was generated for. */
  textMode?: TextMode;
  /**
   * Cover-only: the title/subtitle/author actually rendered INTO this image
   * (when `textMode === "in-image"`). Lets the studio warn when the book's
   * title/subtitle/author later drift from what the artwork shows.
   */
  bakedText?: BakedCoverText;
  /** The prompt used (for inspection / reuse). */
  prompt?: string;
  /**
   * Subjects bound to regions in this specific rendered image (from the
   * post-render binding pass). Keyed spatially to THIS blob, so it travels with
   * the version and stays correct when the user reverts to it.
   */
  depicted?: DepictedSubject[];
  /**
   * The layout and composition mode this artwork was generated for. The prompt
   * and the canvas shape both depend on them, so a page whose layout changed
   * afterwards has art that no longer matches the page it sits on.
   */
  layoutId?: string;
  compositionMode?: CompositionMode;
}

export interface Anchor {
  id: string;
  name: string;
  /**
   * Prior name(s) this anchor has been renamed from. Lets a fresh story
   * re-analysis — which only knows the name as it appears in the story text —
   * still match this anchor by an old name and preserve the rename instead of
   * minting a duplicate and orphaning this one's art/relationships.
   */
  aliasNames?: string[];
  type: AnchorType;
  /** Description derived from the story analysis (editable). */
  description: string;
  importance: AnchorImportance;
  /**
   * Character-only: gross body layout, inferred by the story analysis. Selects
   * the turnaround angles the reference sheet asks for. Undefined on anchors
   * created before this existed — treated as `bipedal`.
   */
  bodyPlan?: BodyPlan;
  /**
   * Character-only: approximate real-world height in centimetres, inferred at
   * analysis time and adjustable by the user through the cast lineup. Drives
   * relative sizing in page illustrations; never shown as a number in the UI.
   * Undefined when the story gives nothing to infer from — the analysis leaves
   * it blank rather than guessing.
   */
  heightCm?: number;
  /**
   * True once the user has adjusted `heightCm` in the cast lineup. Re-analysis
   * refreshes story-derived heights but must not silently undo a size the user
   * chose deliberately.
   */
  heightUserSet?: boolean;
  /** Whether the system creatively designs it, or the user describes it. */
  mode: AnchorMode;
  /** Optional user creative direction for this specific anchor. */
  userGuidance?: string;
  /** Whether to generate an anchor image for this subject. */
  include: boolean;
  /**
   * Anchors physically contained within this one (e.g. a bed inside a room).
   * Only meaningful for place/object anchors. Stored by anchor id — these are
   * drawn into this anchor's sheet and must match their own reference exactly.
   * Undefined/empty means "no contained anchors" (no implicit name matching).
   */
  containedIds?: string[];
  /**
   * Anchors this one relates to / resembles for context only (e.g. a sibling to
   * match traits with). Stored by anchor id — fed in as context but NOT drawn
   * as separate figures. Undefined/empty means "no relations".
   */
  relatedIds?: string[];
  /**
   * Optional free-text note per `relatedIds` entry describing HOW the two
   * relate (e.g. "has lighter hair than him"), keyed by the other anchor's id.
   * Fed into the prompt alongside the related anchor's own description. A
   * separate map (not a richer `related` array) so existing `relatedIds`
   * data needs no migration.
   */
  relatedNotes?: Record<string, string>;
  /** Image version history (undefined until first generation). */
  versions?: VersionTree<AnchorImage>;
}

/**
 * A relationship the story analysis believes exists between two anchors.
 *
 * Held as a *suggestion* rather than written straight onto the anchors: a
 * relation drives generation ordering and staleness cascades, so a wrong edge
 * applied silently causes confusing regenerations later. The user accepts or
 * dismisses it, and either way the suggestion is consumed.
 */
export interface AnchorRelationSuggestion {
  fromId: string;
  toId: string;
  kind: "contains" | "relates";
  /** For "relates": the predicate, e.g. "is the father of". */
  note?: string;
}

export interface StoryAnalysis {
  summary: string;
  generatedAt: number;
  /** Model used, for display. */
  model?: string;
  /**
   * Story text that produced this analysis. Used to offer "Re-read story" only
   * when the user has edited the story since the cast was last derived.
   */
  sourceStoryText?: string;
  /** Pending relationship suggestions, consumed as the user accepts/dismisses. */
  relations?: AnchorRelationSuggestion[];
}

/** One unit of the book: a single page or a double-page spread. */
export type SpreadKind = "single" | "spread";

export interface ScreenplaySpread {
  id: string;
  kind: SpreadKind;
  /** Narrative text shown on this page/spread. */
  text: string;
  /** Description of the illustration for image generation. */
  illustration: string;
  /** Layout decision + where the text sits relative to the art. */
  layoutNote: string;
  /** Anchors that appear here (by anchor id). */
  anchorIds: string[];
  /**
   * Anchor names captured alongside `anchorIds` (same order) when the reference
   * was created, so a stale id can self-heal by name if anchor ids ever drift.
   */
  anchorNames?: string[];
  /** True for blank filler pages inserted to keep spreads printable. */
  placeholder?: boolean;
  /**
   * A user-added page with no AI art — a blank canvas the user designs purely
   * with background color, patterns, text and shapes. Skips the generation UI.
   */
  blankCanvas?: boolean;
  /**
   * How text is handled on this page: baked into the art ("in-image") or laid
   * out by the app as an editable overlay ("overlay", the default).
   */
  textMode?: TextMode;
  /**
   * Cover-only: when true, the title/subtitle/author below are rendered INTO
   * the generated artwork (typographic cover) instead of being laid out as
   * editable overlay text boxes. Baked text forces the high-quality tier.
   */
  bakeText?: boolean;
  /** Cover-only: the exact title to bake into the art. */
  coverTitle?: string;
  /** Cover-only: the exact subtitle to bake into the art (optional). */
  coverSubtitle?: string;
  /** Cover-only: the author line to bake into the art (optional). */
  coverAuthor?: string;
}

/** Cover / spine art direction drafted alongside the screenplay. */
export interface CoverSpec {
  /** Book title (front cover) or blurb (back cover). */
  title?: string;
  subtitle?: string;
  /** Art brief for the cover illustration. */
  illustration: string;
  /** Anchors featured on the cover (by anchor id). */
  anchorIds: string[];
  /** Anchor names captured alongside `anchorIds` (same order) for self-healing. */
  anchorNames?: string[];
  /**
   * When true, the title (and optional subtitle/author) are rendered directly
   * into the cover artwork by the image model, rather than laid out as editable
   * overlay text. Requires — and forces — the high-quality image tier.
   */
  bakeText?: boolean;
  /** Author line, optionally baked into the cover artwork. */
  author?: string;
}

export interface SpineSpec {
  text?: string;
}

/** Special illustration keys used for covers/spine in `Project.illustrations`. */
export const COVER_FRONT_ID = "cover-front";
export const COVER_BACK_ID = "cover-back";
export const SPINE_ID = "spine";

export interface ScreenplayDoc {
  /** Overall art-direction / pacing notes. */
  notes: string;
  spreads: ScreenplaySpread[];
  frontCover?: CoverSpec;
  backCover?: CoverSpec;
  spine?: SpineSpec;
}

export interface Project {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Monotonic persisted-generation counter for optimistic concurrency. Each
   * successful save increments it (compare-and-set on the stored value), so a
   * second writer (another tab/device) that edited from an older generation is
   * detected as a conflict instead of silently clobbering the newer state.
   * Optional for back-compat with projects persisted before it existed (treated
   * as 0).
   */
  rev?: number;
  stage: ProjectStage;
  config: BookConfig;
  /** Highest stage the user has unlocked, so they can navigate back/forward. */
  furthestStage: ProjectStage;
  /** Phase 2: story analysis result. */
  analysis?: StoryAnalysis;
  /** Phase 2: anchors detected from the story (+ generated images). */
  anchors?: Anchor[];
  /** Phase 3: page-by-page screenplay, versioned for iterate/branch/revert. */
  screenplay?: VersionTree<ScreenplayDoc>;
  /** Phase 4: generated illustrations keyed by screenplay spread id (and cover ids). */
  illustrations?: Record<string, VersionTree<IllustrationImage>>;
  /** Final Design: app-owned overlay/typography/pattern layer. */
  design?: BookDesign;
}

export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  stage: ProjectStage;
}

export function summarize(p: Project): ProjectSummary {
  return {
    id: p.id,
    title: p.title,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    stage: p.stage,
  };
}

/** Re-exported for convenience by consumers needing the age range object. */
export type { AgeRange, BookSize, GraphicsDensity, SpreadUsage, TextHandling, TextPlacement };
export type { ReadingModeId } from "./config/ageWritingCatalog";

/** Re-export the Final Design layer types for one-stop importing. */
export type {
  BookDesign,
  PageDesign,
  PageBackground,
  ShapeElement,
  ShapeKind,
  ImageElement,
  ElementEffects,
  ShadowTarget,
  TextBox,
  TextParagraph,
  TextSpan,
  PatternConfig,
  NormRect,
  ColorValue,
  HAlign,
  VAlign,
} from "./design";
export { DESIGN_VERSION, resolveIllustrationSlotId } from "./design";
