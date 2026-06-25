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
  const backend = await getStorage();
  const id = genId();
  await backend.blobs.put(id, base64ToBlob(base64, mimeType));
  return id;
}

/** Store a binary Blob directly (e.g. an uploaded asset) and return its id. */
export async function putBlob(blob: Blob): Promise<string> {
  const backend = await getStorage();
  const id = genId();
  await backend.blobs.put(id, blob);
  return id;
}

/** Create an object URL for a stored blob (caller must revoke it). */
export async function getBlobUrl(id: string): Promise<string | null> {
  const backend = await getStorage();
  const blob = await backend.blobs.get(id);
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

  const backend = await getStorage();
  const blob = await backend.blobs.get(id);
  if (!blob) return null;
  const entry = { base64: await blobToBase64(blob), mimeType: blob.type || "image/png" };

  if (base64Cache.size >= BASE64_CACHE_MAX) {
    const oldest = base64Cache.keys().next().value;
    if (oldest !== undefined) base64Cache.delete(oldest);
  }
  base64Cache.set(id, entry);
  return entry;
}

export async function removeBlob(id: string): Promise<void> {
  base64Cache.delete(id);
  const backend = await getStorage();
  await backend.blobs.remove(id);
}
