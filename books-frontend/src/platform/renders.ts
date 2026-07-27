/**
 * Client half of the render cache.
 *
 * A book is rasterized once. The pages go to the backend, which assembles the
 * interior, the cover and the digital edition from them and keeps the finished
 * PDFs — so buying an unchanged book a second time (a gift, a reorder, a
 * download after switching plans) costs a lookup instead of a minute of the
 * buyer's CPU, and every edition of that book is byte-identical.
 *
 * The cache is addressed by content fingerprint, so it invalidates itself: any
 * edit that changes what the pages look like changes the key.
 */
import { backendFetch } from "./backend";
import type { RasterPage } from "../core/print/assemble";

export type RasterRole = "interior" | "ebook" | "cover-front" | "cover-back" | "spine";

export interface RenderAvailability {
  ebook: boolean;
  interior: boolean;
  /** Document keys of cached covers — a cover varies by SKU and page count. */
  covers: string[];
  hasCoverPanels: boolean;
  interiorPageCount: number | null;
}

const MISSING: RenderAvailability = {
  ebook: false,
  interior: false,
  covers: [],
  hasCoverPanels: false,
  interiorPageCount: null,
};

/** Cache key for a cover, which depends on the binding and the page count. */
export function coverDocumentKey(sku: string, pages: number): string {
  return `cover:${sku}:${pages}`;
}

/**
 * What's already rendered for this fingerprint.
 *
 * Never throws: a cache that can't be reached is a cache miss, and a miss just
 * means rendering locally the way we always did.
 */
export async function fetchRenderAvailability(fingerprint: string): Promise<RenderAvailability> {
  try {
    const res = await backendFetch(`/account/renders/${encodeURIComponent(fingerprint)}`);
    if (!res.ok) return MISSING;
    return (await res.json()) as RenderAvailability;
  } catch {
    return MISSING;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Roughly how much base64 to put in one request.
 *
 * The backend accepts 60MB, but a single failed 60MB POST costs the whole
 * upload; batching by size means a retry is cheap and progress is honest.
 */
const BATCH_BYTES = 12 * 1024 * 1024;

export interface UploadPage {
  raster: RasterPage;
  role: RasterRole;
  index: number;
}

/** Send rasterized pages to the backend, in size-bounded batches. */
export async function uploadRenderPages(
  fingerprint: string,
  projectId: string,
  pages: UploadPage[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const wire = pages.map(({ raster, role, index }) => ({
    id: raster.id,
    role,
    index,
    label: raster.label,
    widthIn: raster.widthIn,
    heightIn: raster.heightIn,
    mimeType: raster.mimeType,
    base64: bytesToBase64(raster.bytes),
  }));

  let batch: typeof wire = [];
  let batchBytes = 0;
  let sent = 0;

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    const res = await backendFetch(`/account/renders/${encodeURIComponent(fingerprint)}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, pages: batch }),
    });
    if (!res.ok) throw new Error("We couldn't save the rendered pages. Please try again.");
    sent += batch.length;
    onProgress?.(sent, wire.length);
    batch = [];
    batchBytes = 0;
  }

  for (const page of wire) {
    if (batchBytes + page.base64.length > BATCH_BYTES) await flush();
    batch.push(page);
    batchBytes += page.base64.length;
  }
  await flush();
}

export interface AssembleRequest {
  kind: "ebook" | "interior" | "cover";
  /** Interior + cover: the page count the order is priced and bound at. */
  padToPages?: number;
  sku?: string;
  cover?: { widthIn: number; heightIn: number; panelWidthIn: number };
}

/** Ask the backend to build a document from the uploaded pages. */
export async function assembleRenderDocument(
  fingerprint: string,
  request: AssembleRequest,
): Promise<void> {
  const res = await backendFetch(`/account/renders/${encodeURIComponent(fingerprint)}/assemble`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const message = await res
      .json()
      .then((body: { error?: { message?: string } }) => body?.error?.message)
      .catch(() => undefined);
    throw new Error(message ?? "We couldn't assemble your book. Please try again.");
  }
}
