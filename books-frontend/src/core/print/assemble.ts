/**
 * PDF assembly from rasterized pages.
 *
 * One module builds all three documents a finished book produces — the print
 * interior, the wraparound cover, and the digital edition — from the same
 * rasters. That's deliberate: they used to be assembled by separate code paths
 * with separate geometry, which is how the printed and digital editions came
 * to disagree about page size, cover treatment and page count.
 *
 * Pure, DOM-free and isomorphic (pdf-lib runs in the browser and on Node), so
 * the backend can assemble exactly what the browser would have.
 */
import { PDFDocument, rgb, type PDFImage } from "pdf-lib";
import { PT_PER_IN } from "./geometry";

/** A rasterized page, ready to be placed. */
export interface RasterPage {
  /** Stable identity — a design page id, or `${spreadId}#left` for a leaf. */
  id: string;
  label: string;
  bytes: Uint8Array;
  mimeType: string;
  /** Physical size this raster represents, in inches. */
  widthIn: number;
  heightIn: number;
}

/**
 * Wrap assembled PDF bytes in a Blob.
 *
 * Via a detached ArrayBuffer rather than the Uint8Array directly: Node's and
 * the DOM's `Blob` disagree about which backing buffers they'll accept, and
 * this is the one form both take without a cast.
 */
export function pdfBlob(bytes: Uint8Array): Blob {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([buffer as ArrayBuffer], { type: "application/pdf" });
}

async function embed(doc: PDFDocument, page: Pick<RasterPage, "bytes" | "mimeType">): Promise<PDFImage> {
  return page.mimeType.includes("png") ? doc.embedPng(page.bytes) : doc.embedJpg(page.bytes);
}

/** Place a raster so it exactly covers a freshly added page of its own size. */
async function addRasterPage(doc: PDFDocument, raster: RasterPage): Promise<void> {
  const image = await embed(doc, raster);
  const page = doc.addPage([raster.widthIn * PT_PER_IN, raster.heightIn * PT_PER_IN]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
  });
}

export interface InteriorOptions {
  /**
   * Total interior pages the finished PDF must contain.
   *
   * The order is priced, and the cover's spine is sized, from the page count
   * normalized to the binding's minimum and step — so the PDF has to actually
   * contain that many pages. Short of it, the printer is being handed a
   * different book from the one the customer paid for, with a spine cut for a
   * thickness it doesn't have.
   */
  padToPages?: number;
}

/**
 * The print interior: one bleed-sized page per leaf, in reading order, padded
 * with blanks to the ordered page count.
 *
 * Covers are NOT included — they ship as a separate wraparound file.
 */
export async function buildInteriorPdf(
  pages: RasterPage[],
  opts: InteriorOptions = {},
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("There are no interior pages to print.");
  const doc = await PDFDocument.create();
  for (const raster of pages) await addRasterPage(doc, raster);

  const target = opts.padToPages ?? 0;
  if (target > pages.length) {
    // Blank leaves match the last page's size so every sheet in the file is
    // identical — a printer rejects an interior whose pages disagree.
    const { widthIn, heightIn } = pages[pages.length - 1];
    for (let i = pages.length; i < target; i++) {
      doc.addPage([widthIn * PT_PER_IN, heightIn * PT_PER_IN]);
    }
  }
  return doc.save();
}

/**
 * The digital edition: front cover, every content page, back cover — at trim
 * size, since nothing is cut off a screen.
 *
 * Spreads stay whole here rather than being split into leaves: on a screen a
 * double-page illustration is better seen as one wide page than as two halves
 * the reader has to mentally staple together.
 */
export async function buildEbookPdf(pages: RasterPage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("There are no pages to include in the ebook.");
  const doc = await PDFDocument.create();
  for (const raster of pages) await addRasterPage(doc, raster);
  return doc.save();
}

export interface CoverPanels {
  /** Front panel: trim plus its outer bleed. */
  front: RasterPage;
  /** Back panel, same size. Optional — a book may have no back-cover art. */
  back?: RasterPage;
  /**
   * The spine band, pre-rendered at the width the provider asked for. Optional:
   * a thin book has no printable spine, and a book with no title on it needs
   * no band of its own.
   */
  spine?: RasterPage;
}

export interface CoverOptions {
  /** Total wraparound size the provider returned, in inches (bleed included). */
  widthIn: number;
  heightIn: number;
  /** Panel width (trim + outer bleed), in inches. */
  panelWidthIn: number;
  /** Fallback fill behind everything, as an RGB triple in 0..1. */
  background?: { r: number; g: number; b: number };
}

/**
 * The wraparound cover: `[back][spine][front]` on one page sized to the
 * provider's own cover dimensions.
 *
 * Panels are pinned to the OUTER edges and the spine is centred in whatever is
 * left, so the seams land where the provider expects them however the spine
 * width came out for this page count and binding.
 */
export async function buildCoverPdf(
  panels: CoverPanels,
  opts: CoverOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const width = opts.widthIn * PT_PER_IN;
  const height = opts.heightIn * PT_PER_IN;
  const page = doc.addPage([width, height]);
  const panelWidth = opts.panelWidthIn * PT_PER_IN;

  const bg = opts.background;
  if (bg) {
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(bg.r, bg.g, bg.b) });
  }

  const spineX = panelWidth;
  const spineWidth = Math.max(0, width - panelWidth * 2);

  if (panels.spine && spineWidth > 0) {
    const image = await embed(doc, panels.spine);
    page.drawImage(image, { x: spineX, y: 0, width: spineWidth, height });
  }
  if (panels.back) {
    const image = await embed(doc, panels.back);
    page.drawImage(image, { x: 0, y: 0, width: panelWidth, height });
  }
  const front = await embed(doc, panels.front);
  page.drawImage(front, { x: width - panelWidth, y: 0, width: panelWidth, height });

  return doc.save();
}
