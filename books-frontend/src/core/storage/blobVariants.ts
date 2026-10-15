/**
 * Display copies of a stored picture.
 *
 * A generated picture is kept once at full size (the master) because print,
 * ebooks and every AI edit need every pixel. The studio never does: a page on a
 * screen, a thumbnail in a grid and a chat receipt all want a fraction of it.
 * So each master gets two small WebP copies beside it, written with it:
 *
 *   users/{uid}/blobs/{id}        master (print, ebook, edits, references)
 *   users/{uid}/blobs/{id}.web    what a page on screen is drawn from
 *   users/{uid}/blobs/{id}.thumb  what a tile or strip is drawn from
 *
 * The suffix is a dot because no blob id can contain one (ids are UUIDs, or
 * `styleasset-` ids built from `[a-zA-Z0-9_-]`), so a copy can never be mistaken
 * for a master. Callers keep storing the one `blobId`; the copies are derived
 * from it, which is why no saved book needs migrating. A book drawn before the
 * copies existed simply has none, and reading it falls back to the master.
 *
 * Shared by the browser (reading) and the backend (writing and backfilling).
 */

/** How small a copy is wanted. The master is not a variant: it is the blob itself. */
export type BlobVariant = "web" | "thumb";

/** Every size a reader can ask for, `master` being the original. */
export type BlobSize = BlobVariant | "master";

export const BLOB_VARIANTS: readonly BlobVariant[] = ["web", "thumb"];

export interface BlobVariantSpec {
  /** Longest side in pixels; a picture smaller than this is never enlarged. */
  maxEdge: number;
  /** WebP quality for the colour channels. */
  quality: number;
  /** WebP quality for transparency (cut-outs keep their edges). */
  alphaQuality: number;
}

/**
 * `web` is sized for a page filling a retina screen: the models draw at roughly
 * 1536px, so it keeps nearly every pixel and only changes how it is compressed.
 * `thumb` is for tiles up to a few hundred CSS pixels wide.
 */
export const BLOB_VARIANT_SPECS: Record<BlobVariant, BlobVariantSpec> = {
  web: { maxEdge: 1600, quality: 82, alphaQuality: 90 },
  thumb: { maxEdge: 400, quality: 78, alphaQuality: 85 },
};

export const BLOB_VARIANT_MIME = "image/webp";

/** The Storage object name (inside a user's blob folder) of a blob at a size. */
export function blobObjectName(id: string, size: BlobSize): string {
  return size === "master" ? id : `${id}.${size}`;
}

/** Cache header for pictures: ids are minted once per render and never rewritten. */
export const IMMUTABLE_BLOB_CACHE_CONTROL = "private, max-age=31536000, immutable";

/** A well-formed blob id, for routes that take ids from a client. */
export const BLOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
