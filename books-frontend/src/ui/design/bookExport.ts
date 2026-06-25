/**
 * Print-ready export pipeline.
 *
 * The Final Design pages are rendered offscreen at print resolution (see
 * {@link ExportRunner}); this module snapshots each rendered page to a raster
 * and assembles either a full-bleed PDF (one book page per PDF page, sized to
 * the exact trim) or a zip of page images. Saving works both inside the Tauri
 * desktop shell (native save dialog) and in a plain browser (anchor download).
 */
import { getFontEmbedCSS, toBlob } from "html-to-image";
import { isTauri } from "../../platform/runtime";

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

export interface PageCapture {
  /** Page/spread id (used for file naming). */
  id: string;
  /** Human label, e.g. "Front cover" or "Page 3". */
  label: string;
  /** Pixel size of the captured raster. */
  widthPx: number;
  heightPx: number;
  /** Physical size on paper, in inches. */
  widthIn: number;
  heightIn: number;
}

export interface CapturedPage extends PageCapture {
  blob: Blob;
}

/** Wait until web fonts are ready and every <img> inside `root` has decoded. */
export async function waitForStageReady(root: HTMLElement, timeoutMs = 15000): Promise<void> {
  const start = Date.now();

  // Give lazily-imported @fontsource CSS a tick to register, then await fonts.
  await new Promise((r) => setTimeout(r, 250));
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* fonts API unavailable — best effort */
  }

  const imagesReady = () => {
    const imgs = Array.from(root.querySelectorAll("img"));
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  };

  while (!imagesReady()) {
    if (Date.now() - start > timeoutMs) break;
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

/** Re-encode a PNG blob to a JPEG data URL (smaller PDFs for photographic art). */
async function blobToJpegDataUrl(blob: Blob, quality = 0.92): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode page raster."));
    img.src = src;
  });
}

/** Assemble captured pages into a single full-bleed PDF blob. */
export async function buildPdf(pages: CapturedPage[]): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  if (pages.length === 0) throw new Error("There are no pages to export.");

  let doc: import("jspdf").jsPDF | null = null;
  for (const page of pages) {
    const orientation = page.widthIn >= page.heightIn ? "landscape" : "portrait";
    const format: [number, number] = [page.widthIn, page.heightIn];
    if (!doc) {
      doc = new jsPDF({ unit: "in", format, orientation, compress: true });
    } else {
      doc.addPage(format, orientation);
    }
    const jpeg = await blobToJpegDataUrl(page.blob);
    doc.addImage(jpeg, "JPEG", 0, 0, page.widthIn, page.heightIn, undefined, "FAST");
  }
  return doc!.output("blob");
}

/** Assemble captured pages into a zip of PNG images, in reading order. */
export async function buildImagesZip(pages: CapturedPage[]): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const pad = String(pages.length).length;
  pages.forEach((page, i) => {
    const seq = String(i + 1).padStart(Math.max(2, pad), "0");
    zip.file(`${seq}-${slug(page.label)}.png`, page.blob);
  });
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
}

/** Save a blob to disk: native dialog under Tauri, anchor download in browsers. */
export async function saveBlob(filename: string, blob: Blob): Promise<boolean> {
  if (isTauri()) {
    const saved = await saveViaTauri(filename, blob);
    if (saved !== "fallback") return saved;
  }
  downloadInBrowser(filename, blob);
  return true;
}

async function saveViaTauri(filename: string, blob: Blob): Promise<boolean | "fallback"> {
  try {
    const ext = filename.split(".").pop() ?? "";
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: filename,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (!path) return false; // user cancelled
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  } catch {
    return "fallback";
  }
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
