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
import type { ImageTier } from "./config/modelConfig";
import type { ReadingModeId } from "./config/ageWritingCatalog";
import type { StoryMode } from "./config/storyCraftCatalog";
import {
  DEFAULT_BOOK_LANGUAGE_ID,
  type BookLanguageId,
} from "./config/bookLanguages";
import type { VersionTree } from "./versioning";
import type { BookDesign } from "./design";
import { DEFAULT_BOOK_LAYOUT_ID, type CompositionMode } from "./book/layouts";

export type { ProviderId, Modality, ModelTier } from "./config/options";
export type { ImageTier } from "./config/modelConfig";

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
  /** Text only: the bound action's reasoning, temperature, output cap and timeout. */
  params?: import("./config/modelConfig").TextCallParams;
}

/** Immutable admin asset used only to carry a preset's rendering style into generation. */
export interface GenerationStyleReference {
  imageUrl: string;
  storagePath: string;
  mimeType: string;
  updatedAt: number;
}

export interface ArtStyleSelection {
  /** Stable id from the admin-managed art-style catalog, or null when custom. */
  presetId: string | null;
  /** Optional free-text creative additions / overrides. */
  customDescription?: string;
  /**
   * How the look was chosen. `derived` means it was extracted from uploaded
   * character artwork (not a preset and not typed by the author). Absent on
   * older projects — treat as a preset.
   */
  origin?: "preset" | "derived";
  /**
   * When looks conflicted, the character whose artwork won. Matched by name
   * so it survives story re-analysis id churn. Absent when every drawing
   * already shared one look.
   */
  derivedFromName?: string;
  /**
   * Characters whose drawings established the book look. Those keep their
   * original rendering on the first sheet; anyone attached later is redrawn
   * in this look. Names, not ids, so re-analysis does not drop the stamp.
   */
  derivedFromNames?: string[];
  /**
   * The reader-supplied artwork that defines this look. Unlike the temporary
   * pre-cast staging field, this survives character assignment and is sent to
   * image generation as a style-only reference for every character.
   */
  referenceArt?: SourceArtRef[];
  /**
   * The exact catalog exemplar selected with a preset. It is snapshotted onto
   * the book so later admin changes cannot mix two style versions in one book.
   */
  generationReference?: GenerationStyleReference;
  /**
   * Pointer to the backend-owned custom style this look was saved as (see
   * `core/config/customArtStyles.ts`). When present the backend, not the
   * browser, supplies the wording and pictures, and `customDescription` is only
   * a readable copy of the revision's text.
   */
  customStyle?: import("./config/customArtStyles").CustomStyleRef;
}

/**
 * Everything one generated picture was made from, kept on the picture itself
 * so a look, a model or a prompt can be traced and reused later. Optional
 * throughout: pictures drawn before this existed carry none of it.
 */
export interface ImageRenderRecord {
  /** The look it was drawn in, as a stable id plus the full key used for staleness. */
  style?: {
    presetId: string | null;
    /** Custom style id, when the look is a saved custom style. */
    customStyleId?: string;
    customStyleRevision?: number;
    origin?: "preset" | "derived";
    /** `artStyleKey` of the selection at the time. */
    key: string;
  };
  /** The Spark action it was drawn as (portrait, anchorImage, pageIllustration, ...). */
  action?: string;
  /** The canvas requested from the model, "WxH". */
  outputSize?: string;
  /** What the surface asked for and what the model applied. */
  generation?: import("./config/imageGeneration").ResolvedImageGenerationOptions;
  /** The pictures sent along with the prompt, in order. Never includes private photos' ids. */
  inputReferences?: ImageInputReference[];
  /** The exact prompt, for pictures whose version node has no prompt of its own. */
  prompt?: string;
  /** Server clock when the render finished. */
  renderedAt?: number;
}

export interface ImageInputReference {
  role: string;
  label?: string;
  /** A user blob. Absent for one-use likeness photos and for pictures that were not stored. */
  blobId?: string;
  /** An admin asset path (the catalog style exemplar). */
  storagePath?: string;
}

/** Existing illustrated character art kept as identity (and often style) source. */
export interface SourceArtRef {
  blobId: string;
  mimeType: string;
  createdAt: number;
  /**
   * Absent means reader-supplied artwork. Portrait references are derived
   * infrastructure and may be replaced automatically when the portrait changes.
   */
  origin?: "portrait";
}

/** Cap on extra pictures per character (canonical design is the first). */
export const SOURCE_ART_MAX = 3;

/** Bump whenever the just-in-time likeness permission copy materially changes. */
export const LIKENESS_CONSENT_VERSION = "2026-09-06";

/** Photos of one person a portrait may draw from. */
export const LIKENESS_PHOTOS_MAX = 3;

/**
 * Short-lived pointer to a privately stored likeness photo.
 *
 * The source bytes are never embedded in a project document. They live in the
 * backend-only likeness lane, are used for the first character sheet, and are
 * deleted immediately after that render succeeds (or by the hard expiry).
 */
export interface LikenessPhotoRef {
  createdAt: number;
  expiresAt: number;
  /** Version of the just-in-time permission statement accepted on upload. */
  consentVersion: string;
}

/** What a character is. Decides what the chat asks and how they are drawn (`core/story/castKinds.ts`). */
export type CastKind = "person" | "animal" | "toy" | "creature";

/** One named person or creature the story is about (co-write mode). */
export interface StoryCastMember {
  id: string;
  name: string;
  /** Absent on older books: read through `castKindOf`, which infers it. */
  kind?: CastKind;
  /** What kind of animal, toy or creature: "golden retriever", "teddy bear", "dragon". */
  species?: string;
  /** Who they are: "the hero", "her twin brother", "the neighbour's dog". */
  role?: string;
  /** Age in years, when the author knows it — keeps the cast believable. */
  age?: number;
  /**
   * Age in months when the author entered months (infant bands). Preferred for
   * audience matching; `age` stays the whole-year value for character art.
   */
  ageMonths?: number;
  /**
   * "Almost 3": `age` holds the years completed (2) and this the age the parent
   * said the child is about to reach (3). Only read while it is still one more
   * than the stored age (`turningOf`); never used to draw anyone.
   */
  turning?: number;
  /**
   * A transparent drawing-only fallback when the manuscript does not state an
   * age. It shapes portraits and reference sheets, but never silently changes
   * the target reading audience or pretends to be a fact supplied by the family.
   */
  visualAge?: {
    years: number;
    source: "story" | "suggested";
  };
  /** Anything else worth knowing: "loves dinosaurs", "always loses a shoe". */
  note?: string;
  /** Optional one-use photo for carrying this person's likeness into Cast. */
  likenessPhoto?: LikenessPhotoRef;
  /**
   * More one-use photos of the same person for the Chat studio portrait, up to
   * `LIKENESS_PHOTOS_MAX - 1`. Only meaningful beside `likenessPhoto`, and
   * cleared with it.
   */
  moreLikenessPhotos?: LikenessPhotoRef[];
  /**
   * Existing character drawings. First image is the canonical design; extras
   * help identity and style. Mutually exclusive with `likenessPhoto`.
   */
  sourceArt?: SourceArtRef[];
  /**
   * Appearance read from `sourceArt`. Ground truth for species, body and
   * clothes so analysis cannot replace a drawn animal with a human child.
   */
  lookFromArt?: string;
  /**
   * Chat studio: where this person's look comes from. Absent means use the
   * story's visual description when analysis has one, and otherwise invent
   * from the name.
   */
  lookSource?: LookSource;
  /**
   * How they look. The family's own words, or the visual description copied
   * from story analysis when they have not described this person themselves.
   */
  appearance?: string;
  /**
   * The current `appearance` was copied from story analysis and may be
   * replaced when analysis runs again. Cleared once the family edits it.
   */
  appearanceFromStory?: boolean;
  /**
   * Gross body layout from story analysis. A frog or other non-human body
   * keeps the portrait from being drawn as a person.
   */
  bodyPlan?: BodyPlan;
  /** Chat studio: a change asked for on the portrait itself ("make the hair darker"). */
  portraitNote?: string;
}

/** Where a person's portrait takes its likeness from. */
export type LookSource = "photo" | "drawing" | "describe" | "invent";

export type CastRelationType = "twins" | "siblings" | "friends" | "family" | "owner" | "other";

/**
 * Something the family said about how characters belong together. Reaches the
 * story, the portraits and the reference sheets, so it is never lost between
 * the chat and the book.
 */
export interface CastRelation {
  /** Cast member ids, two or more. For `owner`, the owner comes first. */
  ids: string[];
  type: CastRelationType;
  /** Their words, when the type alone doesn't say it: "best friends from kindergarten". */
  label?: string;
  /** Twins only: whether they are drawn alike. Absent until the family says. */
  lookAlike?: "identical" | "different";
}

/**
 * What a portrait was drawn from. A result commits only while every field still
 * matches the live book, so a late render cannot flash an outdated face.
 */
export interface PortraitInputs {
  subjectId: string;
  /** Age, role and kind of the person when the job was queued. Not the name: a rename changes no look. */
  subjectSignature: string;
  /** `artStyleKey` of the saved style. */
  styleKey: string;
  /** The photo, drawing or description that was the likeness source. */
  sourceKey: string;
}

export interface PortraitImage {
  blobId: string;
  mimeType: string;
  inputs: PortraitInputs;
  /**
   * How the person was described when this picture was drawn, so choosing it
   * again from the history puts that description back with it. Empty text means
   * "nothing". Absent on pictures drawn before history could be restored.
   */
  look?: { portraitNote: string; appearance: string };
  createdAt: number;
  imageTier?: ImageTier;
  imageModel?: ModelSelection;
  /** Everything this portrait was drawn from, for tracing and reuse. */
  render?: ImageRenderRecord;
}

/** What switching from an artwork-derived style to a preset took off the book, so it can be put back. */
export interface RetiredArtwork {
  cast: { id: string; sourceArt: SourceArtRef[]; lookSource?: LookSource; lookFromArt?: string }[];
  anchors: { id: string; sourceArt: SourceArtRef[]; lookFromArt?: string }[];
  staged?: SourceArtRef[];
}

/** How a Chat studio book was started. Switchable until the pages start. */
export type GuideEntry = "guided" | "own";

/** The reader's answer to the hardcover check. Absent means no decision was needed or asked. */
export type HardcoverDecision = "spread" | "keep" | "thin";

/**
 * Chat studio authoring state. Everything here is optional and additive: a book
 * made in Steps has none of it and still opens in Chat at its current state.
 */
export interface StudioAuthoringState {
  version: 1;
  entry?: GuideEntry;
  /** When the one-time Sparks information row was shown for this book. */
  sparksNoticeAt?: number;
  /** Portrait version trees, keyed by story cast member id. */
  portraits?: Record<string, VersionTree<PortraitImage>>;
  /**
   * Character artwork uploaded before manuscript extraction knows who it
   * belongs to. It can define the whole book's style immediately, then be
   * assigned to a cast plate once names arrive.
   */
  styleSourceArt?: SourceArtRef[];
  /** The reader chose to use the staged drawing only as a whole-book style reference. */
  styleSourceOnly?: boolean;
  /**
   * People the reader said share an age (twins, "both", "the same age").
   * Each inner list is their names. An age given for one is copied to the others.
   */
  sameAge?: string[][];
  /** Facts whose derived value the guide has said once (confirm-once). */
  saidFacts?: string[];
  /** Optional facts the reader skipped. Never asked again. */
  skippedFacts?: string[];
  /** Optional facts the guide actually asked. Only these hold the story back. */
  askedFacts?: string[];
  /** Asked facts the reader replied to (any reply answers an optional fact). */
  answeredFacts?: string[];
  /** Story details the guide asked about before writing. Never asked twice. */
  briefAsked?: string[];
  /** The story detail the guide just asked about, until the next reply. */
  briefOpen?: string;
  /** When the reader said to write the story (the button, "go ahead", "surprise me"). */
  briefStartAt?: number;
  /**
   * Chat skills: per-person follow-ups the guide asked or the reader skipped,
   * as `<personId>:<field>` (`p1:role`, `p1:role:skipped`). Asked once, never again.
   */
  personAsks?: string[];
  /**
   * Chat studio: people (cast ids) whose look source the reader settled in the
   * chat, including "let the story decide". Asked once per person.
   */
  looksDecided?: string[];
  /** The person and option the looks card opens on, as `<castId>:<source>`, after the parent asked in words. */
  lookFocus?: string;
  /**
   * The look the book's portraits were drawn in, kept when the reader changed
   * the style so "keep the old look" can take it back for free. Only ever read
   * through `styleRevert`, which checks that it still applies.
   */
  styleBefore?: ArtStyleSelection;
  /**
   * The artwork that was the book's style when the reader switched to a preset,
   * kept with `styleBefore` so "keep the old look" puts the drawings back too.
   * Only restored together with a derived `styleBefore`; see `withStyleReverted`.
   */
  retiredArtwork?: RetiredArtwork;
  /**
   * Chat skills: names the reader removed from the book. Story analysis and
   * manuscript extraction never add these back; adding the person again clears it.
   */
  removedNames?: string[];
  /** The chat language, as a book-language code. Changing it never restarts the book. */
  chatLocale?: string;
  /** Own words: the reader asked the guide for something, so the composer shows. */
  ownComposer?: boolean;
  /**
   * Own words: when the reader said the story is done ("My story is ready", or
   * pasting a finished story). Nothing is read, asked or drawn before it, so
   * the guide never interrupts someone still writing. Later edits keep it.
   */
  manuscriptReadyAt?: number;
  /** Page-plan rerun job whose result replaces the current plan when it lands. */
  planRequestedFor?: string;
  /** The analysis and page target the current page plan was asked for. */
  planBasis?: string;
  /**
   * When notes for the pictures arrived after the page plan was asked for. Part
   * of the plan's basis, so the plan is made again with them.
   */
  planNotesAt?: number;
  /**
   * The story (as a stamp of its words) the plan has already sent back to be
   * read again for the things it found missing. Once per story, so a plan that
   * keeps finding one can never loop.
   */
  unlistedReadFor?: string;
  /**
   * Decisions the reader explicitly reviewed in Chat. BookConfig always has
   * defaults, so these receipts distinguish a real choice from an untouched
   * default without creating a second source of truth for the value itself.
   */
  bookSetup?: {
    formatConfirmedAt?: number;
    layoutConfirmedAt?: number;
  };
  /** Whether the book-language line ("I'll write the story in English") was said. */
  languageSaid?: boolean;
  /** The latest story draft run, so a newer detail supersedes an older run. */
  storyRun?: {
    signature: string;
    startedAt: number;
    status: "running" | "failed" | "done";
    error?: string;
    /** The run is the written story being translated, not a draft: nothing is ever drafted over it. */
    translating?: boolean;
  };
  hardcover?: HardcoverDecision;
  /**
   * The cover's words as the reader chose them. An empty subtitle or author
   * means "none". Typing never redraws a picture; the words are painted into
   * the cover when the book is drawn.
   */
  cover?: {
    subtitle?: string;
    author?: string;
    titleEdited?: boolean;
    /** When the reader settled the cover's words on the cover card. */
    confirmedAt?: number;
    /** Set when the book is drawn: the front cover is painted with its words. */
    painted?: boolean;
    /** Subtitles written with the story, offered on the cover card. */
    subtitleIdeas?: string[];
    /** The title lines were read off the top of the reader's own manuscript. */
    fromStory?: boolean;
  };
  /** Own-words extraction, keyed to the manuscript it read. */
  extraction?: {
    storyHash: string;
    at: number;
    names: string[];
    /** Names that need a correction before anything is drawn. */
    unresolved: string[];
  };
  /**
   * Draw the book: one confirmed batch across references, covers and pages.
   * Persisted so any open client resumes the next phase after a reload.
   */
  drawBook?: {
    quoteId?: string;
    startedAt: number;
    phase: "cast" | "pages" | "done";
    /** The server job drawing the whole book (absent on runs started before it existed). */
    jobId?: string;
    /** Why the job was refused before anything was drawn, for the retry well. */
    error?: string;
  };
  /** When the pages started. Locks the look, cast, story, cover text, shape and count. */
  lockedAt?: number;
  /**
   * A paid action waiting on an account or a Sparks top-up. `confirmed` means
   * the reader already tapped it: an unexpired quote continues on return.
   */
  pendingAction?: {
    purpose: "portraits" | "book" | "redraw";
    quoteId: string;
    confirmed: boolean;
    at: number;
  };
  /** When the reader last had this book open in Chat. Drives the reopen summary. */
  seenAt?: number;
  /** Values replaced when two devices changed the same thing, newest first. */
  replaced?: { at: number; fields: Record<string, unknown> }[];
}

/**
 * What the reader told us before the story existed. Persisted alongside the
 * text (rather than living in component state) so the draft is reproducible:
 * regenerating, switching age band, or reopening the project a week later all
 * still know how this story came to be.
 */
export interface StoryBrief {
  mode: StoryMode;
  /** Catalog id from the age band's theme list, or null when custom/none. */
  themeId?: string | null;
  customTheme?: string;
  /** Catalog id from the age band's stylistic-device list. */
  deviceId?: string | null;
  /** Multiple catalog ids from the age band's stylistic-device list. */
  deviceIds?: string[];
  customDevice?: string;
  /** Catalog id from the age band's setting list (co-write only). */
  settingId?: string | null;
  customSetting?: string;
  /** Guided mode: one or more names the story is built around. */
  heroNames?: string[];
  /** Co-write mode: everyone who appears, with their relationships. */
  cast?: StoryCastMember[];
  /** How characters belong together ("Myla and Shilo are twins"). By cast id. */
  relations?: CastRelation[];
  /** Co-write mode: what's happening — a birthday, a first day, a move. */
  occasion?: string;
  /** Co-write mode: when it happens ("the morning of her 6th birthday"). */
  when?: string;
  /** Co-write mode: where it happens, in the author's own words. */
  where?: string;
  /** Co-write mode: anything else the author insists must be in the story. */
  mustInclude?: string;
  /**
   * Own words: what the pictures should show that the text doesn't say ("Maya
   * has red curls", "it's winter"). Read by the page plan; never printed.
   */
  pictureNotes?: string;
  /**
   * Chat story details without a field of their own (bedtime, mood, things to
   * leave out, …), by detail id. See `core/guide/storyDetails.ts`.
   */
  details?: Record<string, StoryDetailValue>;
  /** When the current `storyText` was generated from this brief. */
  generatedAt?: number;
  /**
   * Signature of the brief that produced the current `storyText` (see
   * `storyBriefSignature`). Lets the UI tell "you changed the brief since this
   * draft" from "this draft is current" without diffing by hand.
   */
  generatedSignature?: string;
  /** Age band the current draft was written for, to detect an audience change. */
  generatedForAge?: string;
  /** Content locale the current draft was written for. */
  generatedForLocale?: BookLanguageId;
}

/** One story detail: catalog ids, the reader's own words, or a yes. */
export interface StoryDetailValue {
  ids?: string[];
  text?: string;
  on?: boolean;
}

/** Everything captured by the setup wizard. */
export interface BookConfig {
  storyText: string;
  /** How the story was written, and the inputs that produced it. */
  storyBrief?: StoryBrief;
  /**
   * Language and regional writing convention for the book's reader-facing
   * content. Optional only for backwards compatibility with older projects.
   */
  contentLocale?: BookLanguageId;
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
  /**
   * Chat studio: the page count the page plan should aim at, from the
   * deterministic hardcover check (`core/guide/hardcover.ts`). Absent means the
   * plan picks its own length, which is what Steps always does.
   */
  pageTarget?: { pages: number; wordsPerPage: number; case: "natural" | "spread" | "thin" };
  artStyle: ArtStyleSelection;
  ageRangeId: string;
  /**
   * How `ageRangeId` was chosen. `linked` follows the first named character's
   * age against the live admin bands. `custom` is an explicit audience pick and
   * is not overwritten when that character's age changes. Absent on older
   * projects (treated as custom once a story exists).
   */
  audienceFromCast?: "linked" | "custom";
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
   * Whether the reader has reached the Pages step. Set on arrival, because the
   * physical setup (size, layout) now ships with working defaults and no longer
   * has to be answered before the pages can be seen; it is edited from the Setup
   * panel instead, whenever the reader wants to.
   *
   * Kept as a flag rather than dropped: Review & Order still opens only after the
   * pages exist, and this is what records that. Optional so older projects — the
   * ones that stopped at the old setup gate — are simply marked on their next
   * visit.
   */
  designReady?: boolean;
  /**
   * Whether the reader has confirmed the art style in Design · Cast. New projects
   * set this to `false` when leaving Story so Cast opens on the style gate.
   * `undefined` = legacy project (treat as already confirmed).
   */
  styleReady?: boolean;
  /**
   * Whether the reader has explicitly completed the Characters & places
   * checkpoint. This is separate from derived image counts so an empty analysis
   * cannot silently skip Cast. Legacy projects with complete cast artwork are
   * inferred as ready by the workflow progress helper.
   */
  castReady?: boolean;
  /**
   * An in-flight art-style transfer. Persisted (rather than held in component
   * state) so the cascade survives a reload: cast sheets are re-rendered first,
   * then the pages that use them. Cleared once every listed unit carries the
   * target style key.
   */
  styleRenew?: StyleRenewPlan;
}

/** A running "move all existing art to the new style" operation. */
export interface StyleRenewPlan {
  /** Target style stamp (see `artStyleKey`) every listed unit must reach. */
  styleKey: string;
  /** Which half of the cascade is running — cast sheets, then page artwork. */
  phase: "cast" | "pages";
  /** Anchor ids that had artwork when the transfer started. */
  castIds: string[];
  /** Illustration-unit ids (spreads + covers) that had artwork at that point. */
  pageIds: string[];
  startedAt: number;
}

export function createDefaultConfig(initialLocale?: BookLanguageId): BookConfig {
  return {
    storyText: "",
    contentLocale: initialLocale ?? DEFAULT_BOOK_LANGUAGE_ID,
    textModel: null,
    imageModel: null,
    artStyle: { presetId: "watercolor" },
    ageRangeId: "4-5",
    audienceFromCast: "linked",
    readingModeId: null,
    // Default to the square hardcover product (see BOOK_PRODUCTS / Lulu catalog).
    productSku: "0850X0850FCPRECW080CW444GXX",
    bookSize: "square",
    // Default overlay layout: words on the picture along the outer edge. The
    // reader can pick a split layout in Design setup.
    graphicsDensity: "one-per-page",
    spreadUsage: "single",
    textHandling: "creative",
    textPlacement: "separate",
    layoutId: DEFAULT_BOOK_LAYOUT_ID,
  };
}

/**
 * The high-level mode a project is in.
 *   - `setup`  — first-run story configuration (reader + text), before the studio.
 *   - `studio` — the single unified workspace (Design cast/pages, Order, …).
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
  /**
   * The art style these pixels were drawn in (see `artStyleKey`). Lets a style
   * change tell exactly which artwork still needs re-rendering, and makes the
   * transfer resumable/idempotent. Absent on images predating the stamp.
   */
  artStyleKey?: string;
  /** Internal tier used to generate these pixels. Kept for provenance and cost records. */
  imageTier?: ImageTier;
  /**
   * Concrete image model that produced these pixels (provider + id). Audit /
   * debugging — the tier is the stable UX signal when admin rebinds slots.
   */
  imageModel?: ModelSelection;
  /** Everything this picture was drawn from, for tracing and reuse. */
  render?: ImageRenderRecord;
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
  /** Output preferences requested by the surface and applied by the model. */
  generation?: import("./config/imageGeneration").ResolvedImageGenerationOptions;
  /**
   * Cover-only: the title/subtitle/author actually rendered INTO this image
   * (when `textMode === "in-image"`). Lets the studio warn when the book's
   * title/subtitle/author later drift from what the artwork shows.
   */
  bakedText?: BakedCoverText;
  /**
   * Cover-only: what the lettering check read. `passed`: every word spelled
   * right, inside the safe area. `accepted`: every word spelled right, but a
   * line sat a little close to the edge or a stray mark was painted, and no
   * further painting did better (see `problems`). `fellBack`: no painting came
   * out right, so the cover was drawn without words and they are set as text
   * on top (`textMode` is then `overlay`). `unchecked`: the check could not
   * run. `failed` is only found on covers drawn before this: a cover with
   * wrong words is never delivered.
   */
  lettering?: {
    outcome: "passed" | "accepted" | "fellBack" | "failed" | "unchecked";
    attempts: number;
    problems?: string[];
  };
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
  /**
   * Full-bleed pages: how calm the picture came out where the words go, and
   * what was done about it. `scrim` means the area stayed too busy after the
   * redraw, so the words get a translucent plate.
   */
  layoutCheck?: {
    /** Busiest text region, 0..1 (see `regionBusyness`). */
    busyness: number;
    /** The tolerance it was held to. */
    threshold: number;
    passed: boolean;
    /** Image calls spent, including the one redraw. */
    attempts: number;
    fallback?: "scrim";
  };
  /**
   * The ink measured for each text slot of the layout this art was drawn for,
   * keyed by slot id. Seeding and new artwork apply it to text whose color the
   * reader has not chosen.
   */
  textInk?: Record<string, import("./book/regionAnalysis").InkChoice>;
}

export interface Anchor {
  id: string;
  name: string;
  /** Where this reference originated; legacy projects may omit it. */
  source?: "analysis" | "user";
  /**
   * The person in the story brief's cast this character is. Their approved
   * portrait is the reference the pages are drawn from, so the link is by id:
   * a name can be renamed, shortened or spelled another way in the story.
   */
  castId?: string;
  /**
   * Prior name(s) this anchor has been renamed from. Lets a fresh story
   * re-analysis — which only knows the name as it appears in the story text —
   * still match this anchor by an old name and preserve the rename instead of
   * minting a duplicate and orphaning this one's art/custom details.
   */
  aliasNames?: string[];
  /**
   * The reader chose this name. A name the analysis made follows the story into
   * another language; one the reader chose never does (`core/book/anchorRefs.ts`).
   */
  nameEdited?: boolean;
  type: AnchorType;
  /** Description derived from the story analysis (editable). */
  description: string;
  /** Protect an author-edited description from silent re-analysis overwrite. */
  descriptionUserEdited?: boolean;
  importance: AnchorImportance;
  /**
   * Character-only age in years. This stays visible and editable in Cast, then
   * travels into reference-sheet and page prompts to guide proportions.
   */
  ageYears?: number;
  /** Why the current age is present, so estimated defaults remain transparent. */
  ageSource?: "author" | "story" | "suggested";
  /**
   * Character-only: gross body layout, inferred by the story analysis. Selects
   * the turnaround angles the reference sheet asks for. Undefined on anchors
   * created before this existed — treated as `bipedal`.
   */
  bodyPlan?: BodyPlan;
  /**
   * Character-only internal scale hint inferred during analysis. Never exposed
   * as a user control; page generation may fall back to age-derived human
   * proportions when this is absent.
   */
  heightCm?: number;
  /** Whether the system creatively designs it, or the user describes it. */
  mode: AnchorMode;
  /** Optional user creative direction for this specific anchor. */
  userGuidance?: string;
  /**
   * Character-only, short-lived likeness source. Cleared when the first
   * photo-backed reference sheet succeeds; never retained as a version image.
   */
  likenessPhoto?: LikenessPhotoRef;
  /**
   * Character-only existing drawings used as identity (and style) references
   * for the first sheet. Kept after generation so a redo can still see them.
   */
  sourceArt?: SourceArtRef[];
  /** Appearance read from `sourceArt`; wins over the analysis description. */
  lookFromArt?: string;
  /** Whether to generate an anchor image for this subject. */
  include: boolean;
  /**
   * Anchors physically contained within this one (e.g. a bed inside a room).
   * Only meaningful for place/object anchors. Stored by anchor id — these are
   * drawn into this anchor's sheet and must match their own reference exactly.
   * Undefined/empty means "no contained anchors" (no implicit name matching).
   */
  containedIds?: string[];
  /** Image version history (undefined until first generation). */
  versions?: VersionTree<AnchorImage>;
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
  /**
   * Where and when this page happens, and what changed since the page before:
   * place, time of day, weather. English, art-direction only; never printed.
   */
  continuity?: string;
  /**
   * Clothing that differs from a character's reference sheet on this page, set
   * only when the page's own words change what someone wears (pyjamas at
   * bedtime, a swimsuit at the lake). Everything else follows the reference.
   */
  wardrobe?: { anchorId: string; outfit: string }[];
  /**
   * The picture carries this page alone: no words, a full-bleed picture. Set on
   * purpose by the page plan or the reader, never because text went missing.
   */
  wordless?: boolean;
  /** True for blank filler pages inserted to keep spreads printable. */
  placeholder?: boolean;
  /**
   * A user-added page with no AI art — a blank canvas the user designs purely
   * with background color, patterns, text and shapes. Skips the generation UI.
   */
  blankCanvas?: boolean;
  /**
   * Explicit non-art completion. Illustrated pages are derived from current
   * artwork instead of storing this. `"text"` means the user finished the page
   * without an illustration.
   */
  completion?: "blank" | "text";
  /**
   * How text is handled on this page: baked into the art ("in-image") or laid
   * out by the app as an editable overlay ("overlay", the default).
   */
  textMode?: TextMode;
  /**
   * Cover-only: when true, the title/subtitle/author below are rendered INTO
   * the generated artwork (typographic cover) instead of being laid out as
   * editable overlay text boxes.
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
  /** Book title (front cover); empty on the back cover unless the reader adds words. */
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
   * overlay text. Requires a model capable of rendering typography.
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
  /**
   * Recurring people, places or things the plan found in the story that the
   * book has no reference for. Written by the plan, read once by the guide, which
   * reads the story again with these named (`state/chatPipeline.ts`).
   */
  unlisted?: string[];
}

/**
 * The story as it was written in one language, kept when the book moves to another
 * so coming back is instant and free. See `core/guide/storyVersions.ts` for when
 * one still tells the same story as the words on the book.
 */
export interface StoryLanguageVersion {
  storyText: string;
  /** The book's title in this language; empty when it has none. */
  title: string;
  /** The cover subtitle in this language; empty for none. */
  subtitle: string;
  /** What each person, place or thing (by anchor id) was called in this language. */
  names: Record<string, string>;
  /** Versions with the same id tell the same story. */
  syncId: string;
  /** The words this version had when its id was made: later edits are measured against them. */
  syncText: string;
  /** The language this one was translated from, when it was translated. */
  translatedFrom?: BookLanguageId;
  savedAt: number;
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
  /** Chat studio authoring state (see `core/guide/projectState.ts`). */
  authoringState?: StudioAuthoringState;
  /**
   * The story in each language it has been written in. Kept on the book itself,
   * outside the undoable fields, so a few stories never push Undo past its size limit.
   */
  storyLanguages?: Partial<Record<BookLanguageId, StoryLanguageVersion>>;
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
export type { StoryMode } from "./config/storyCraftCatalog";

/** Re-export the Final Design layer types for one-stop importing. */
export type {
  BookDesign,
  PrintBleedMode,
  PageDesign,
  PageBackground,
  ShapeElement,
  ShapeKind,
  ShapeText,
  ImageElement,
  ElementEffects,
  ShadowTarget,
  TextBox,
  SharedTextStyle,
  SharedTextStyleKey,
  LastShapePaint,
  LastShapeTextPaint,
  LastCustomTextPaint,
  LastCustomTextScope,
  TextParagraph,
  TextSpan,
  PatternConfig,
  NormRect,
  ColorValue,
  HAlign,
  VAlign,
} from "./design";
export {
  DESIGN_VERSION,
  resolveIllustrationSlotId,
  sharedTextStyleOf,
  sharedTextStylesEqual,
  withSharedTextStyle,
} from "./design";
