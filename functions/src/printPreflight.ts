/**
 * Verify the print PDFs BEFORE the customer pays.
 *
 * `checkPrintFiles` (shared, pure) decides; this module gathers the facts — the
 * PDFs' real page counts and sizes, the provider's cover size for this SKU and
 * page count — and applies it. A mismatch found here is a retryable "we'll
 * prepare your book again"; found after payment it is a rejected print job and
 * a refund.
 *
 * The provider's cover size is fetched best-effort: if the provider can't be
 * asked right now we still check everything the files themselves can tell us,
 * rather than blocking checkout on an unrelated outage.
 */
import { PDFDocument } from "pdf-lib";
import { logger } from "firebase-functions/v2";
import {
  checkPrintFiles,
  type PdfFacts,
  type PrintFileExpectation,
} from "../../books-frontend/src/core/print/fileCheck";
import { findBookProduct } from "../../books-frontend/src/core/fulfillment/lulu/products";
import { fulfillmentProvider } from "./lulu";

const MM_PER_IN = 25.4;
/** A 400-page book at print resolution is large but not this large. */
const MAX_PDF_BYTES = 400 * 1024 * 1024;

async function readPdfFacts(url: string): Promise<PdfFacts> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_PDF_BYTES) throw new Error("file is too large to check");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error("file is too large to check");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  return {
    pages: doc.getPages().map((p) => {
      const { width, height } = p.getSize();
      return { widthPt: width, heightPt: height };
    }),
  };
}

export interface PreflightArgs {
  interiorUrl: string;
  coverUrl: string;
  /** The composed variant SKU that will be ordered. */
  printSku: string;
  /** The format's base SKU — where the trim and bleed come from. */
  baseSku: string;
  pages: number;
}

/**
 * Problems with the files, or `[]` when they match the order. Never throws: a
 * file we can't even parse is itself a problem worth reporting.
 */
export async function preflightPrintFiles(args: PreflightArgs): Promise<string[]> {
  let interior: PdfFacts;
  let cover: PdfFacts;
  try {
    [interior, cover] = await Promise.all([readPdfFacts(args.interiorUrl), readPdfFacts(args.coverUrl)]);
  } catch (err) {
    return [`couldn't read the print files (${err instanceof Error ? err.message : "unknown error"})`];
  }

  const expected: PrintFileExpectation = { pages: args.pages };
  const book = findBookProduct(args.baseSku) ?? findBookProduct(args.printSku);
  if (book) {
    expected.interiorSizeIn = {
      widthIn: book.trim.widthIn + book.bleedIn * 2,
      heightIn: book.trim.heightIn + book.bleedIn * 2,
    };
  }
  try {
    const dims = await fulfillmentProvider().getCoverDimensionsMm(args.printSku, args.pages);
    expected.coverSizeIn = { widthIn: dims.widthMm / MM_PER_IN, heightIn: dims.heightMm / MM_PER_IN };
  } catch (err) {
    logger.warn("[preflight] cover dimensions unavailable; checking the files alone", err);
  }

  return checkPrintFiles({ interior, cover }, expected);
}
