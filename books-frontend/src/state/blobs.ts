/**
 * Helpers for storing generated images as blobs and turning stored blobs back
 * into object URLs for display. Bridges core image results <-> the blob store.
 */
import { getStorage } from "../platform/storage";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Store a base64 image and return its blob id. */
export async function putImageBlob(base64: string, mimeType: string): Promise<string> {
  return putBlob(base64ToBlob(base64, mimeType));
}

/** Store a binary Blob directly (e.g. an uploaded asset) and return its id. */
export async function putBlob(blob: Blob): Promise<string> {
  const backend = await getStorage();
  const id = genId();
  await backend.blobs.put(id, blob);
  // Seed the cache: the bytes are already in hand, so the first read back (the
  // editor showing what was just generated) shouldn't be a download.
  rememberBlob(id, blob);
  return id;
}

/**
 * In-memory cache of fetched blobs. Every `blobs.get` is a round trip to
 * Firebase Storage, and the same illustration is asked for by the editor, the
 * preview and each export pass — a 25-page book used to download its artwork
 * several times over, which is also what made the export race its own images.
 *
 * Ids are immutable (a new id is minted for every stored image), so entries
 * never go stale. In-flight promises are cached too, so N simultaneous callers
 * (exactly what a print stage does) share ONE download.
 */
const blobCache = new Map<string, Promise<Blob | null>>();
const BLOB_CACHE_MAX = 64;

function evictIfFull(): void {
  if (blobCache.size >= BLOB_CACHE_MAX) {
    const oldest = blobCache.keys().next().value;
    if (oldest !== undefined) blobCache.delete(oldest);
  }
}

/** Seed the cache with bytes we already hold (e.g. straight after a write). */
function rememberBlob(id: string, blob: Blob): void {
  evictIfFull();
  blobCache.set(id, Promise.resolve(blob));
}

function fetchBlob(id: string): Promise<Blob | null> {
  const hit = blobCache.get(id);
  if (hit) return hit;

  const pending = (async () => {
    const backend = await getStorage();
    return backend.blobs.get(id);
  })().catch((err) => {
    // Never cache a failure: a CORS hiccup or an expired token must not pin an
    // illustration to "broken" for the rest of the session.
    blobCache.delete(id);
    throw err;
  });

  evictIfFull();
  blobCache.set(id, pending);
  return pending;
}

/** Read a stored blob, from cache when it's already been fetched this session. */
export async function getBlob(id: string): Promise<Blob | null> {
  return fetchBlob(id);
}

/**
 * Create an object URL for a stored blob (caller must revoke it).
 *
 * A FRESH object URL per call, deliberately: consumers revoke on unmount, and a
 * shared URL would be pulled out from under everyone else still using it. Only
 * the underlying bytes are shared.
 */
export async function getBlobUrl(id: string): Promise<string | null> {
  const blob = await fetchBlob(id);
  return blob ? URL.createObjectURL(blob) : null;
}

/**
 * In-memory cache of decoded base64 for blobs. Blob ids are immutable (a new id
 * is minted for every stored image), so cached entries never go stale. Bounded
 * with simple FIFO eviction to keep memory in check.
 */
const base64Cache = new Map<string, { base64: string; mimeType: string }>();
const BASE64_CACHE_MAX = 64;

/** Read a stored blob back as base64 (for use as a reference image). */
export async function getBlobBase64(
  id: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const cached = base64Cache.get(id);
  if (cached) return cached;

  const blob = await fetchBlob(id);
  if (!blob) return null;
  const entry = { base64: await blobToBase64(blob), mimeType: blob.type || "image/png" };

  if (base64Cache.size >= BASE64_CACHE_MAX) {
    const oldest = base64Cache.keys().next().value;
    if (oldest !== undefined) base64Cache.delete(oldest);
  }
  base64Cache.set(id, entry);
  return entry;
}

/**
 * Duplicate a stored blob under a fresh id (returns null when the source is
 * missing). Used when importing images across projects: version-tree blobs are
 * project-exclusive by construction, so a shared id would be GC'd with its
 * source project — each project must own its own copy.
 */
export async function copyBlob(id: string): Promise<string | null> {
  const blob = await fetchBlob(id);
  if (!blob) return null;
  return putBlob(blob);
}

export async function removeBlob(id: string): Promise<void> {
  base64Cache.delete(id);
  blobCache.delete(id);
  const backend = await getStorage();
  await backend.blobs.remove(id);
}
