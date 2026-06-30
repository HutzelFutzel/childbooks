import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EXPORT_DPI } from "../../core/config/options";
import { bookProductForConfig, pageTrimForConfig } from "../../core/book";
import { computeCoverLayout } from "../../core/fulfillment/coverLayout";
import { getCursor } from "../../core/versioning";
import { COVER_BACK_ID, COVER_FRONT_ID, type BookDesign, type Project } from "../../core/types";
import {
  buildPdf,
  capturePageElement,
  computeFontEmbedCss,
  waitForStageReady,
  type CapturedPage,
} from "../design/bookExport";
import type { DesignPage } from "../design/designInit";
import { PrintBook } from "../design/PrintBook";

/** The print-ready files Lulu needs: an interior PDF and a wraparound cover. */
export interface OrderAssets {
  interior: Blob;
  cover?: Blob;
  /** Number of interior (non-cover) pages in the interior PDF. */
  pageCount: number;
}

/** DPI for the (potentially large) wraparound cover raster. */
const COVER_DPI = 200;

/**
 * Renders the book offscreen and produces Lulu's two printables: a full-bleed
 * interior PDF (content pages only, one trim page each) and a single wraparound
 * cover PDF (back + spine + front) sized to the provider's cover dimensions.
 *
 * Print specs (trim, bleed, spine) follow the curated product catalog, which is
 * still marked unverified — treat output as provisional until proofed against a
 * live Lulu product sheet.
 */
export function OrderAssetRunner({
  project,
  pages,
  design,
  coverWidthMm,
  coverHeightMm,
  onProgress,
  onDone,
  onError,
}: {
  project: Project;
  pages: DesignPage[];
  design: BookDesign;
  coverWidthMm: number;
  coverHeightMm: number;
  onProgress: (status: string) => void;
  onDone: (assets: OrderAssets) => void;
  onError: (err: unknown) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const product = bookProductForConfig(project.config);
  const trim = pageTrimForConfig(project.config);
  const pageHeightPx = Math.round(trim.heightIn * EXPORT_DPI);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const stage = stageRef.current;
      if (!stage) {
        onError(new Error("Could not prepare the print stage."));
        return;
      }
      try {
        onProgress("Loading fonts & artwork…");
        await waitForStageReady(stage);
        onProgress("Embedding fonts…");
        const fontEmbedCSS = await computeFontEmbedCss(stage);

        const grab = (id: string) =>
          stage.querySelector<HTMLElement>(`[data-export-page="${cssEscape(id)}"]`);

        // Interior: every content page, full-bleed (trim + bleed on all edges).
        const bleed = product.bleedIn;
        const contentPages = pages.filter((p) => !p.isCover);
        const interiorCaptures: CapturedPage[] = [];
        for (let i = 0; i < contentPages.length; i++) {
          const page = contentPages[i];
          onProgress(`Rendering interior page ${i + 1} of ${contentPages.length}…`);
          const el = grab(page.id);
          if (!el) continue;
          const blob = await capturePageElement(el, { fontEmbedCSS });
          interiorCaptures.push({
            id: page.id,
            label: page.label,
            blob,
            widthPx: el.offsetWidth,
            heightPx: el.offsetHeight,
            widthIn: trim.heightIn * page.aspect + bleed * 2,
            heightIn: trim.heightIn + bleed * 2,
          });
        }
        if (interiorCaptures.length === 0) throw new Error("No interior pages to print.");
        onProgress("Assembling interior PDF…");
        const interior = await buildPdf(interiorCaptures);

        // Cover: compose back + spine + front onto one wraparound canvas.
        onProgress("Building cover…");
        const cover = await buildCover({
          frontEl: grab(COVER_FRONT_ID),
          backEl: grab(COVER_BACK_ID),
          fontEmbedCSS,
          coverWidthMm,
          coverHeightMm,
          trimWidthIn: trim.widthIn,
          bleedIn: bleed,
          spineText: project.screenplay
            ? getCursor(project.screenplay).content.spine?.text
            : undefined,
        });

        onDone({ interior, cover, pageCount: interiorCaptures.length });
      } catch (err) {
        onError(err);
      }
    }

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div ref={stageRef} aria-hidden>
      <PrintBook pages={pages} design={design} pageHeightPx={pageHeightPx} forExport />
    </div>,
    document.body,
  );
}

async function buildCover(opts: {
  frontEl: HTMLElement | null;
  backEl: HTMLElement | null;
  fontEmbedCSS: string;
  coverWidthMm: number;
  coverHeightMm: number;
  trimWidthIn: number;
  bleedIn: number;
  spineText?: string;
}): Promise<Blob | undefined> {
  if (!opts.frontEl) return undefined; // no front cover designed → skip cover file

  const layout = computeCoverLayout({
    coverWidthMm: opts.coverWidthMm,
    coverHeightMm: opts.coverHeightMm,
    trimWidthIn: opts.trimWidthIn,
    bleedIn: opts.bleedIn,
    dpi: COVER_DPI,
  });

  const frontImg = await elementToImage(opts.frontEl, opts.fontEmbedCSS);
  const backImg = opts.backEl ? await elementToImage(opts.backEl, opts.fontEmbedCSS) : null;

  const canvas = document.createElement("canvas");
  canvas.width = layout.widthPx;
  canvas.height = layout.heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable for the cover.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Spine band first (under nothing), using a neutral tone sampled from the
  // front cover's top-left so it blends with the artwork.
  const spineColor = sampleColor(frontImg) ?? "#e8e2d6";
  ctx.fillStyle = spineColor;
  ctx.fillRect(layout.spine.xPx, 0, layout.spine.widthPx, layout.heightPx);

  // Back panel (left). If no back cover art, fill with the spine tone.
  if (backImg) {
    ctx.drawImage(backImg, layout.back.xPx, 0, layout.back.widthPx, layout.heightPx);
  } else {
    ctx.fillStyle = spineColor;
    ctx.fillRect(layout.back.xPx, 0, layout.back.widthPx, layout.heightPx);
  }
  // Front panel (right).
  ctx.drawImage(frontImg, layout.front.xPx, 0, layout.front.widthPx, layout.heightPx);

  // Spine title (rotated), if the spine is wide enough to be legible.
  if (opts.spineText?.trim() && layout.spine.widthPx > COVER_DPI * 0.18) {
    drawSpineText(ctx, opts.spineText.trim(), layout.spine, layout.heightPx);
  }

  const jpeg = canvasToJpegDataUrl(canvas);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    unit: "in",
    format: [layout.widthIn, layout.heightIn],
    orientation: layout.widthIn >= layout.heightIn ? "landscape" : "portrait",
    compress: true,
  });
  doc.addImage(jpeg, "JPEG", 0, 0, layout.widthIn, layout.heightIn, undefined, "FAST");
  return doc.output("blob");
}

function drawSpineText(
  ctx: CanvasRenderingContext2D,
  text: string,
  spine: { xPx: number; widthPx: number },
  heightPx: number,
): void {
  ctx.save();
  ctx.translate(spine.xPx + spine.widthPx / 2, heightPx / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "#1f2933";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(spine.widthPx * 0.5)}px Georgia, serif`;
  ctx.fillText(text, 0, 0, heightPx * 0.8);
  ctx.restore();
}

/** Average a small region of an image to a CSS color (for the spine fill). */
function sampleColor(img: HTMLImageElement): string | null {
  try {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 8, 8);
    const { data } = ctx.getImageData(0, 0, 8, 8);
    let r = 0;
    let g = 0;
    let b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
  } catch {
    return null;
  }
}

async function elementToImage(el: HTMLElement, fontEmbedCSS: string): Promise<HTMLImageElement> {
  const blob = await capturePageElement(el, { fontEmbedCSS });
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode a cover panel."));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", 0.92);
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\\]]/g, "\\$&");
}
