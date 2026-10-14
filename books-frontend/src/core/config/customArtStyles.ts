/**
 * Reusable custom art styles.
 *
 * A look that was read from a reader's own character drawings is stored ONCE
 * per account, by the backend, as an immutable record the books can point at
 * (`ArtStyleSelection.customStyle`). The records live in Firestore
 * (`users/{uid}/artStyles/{styleId}` with numbered revisions underneath) and
 * every image they own lives in the user's blob space under the reserved
 * `styleasset-` id prefix, which no project garbage collection may remove.
 *
 * Everything here is pure so the browser, the backend and the invariant tests
 * share one definition of identity, keys and which picture to show for a look.
 */
import type { ImageGenerationHints } from "./imageGeneration";
import type { ModelSelection } from "../types";

/** Blob ids with this prefix belong to a style, never to one book. */
export const STYLE_ASSET_PREFIX = "styleasset-";

/** Custom ids carry an underscore, which no admin preset id can (`[a-z0-9-]`). */
export const CUSTOM_STYLE_ID_PREFIX = "cs_";

/** Most cover pictures kept per style. The UI shows the first three that still exist. */
export const SHOWCASE_COVERS_STORED = 6;
export const SHOWCASE_COVERS_SHOWN = 3;

export function isStyleAssetBlobId(id: string | undefined | null): boolean {
  return typeof id === "string" && id.startsWith(STYLE_ASSET_PREFIX);
}

/** Strict on purpose: the id becomes a Firestore document id, so no path characters, ever. */
export function isCustomStyleId(id: string | null | undefined): boolean {
  return typeof id === "string" && /^cs_[a-zA-Z0-9]{1,64}$/.test(id);
}

/** One picture a style owns. The pixels are a user blob; the hash is what makes it findable. */
export interface StyleReferenceImage {
  blobId: string;
  mimeType: string;
  /** sha256 of the stored bytes. */
  sha256: string;
  width?: number;
  height?: number;
  createdAt: number;
}

/** What made a revision's wording: the vision pass that read the drawings. */
export interface StyleExtractionRecord {
  model: ModelSelection;
  /** Bumped when the extraction prompt changes enough to matter when comparing runs. */
  promptVersion: string;
  at: number;
}

export type CustomStyleStatus = "candidate" | "active" | "archived";

/** `users/{uid}/artStyles/{id}` */
export interface CustomArtStyle {
  id: string;
  uid: string;
  origin: "derived";
  /**
   * `candidate` until the reader chose it (a clash between drawings offers
   * several), `active` once a book uses it, `archived` when the reader removed
   * it from their library.
   */
  status: CustomStyleStatus;
  /** Identity of the drawings that define this look (see {@link styleFingerprint}). */
  fingerprint: string;
  /** Name shown in the library. Editable; never part of the style's identity. */
  label: string;
  currentRevision: number;
  /** The book the look was first read from. */
  createdFromProjectId: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  /** Books that use it, newest last, capped. */
  projectIds: string[];
  /** Neutral sample portrait drawn in this look, once generated (see `portraitReference`). */
  portraitReference?: StyleReferenceImage & { revision: number };
  /** Set while the sample portrait is being drawn, so it is queued once. */
  portraitReferenceStartedAt?: number;
}

/** `users/{uid}/artStyles/{id}/revisions/{revision}`: never edited after creation. */
export interface CustomArtStyleRevision {
  revision: number;
  /** What image generation is told about the look. The backend is the only source of this text. */
  promptDescription: string;
  /** Durable copies of the drawings, the one that sets the look first. */
  sourceArt: StyleReferenceImage[];
  /** sha256 of EVERY drawing that defined the look, sorted, including ones not copied. */
  sourceArtHashes: string[];
  derivedFromNames: string[];
  extraction: StyleExtractionRecord;
  generationHints: ImageGenerationHints;
  createdAt: number;
}

/** A pointer is all a book keeps. The text and pictures come from the record. */
export interface CustomStyleRef {
  id: string;
  revision: number;
}

/** One cover drawn in a style, copied so deleting the book keeps the preview. */
export interface StyleCoverExample {
  projectId: string;
  /** Version of the book's cover this copy was taken from. */
  sourceBlobId: string;
  image: StyleReferenceImage;
  /** Custom styles: the revision it was drawn with. Presets leave it out. */
  styleRevision?: number;
  capturedAt: number;
}

/** `users/{uid}/styleShowcase/{styleId or presetId}` */
export interface StyleShowcase {
  /** Custom style id, or the admin preset id. */
  key: string;
  covers: StyleCoverExample[];
  updatedAt: number;
}

/** Order covers the way they are shown: the oldest books first, so previews stay put. */
export function showcaseCoversOf(
  showcase: StyleShowcase | null | undefined,
  options: { existingProjectIds?: ReadonlySet<string>; limit?: number } = {},
): StyleCoverExample[] {
  if (!showcase) return [];
  const limit = options.limit ?? SHOWCASE_COVERS_SHOWN;
  return showcase.covers
    .filter((cover) => !options.existingProjectIds || options.existingProjectIds.has(cover.projectId))
    .slice()
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .slice(0, limit);
}

/** Where the picture shown for a look comes from, best first. */
export type StylePreviewSource = "admin" | "cover" | "portrait" | "none";

export interface StylePreview {
  source: StylePreviewSource;
  /** Public URL (admin example). */
  url?: string;
  /** User blob (cover copy or sample portrait). */
  blobId?: string;
}

/**
 * The picture a look is shown with. Admin-curated examples win; when a look
 * has none, the reader's own first covers in that look stand in; the neutral
 * sample portrait is the last picture before the plain card.
 */
export function resolveStylePreview(args: {
  /** Examples configured by an admin for a preset. */
  adminExamples?: readonly { imageUrl: string }[];
  showcase?: StyleShowcase | null;
  portraitReference?: Pick<StyleReferenceImage, "blobId"> | null;
  existingProjectIds?: ReadonlySet<string>;
}): StylePreview {
  const admin = args.adminExamples?.find((example) => Boolean(example.imageUrl));
  if (admin) return { source: "admin", url: admin.imageUrl };
  const [cover] = showcaseCoversOf(args.showcase, { existingProjectIds: args.existingProjectIds, limit: 1 });
  if (cover) return { source: "cover", blobId: cover.image.blobId };
  if (args.portraitReference?.blobId) return { source: "portrait", blobId: args.portraitReference.blobId };
  return { source: "none" };
}

/** Every picture a look can show as a strip: admin examples, else covers, else the sample. */
export function resolveStylePreviewStrip(args: {
  adminExamples?: readonly { imageUrl: string }[];
  showcase?: StyleShowcase | null;
  portraitReference?: Pick<StyleReferenceImage, "blobId"> | null;
  existingProjectIds?: ReadonlySet<string>;
  limit?: number;
}): StylePreview[] {
  const limit = args.limit ?? SHOWCASE_COVERS_SHOWN;
  const admin = (args.adminExamples ?? []).filter((example) => Boolean(example.imageUrl));
  if (admin.length > 0) {
    return admin.slice(0, limit).map((example) => ({ source: "admin" as const, url: example.imageUrl }));
  }
  const covers = showcaseCoversOf(args.showcase, { existingProjectIds: args.existingProjectIds, limit });
  if (covers.length > 0) {
    return covers.map((cover) => ({ source: "cover" as const, blobId: cover.image.blobId }));
  }
  if (args.portraitReference?.blobId) {
    return [{ source: "portrait", blobId: args.portraitReference.blobId }];
  }
  return [];
}

/**
 * Stable text of a pointer, used as the art-style key. It starts with `custom`
 * like every custom look's key always has, so analytics that group on the
 * first segment keep their one "custom" bucket.
 */
export function customStyleKeyOf(ref: CustomStyleRef): string {
  return `custom|${ref.id}@${ref.revision}`;
}

/** Cheap structural check for a pointer read from stored or client-supplied data. */
export function parseCustomStyleRef(value: unknown): CustomStyleRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !isCustomStyleId(raw.id) || raw.id.length > 80) return undefined;
  if (typeof raw.revision !== "number" || !Number.isInteger(raw.revision) || raw.revision < 1) return undefined;
  return { id: raw.id, revision: raw.revision };
}

/**
 * Identity of a look: the drawings that define it, nothing else. The wording a
 * vision model gave it changes from run to run, so it cannot be part of this.
 * Takes the sha256 of each drawing's bytes; order and repeats do not matter.
 */
export function styleFingerprintInput(hashes: readonly string[]): string {
  return [...new Set(hashes.map((hash) => hash.trim().toLowerCase()).filter(Boolean))].sort().join(",");
}

/** Document id derived from a fingerprint digest (hex). */
export function customStyleIdFor(fingerprintDigest: string): string {
  return `${CUSTOM_STYLE_ID_PREFIX}${fingerprintDigest.slice(0, 32)}`;
}

/** Blob id of a picture a style owns, so it is recognisable and never collected. */
export function styleAssetBlobId(key: string, kind: string, suffix: string | number): string {
  const safe = (text: string) => text.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
  return `${STYLE_ASSET_PREFIX}${safe(key)}-${safe(kind)}-${safe(String(suffix))}`;
}
