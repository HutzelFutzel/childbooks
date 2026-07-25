/**
 * Admin-uploaded **pictures of everything in the catalog** — what a coil binding
 * looks like in the hand, what the square hardcover looks like on a shelf, what
 * a Spark pack looks like on its buy button.
 *
 * All of it lives in one world-readable `appConfig/catalogMedia` doc keyed by
 * `scope/id`, because none of these pictures belong to a product *record*:
 *
 *   - `option/binding/casewrap` — one photo of a casewrap spine is true of every
 *     casewrap book we will ever sell.
 *   - `book/{productId}` — this format's own shots, with `book/default` standing
 *     in for any book that has none yet.
 *   - `ebook/default` — the digital edition is one product whose contents differ
 *     per customer, so its pictures are inherently generic.
 *   - `pack/{packId}` — and `pack/default` behind it.
 *
 * Option keys use durable domain values (`binding/casewrap`), never a provider's
 * SKU encoding (`binding/CW`): pictures are marketing assets that outlive any
 * one print provider, and these are exactly the {@link Binding} / {@link Finish}
 * enums the storefront already receives on `PublicProduct.spec`, so the buying
 * flow can look them up with no mapping.
 *
 * Fallbacks resolve on read rather than by copying, so fixing the default set
 * fixes every item leaning on it.
 *
 * Deactivating a picture keeps the record and the uploaded file — that retired
 * set IS the history, and reactivating is the same flag flipped back. Only an
 * explicit delete removes either.
 */
import { MAX_ASSET_HISTORY } from "./branding";

/** What a picture can be filed against. */
export const MEDIA_SCOPES = ["option", "book", "ebook", "pack"] as const;

export type MediaScope = (typeof MEDIA_SCOPES)[number];

/**
 * The print features that can be photographed (the `option` scope's first
 * segment). `trim` and `binding` describe a format; `print`, `paper` and `finish`
 * are the {@link VARIANT_AXES} a customer chooses, and share their ids so a
 * variant's pictures need no mapping to find.
 */
export const PRINT_OPTION_FEATURES = [
  "trim",
  "binding",
  "print",
  "paper",
  "finish",
] as const;

export type PrintOptionFeature = (typeof PRINT_OPTION_FEATURES)[number];

/**
 * The id an item falls back to when it has no pictures of its own. Scopes with
 * exactly one product (the ebook) simply live here: every copy sold is a
 * different book, so generic art is all there can be.
 */
export const FALLBACK_ID = "default";

/** The digital edition's only key. */
export const EBOOK_MEDIA_KEY = `ebook/${FALLBACK_ID}`;

/** One uploaded picture. */
export interface CatalogPhoto {
  /** Public URL of the uploaded file. */
  imageUrl: string;
  /** Storage path — the record's identity, and how the backend deletes it. */
  storagePath: string;
  /** Describes the picture for screen readers; shown to customers, so required. */
  alt: string;
  /** Optional visible caption, e.g. "8.5 inch square next to a paperback". */
  caption?: string;
  /** Retired pictures stay in place with this false; they are the history. */
  active: boolean;
  /** Ascending; the lowest active one represents the item wherever one fits. */
  sortOrder: number;
  updatedAt: number;
}

export interface CatalogMediaConfig {
  version: 1;
  /** `scope/id` → pictures, lowest sortOrder first. */
  photos: Record<string, CatalogPhoto[]>;
}

export function createDefaultCatalogMediaConfig(): CatalogMediaConfig {
  return { version: 1, photos: {} };
}

// ---- Keys ------------------------------------------------------------------

/**
 * Ids become storage path segments, so they're held to a slug shape — `8.5x8.5`
 * keeps its dots, product ids their hyphens, and nothing else passes.
 */
const SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

export interface ParsedMediaKey {
  scope: MediaScope;
  /** The parts after the scope: `["binding", "casewrap"]`, `["lulu-abc-1"]`. */
  segments: string[];
}

export function optionMediaKey(feature: PrintOptionFeature, value: string): string {
  return `option/${feature}/${value}`;
}

export function bookMediaKey(productId: string): string {
  return `book/${productId}`;
}

export function packMediaKey(packId: string): string {
  return `pack/${packId}`;
}

/** Split and validate a key; the shape required differs per scope. */
export function parseCatalogMediaKey(key: string): ParsedMediaKey | null {
  const [scope, ...segments] = (key ?? "").split("/");
  if (!(MEDIA_SCOPES as readonly string[]).includes(scope)) return null;
  if (segments.length === 0 || !segments.every((s) => SEGMENT_RE.test(s))) return null;
  if (scope === "option") {
    if (segments.length !== 2) return null;
    if (!(PRINT_OPTION_FEATURES as readonly string[]).includes(segments[0])) return null;
  } else if (segments.length !== 1) {
    return null;
  }
  return { scope: scope as MediaScope, segments };
}

export function isCatalogMediaKey(key: unknown): key is string {
  return typeof key === "string" && parseCatalogMediaKey(key) !== null;
}

/**
 * Where a key looks when it has nothing of its own. Print options deliberately
 * have no fallback: a stand-in picture of "some binding" would misinform the
 * buyer it's meant to be helping.
 */
export function fallbackKeyFor(key: string): string | null {
  const parsed = parseCatalogMediaKey(key);
  if (!parsed || parsed.scope === "option") return null;
  return `${parsed.scope}/${FALLBACK_ID}`;
}

export function isFallbackKey(key: string): boolean {
  const parsed = parseCatalogMediaKey(key);
  return parsed != null && parsed.segments.length === 1 && parsed.segments[0] === FALLBACK_ID;
}

// ---- Normalization ---------------------------------------------------------

// Firestore rejects `undefined` field values, so optional fields are only set
// when actually present (mirrors branding's normalizeAsset).
function normalizePhoto(input: unknown, fallbackOrder: number): CatalogPhoto | null {
  const p = input as Partial<CatalogPhoto> | null | undefined;
  if (!p || typeof p.imageUrl !== "string" || !p.imageUrl) return null;
  if (typeof p.storagePath !== "string" || !p.storagePath) return null;
  const photo: CatalogPhoto = {
    imageUrl: p.imageUrl,
    storagePath: p.storagePath,
    alt: typeof p.alt === "string" ? p.alt.slice(0, 300) : "",
    active: p.active !== false,
    sortOrder: Number.isFinite(p.sortOrder) ? Number(p.sortOrder) : fallbackOrder,
    updatedAt: Number.isFinite(p.updatedAt) ? Number(p.updatedAt) : Date.now(),
  };
  if (typeof p.caption === "string" && p.caption) photo.caption = p.caption.slice(0, 300);
  return photo;
}

/** Drop invalid/duplicate (by storagePath) entries, sort, cap length. */
function normalizePhotoList(input: unknown): CatalogPhoto[] {
  if (!Array.isArray(input)) return [];
  const out: CatalogPhoto[] = [];
  const seen = new Set<string>();
  input.forEach((item, i) => {
    const photo = normalizePhoto(item, i);
    if (!photo || seen.has(photo.storagePath)) return;
    seen.add(photo.storagePath);
    out.push(photo);
  });
  out.sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt);
  return out.slice(0, MAX_ASSET_HISTORY);
}

export function normalizeCatalogMediaConfig(input: unknown): CatalogMediaConfig {
  const out = createDefaultCatalogMediaConfig();
  if (!input || typeof input !== "object") return out;
  const stored = (input as Partial<CatalogMediaConfig>).photos ?? {};
  for (const [key, list] of Object.entries(stored as Record<string, unknown>)) {
    if (!isCatalogMediaKey(key)) continue;
    const photos = normalizePhotoList(list);
    if (photos.length > 0) out.photos[key] = photos;
  }
  return out;
}

// ---- Queries ---------------------------------------------------------------

/** Every picture filed under a key, retired ones included (admin view). */
export function photosFor(config: CatalogMediaConfig, key: string): CatalogPhoto[] {
  return config.photos[key] ?? [];
}

/** Only the pictures customers should see, and only this key's own. */
export function activePhotosFor(config: CatalogMediaConfig, key: string): CatalogPhoto[] {
  return photosFor(config, key).filter((p) => p.active);
}

/** What a customer actually sees: the item's own pictures, else its scope default. */
export function resolvedPhotosFor(config: CatalogMediaConfig, key: string): CatalogPhoto[] {
  const own = activePhotosFor(config, key);
  if (own.length > 0) return own;
  const fallback = fallbackKeyFor(key);
  return fallback && fallback !== key ? activePhotosFor(config, fallback) : [];
}

/** The single picture that stands in for an item in a compact space. */
export function primaryPhotoFor(
  config: CatalogMediaConfig,
  key: string | undefined,
): CatalogPhoto | undefined {
  return key ? resolvedPhotosFor(config, key)[0] : undefined;
}
