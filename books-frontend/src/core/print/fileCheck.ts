/**
 * Is the PDF pair we're about to pay a printer to make the book we sold?
 *
 * The provider fetches the files minutes after the job is accepted and rejects
 * a mismatch then — after the customer has been charged. Everything checkable
 * from the files' own geometry is checked here, BEFORE payment:
 *
 *   - the interior has exactly the ordered page count (the price and the spine
 *     are cut from it, so a different count is a different book),
 *   - every interior page is the same bleed-sized sheet (printers reject mixed
 *     sizes),
 *   - the cover is one page, the size the provider's own cover-dimensions call
 *     says this book at this page count needs.
 *
 * Pure: facts in, problems out. Reading the PDFs and asking the provider is the
 * caller's job (`functions/src/printPreflight.ts`), which keeps this testable
 * without a network or a PDF library.
 */

const PT_PER_IN = 72;

/** Page-size slack, inches. PDF points round; a printer's tolerance is looser. */
export const INTERIOR_SIZE_TOLERANCE_IN = 0.02;
/** Cover slack is a little wider: it's derived from millimetres reported in points. */
export const COVER_SIZE_TOLERANCE_IN = 0.03;

export interface PdfFacts {
  /** One entry per page, in PDF points. */
  pages: Array<{ widthPt: number; heightPt: number }>;
}

export interface PrintFileExpectation {
  /** Page count the order was priced and the spine cut for. */
  pages: number;
  /** Interior sheet size: trim plus bleed on all four edges, inches. */
  interiorSizeIn?: { widthIn: number; heightIn: number };
  /** The provider's cover size for this SKU and page count, inches. */
  coverSizeIn?: { widthIn: number; heightIn: number };
}

function near(actualPt: number, expectedIn: number, toleranceIn: number): boolean {
  return Math.abs(actualPt / PT_PER_IN - expectedIn) <= toleranceIn;
}

function inches(pt: number): string {
  return (pt / PT_PER_IN).toFixed(3);
}

/** Every reason these files shouldn't be sent to print. Empty means they can be. */
export function checkPrintFiles(
  files: { interior: PdfFacts; cover: PdfFacts },
  expected: PrintFileExpectation,
): string[] {
  const problems: string[] = [];
  const { interior, cover } = files;

  if (interior.pages.length !== expected.pages) {
    problems.push(
      `interior has ${interior.pages.length} pages, but the order is for ${expected.pages}`,
    );
  }

  const first = interior.pages[0];
  if (!first) {
    problems.push("interior has no pages");
  } else {
    const mixed = interior.pages.findIndex(
      (p) => Math.abs(p.widthPt - first.widthPt) > 1 || Math.abs(p.heightPt - first.heightPt) > 1,
    );
    if (mixed >= 0) {
      const p = interior.pages[mixed];
      problems.push(
        `interior page ${mixed + 1} is ${inches(p.widthPt)}×${inches(p.heightPt)}″ but page 1 is ${inches(first.widthPt)}×${inches(first.heightPt)}″`,
      );
    }
    const want = expected.interiorSizeIn;
    if (
      want &&
      (!near(first.widthPt, want.widthIn, INTERIOR_SIZE_TOLERANCE_IN) ||
        !near(first.heightPt, want.heightIn, INTERIOR_SIZE_TOLERANCE_IN))
    ) {
      problems.push(
        `interior pages are ${inches(first.widthPt)}×${inches(first.heightPt)}″, expected ${want.widthIn.toFixed(3)}×${want.heightIn.toFixed(3)}″`,
      );
    }
  }

  if (cover.pages.length !== 1) {
    problems.push(`cover has ${cover.pages.length} pages, expected 1`);
  } else {
    const page = cover.pages[0];
    const want = expected.coverSizeIn;
    if (
      want &&
      (!near(page.widthPt, want.widthIn, COVER_SIZE_TOLERANCE_IN) ||
        !near(page.heightPt, want.heightIn, COVER_SIZE_TOLERANCE_IN))
    ) {
      problems.push(
        `cover is ${inches(page.widthPt)}×${inches(page.heightPt)}″, the printer needs ${want.widthIn.toFixed(3)}×${want.heightIn.toFixed(3)}″`,
      );
    }
  }

  return problems;
}
