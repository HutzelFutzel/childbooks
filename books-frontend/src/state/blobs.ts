/**
 * Helpers for storing generated images as blobs and turning stored blobs back
 * into object URLs for display. Bridges core image results <-> the blob store.
 */
import { getStorage } from "../platform/storage";
import { backendFetch } from "../platform/backend";
import { clearBlobDiskCache } from "../platform/blobDiskCache";
import { isStyleAssetBlobId } from "../core/config/customArtStyles";
import { BLOB_VARIANTS, blobObjectName, type BlobSize } from "../core/storage/blobVariants";

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
  // An upload from the browser has no small copies yet (the backend makes them
  // for what it draws). Ask for them now, so another device or the next visit
  // doesn't pull this picture at full size.
  requestVariants(id);
  return id;
}

/**
 * In-memory cache of fetched blobs, one entry per picture AND size. Every
 * `blobs.get` is a round trip to Firebase Storage, and the same illustration is
 * asked for by the editor, the preview and each export pass — a 25-page book
 * used to download its artwork several times over, which is also what made the
 * export race its own images.
 *
 * Ids are immutable (a new id is minted for every stored image), so entries
 * never go stale. In-flight promises are cached too, so N simultaneous callers
 * (exactly what a print stage does) share ONE download.
 *
 * The small copies are what almost everything holds now, so the cap is larger
 * than it was when every entry was a full-size picture.
 */
const blobCache = new Map<string, Promise<Blob | null>>();
const BLOB_CACHE_MAX = 160;

function evictIfFull(): void {
  if (blobCache.size >= BLOB_CACHE_MAX) {
    const oldest = blobCache.keys().next().value;
    if (oldest !== undefined) blobCache.delete(oldest);
  }
}

/** Seed the cache with bytes we already hold (e.g. straight after a write). */
function rememberBlob(id: string, blob: Blob): void {
  evictIfFull();
  blobCache.set(blobObjectName(id, "master"), Promise.resolve(blob));
}

/**
 * Pictures already asked to be given small copies this session, so a screen full
 * of old pictures asks once, in one request, instead of once per tile.
 */
const variantsRequested = new Set<string>();
let variantQueue: string[] = [];
let variantTimer: ReturnType<typeof setTimeout> | null = null;

const VARIANT_REQUEST_DELAY_MS = 800;
const VARIANT_REQUEST_BATCH = 48;

async function flushVariantRequests(): Promise<void> {
  variantTimer = null;
  const ids = variantQueue.splice(0, VARIANT_REQUEST_BATCH);
  if (variantQueue.length > 0) variantTimer = setTimeout(() => void flushVariantRequests(), VARIANT_REQUEST_DELAY_MS);
  if (ids.length === 0) return;
  try {
    const res = await backendFetch("/blobs/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
      // A favour to the next visit: it must never open a sign-in dialog.
      background: true,
    });
    if (!res.ok) throw new Error(`variants ${res.status}`);
  } catch {
    // Offline, signed out, or the backend is busy: let a later read try again.
    for (const id of ids) variantsRequested.delete(id);
  }
}

/**
 * Ask the backend to make a picture's small copies. Fire and forget: nothing
 * waits on it and nothing breaks without it, the picture just keeps being read
 * at full size until it lands.
 */
function requestVariants(id: string): void {
  if (variantsRequested.has(id)) return;
  variantsRequested.add(id);
  variantQueue.push(id);
  if (!variantTimer) variantTimer = setTimeout(() => void flushVariantRequests(), VARIANT_REQUEST_DELAY_MS);
}

function fetchBlob(id: string, size: BlobSize): Promise<Blob | null> {
  const key = blobObjectName(id, size);
  const hit = blobCache.get(key);
  if (hit) return hit;

  // Anything already held at full size serves every smaller size too: it is in
  // memory (or on its way), and fetching a smaller copy of it would only cost.
  if (size !== "master") {
    const master = blobCache.get(blobObjectName(id, "master"));
    if (master) return master;
  }

  const pending = (async () => {
    const backend = await getStorage();
    const blob = await backend.blobs.get(id, size);
    if (blob || size === "master") return blob;
    // No small copy: a picture stored before copies existed (or whose copy
    // failed). Show the original this once, and have the copies made so no
    // later visit has to.
    const original = await backend.blobs.get(id, "master");
    if (original) requestVariants(id);
    return original;
  })().catch((err) => {
    // Never cache a failure: a CORS hiccup or an expired token must not pin an
    // illustration to "broken" for the rest of the session.
    blobCache.delete(key);
    throw err;
  });

  evictIfFull();
  blobCache.set(key, pending);
  return pending;
}

/**
 * Read a stored blob's original bytes, from cache when it's already been
 * fetched this session. This is the full-size picture: for copying, references
 * and anything that must not lose a pixel. To put a picture on a screen use
 * {@link getBlobUrl}, which defaults to the small copy.
 */
export async function getBlob(id: string, size: BlobSize = "master"): Promise<Blob | null> {
  return fetchBlob(id, size);
}

/**
 * Create an object URL for a stored blob (caller must revoke it), for DISPLAY.
 *
 * `size` is how much picture the screen needs: `thumb` for a tile or strip,
 * `web` (the default) for a page being looked at or edited, `master` only when
 * the original pixels are the point.
 *
 * A FRESH object URL per call, deliberately: consumers revoke on unmount, and a
 * shared URL would be pulled out from under everyone else still using it. Only
 * the underlying bytes are shared.
 */
export async function getBlobUrl(id: string, size: BlobSize = "web"): Promise<string | null> {
  const blob = await fetchBlob(id, size);
  return blob ? URL.createObjectURL(blob) : null;
}

/** Forget everything fetched this session and on this device (sign-out, account switch). */
export async function clearBlobCaches(): Promise<void> {
  blobCache.clear();
  base64Cache.clear();
  variantsRequested.clear();
  variantQueue = [];
  if (variantTimer) {
    clearTimeout(variantTimer);
    variantTimer = null;
  }
  await clearBlobDiskCache();
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

  const blob = await fetchBlob(id, "master");
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
  const blob = await fetchBlob(id, "master");
  if (!blob) return null;
  return putBlob(blob);
}

export async function removeBlob(id: string): Promise<void> {
  // A picture a saved custom art style owns outlives every book that uses it.
  if (isStyleAssetBlobId(id)) return;
  base64Cache.delete(id);
  for (const size of ["master", ...BLOB_VARIANTS] as const) blobCache.delete(blobObjectName(id, size));
  variantsRequested.delete(id);
  const backend = await getStorage();
  await backend.blobs.remove(id);
}
