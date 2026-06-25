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
import type { VersionTree } from "./versioning";
import type { BookDesign } from "./design";

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
  /** Layout template id (or "auto"). */
  layoutId: string;
}

export function createDefaultConfig(): BookConfig {
  return {
    storyText: "",
    textModel: null,
    imageModel: null,
    artStyle: { presetId: "watercolor" },
    ageRangeId: "3-5",
    // Default to the square hardcover product (see BOOK_PRODUCTS / Lulu catalog).
    productSku: "0850X0850.FC.STD.CW.080CW444.GXX",
    bookSize: "square",
    graphicsDensity: "one-per-page",
    spreadUsage: "single",
    textHandling: "creative",
    textPlacement: "separate",
    layoutId: "auto",
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
}

/** Per-page text strategy. */
export type TextMode = "in-image" | "overlay";

/** A generated page/cover illustration with provenance for staleness checks. */
export interface IllustrationImage extends AnchorImage {
  /** Reference versions used, so we can detect when a reference changed. */
  references?: ReferenceUse[];
  /** Text strategy this image was generated for. */
  textMode?: TextMode;
  /** The prompt used (for inspection / reuse). */
  prompt?: string;
}

export interface Anchor {
  id: string;
  name: string;
  type: AnchorType;
  /** Description derived from the story analysis (editable). */
  description: string;
  importance: AnchorImportance;
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
  /** Image version history (undefined until first generation). */
  versions?: VersionTree<AnchorImage>;
}

export interface StoryAnalysis {
  summary: string;
  generatedAt: number;
  /** Model used, for display. */
  model?: string;
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

/** Re-export the Final Design layer types for one-stop importing. */
export type {
  BookDesign,
  PageDesign,
  PageBackground,
  ShapeElement,
  ShapeKind,
  ImageElement,
  ElementEffects,
  TextBox,
  TextParagraph,
  TextSpan,
  PatternConfig,
  NormRect,
  ColorValue,
  HAlign,
  VAlign,
} from "./design";
