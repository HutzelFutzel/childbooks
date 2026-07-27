/**
 * Rasterizing rendered pages.
 *
 * Snapshotting a laid-out page element to pixels, and the checks that a
 * snapshot is worth keeping. Document assembly lives in `core/print/assemble`
 * (shared with the backend); this half is unavoidably browser-only.
 */
import { getFontEmbedCSS, toBlob } from "html-to-image";

/** Reject if `promise` doesn't settle within `ms` (prevents indefinite hangs). */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Compute the embedded @font-face CSS once for the whole stage so every page
 * capture reuses it instead of re-fetching all book fonts per page. Returns an
 * empty string (fonts fall back) if it can't be produced in time.
 */
export async function computeFontEmbedCss(node: HTMLElement): Promise<string> {
  try {
    return await withTimeout(getFontEmbedCSS(node), 20000, "Embedding fonts");
  } catch (err) {
    console.warn("Font embedding failed; exporting with fallback fonts.", err);
    return "";
  }
}

/**
 * Wait until web fonts are ready and every expected <img> inside `root` has
 * decoded.
 *
 * `expectedImages` is not optional padding — it's the entire point. The check
 * used to be "is every <img> in the tree loaded", which is trivially true when
 * the tree contains no images yet, and that is exactly the state the stage is
 * in for the first moments after it mounts. Every export therefore raced its
 * own artwork and cheerfully rasterized blank pages with the text on top.
 * Callers now resolve the artwork BEFORE mounting the stage and tell us how
 * many images must be present, so "not there yet" is distinguishable from
 * "there is nothing to wait for".
 *
 * Throws on timeout rather than proceeding: a page short of its illustration is
 * a book someone paid for and can't use, which is worse than a failed export.
 */
export async function waitForStageReady(
  root: HTMLElement,
  opts: { expectedImages: number; timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const start = Date.now();

  // Give lazily-imported @fontsource CSS a tick to register, then await fonts.
  await new Promise((r) => setTimeout(r, 250));
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* fonts API unavailable — best effort */
  }

  const decoded = () => {
    const imgs = Array.from(root.querySelectorAll("img"));
    const ready = imgs.filter((img) => img.complete && img.naturalWidth > 0);
    return { total: imgs.length, ready: ready.length };
  };

  for (;;) {
    const { total, ready } = decoded();
    if (total >= opts.expectedImages && ready === total) break;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `The book's artwork didn't finish loading (${ready} of ${opts.expectedImages} images ready). Please check your connection and try again.`,
      );
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  // Two animation frames so the final layout/paint is settled before snapshot.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
}

/**
 * Snapshot a single rendered page element to a PNG blob at its natural pixel
 * size (the element is already laid out at print resolution).
 *
 * Note: `cacheBust` is intentionally NOT used — it appends a query string to
 * every URL, which corrupts the `blob:` URLs used for illustrations and can make
 * the underlying image load (and thus the export) hang forever. A hard timeout
 * guards against any other stall.
 */
export async function capturePageElement(
  el: HTMLElement,
  opts: { fontEmbedCSS?: string; timeoutMs?: number } = {},
): Promise<Blob> {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const blob = await withTimeout(
    toBlob(el, {
      pixelRatio: 1,
      backgroundColor: "#ffffff",
      width,
      height,
      style: { margin: "0" },
      // Reuse the pre-computed font CSS; if absent, skip font embedding rather
      // than re-fetching every face per page.
      fontEmbedCSS: opts.fontEmbedCSS,
      skipFonts: opts.fontEmbedCSS === undefined ? true : undefined,
    }),
    opts.timeoutMs ?? 45000,
    "Rendering a page",
  );
  if (!blob) throw new Error("Failed to rasterize a page for export.");
  return blob;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode page raster."));
    img.src = src;
  });
}

/**
 * How white a captured page has to be before we call it empty.
 *
 * A page that is essentially all white when its design says it carries a
 * full-bleed illustration means the artwork didn't make it into the snapshot.
 * That used to ship — as a purchased ebook of blank pages with the text
 * floating on them — so it's now a hard failure at the point of capture.
 */
const BLANK_LUMA_THRESHOLD = 250;
const BLANK_PIXEL_RATIO = 0.995;

/** True when nearly every pixel of the raster is white. */
export async function rasterLooksBlank(blob: Blob): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    // A small downsample is plenty: we're asking "is there anything here at
    // all", not measuring the artwork.
    const w = 48;
    const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let white = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luma >= BLANK_LUMA_THRESHOLD) white++;
    }
    return white / pixels >= BLANK_PIXEL_RATIO;
  } catch {
    // If we can't tell, don't block the export on a guess.
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Re-encode a captured PNG to JPEG bytes (much smaller for photographic art). */
export async function blobToJpegBytes(blob: Blob, quality = 0.92): Promise<Uint8Array> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    // Flatten onto white: a JPEG has no alpha, and an unflattened transparent
    // area encodes as black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!jpeg) throw new Error("Could not encode a page for the PDF.");
    return new Uint8Array(await jpeg.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Assemble captured pages into a zip of images, in reading order. */
export async function buildImagesZip(
  pages: { label: string; blob: Blob }[],
  extension = "png",
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const pad = String(pages.length).length;
  pages.forEach((page, i) => {
    const seq = String(i + 1).padStart(Math.max(2, pad), "0");
    zip.file(`${seq}-${slug(page.label)}.${extension}`, page.blob);
  });
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
}

/** Save a blob to disk via an anchor download. */
export async function saveBlob(filename: string, blob: Blob): Promise<boolean> {
  downloadInBrowser(filename, blob);
  return true;
}

function downloadInBrowser(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
