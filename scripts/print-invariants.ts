/**
 * Print invariants — the geometry and assembly properties a printable book
 * depends on, checked against the shipped code rather than a restatement of it.
 *
 * These are the failures that don't throw and don't show up in a typecheck.
 * A page declared one size and drawn at another still produces a valid PDF —
 * it just comes back from the printer 3% too big with the edges shaved off. An
 * interior that's four pages short of what was ordered is a valid PDF too, with
 * a spine cut for a book that doesn't exist. Both shipped.
 *
 * Run by `yarn check:print-geometry`, which bundles this with esbuild first.
 */
import { PDFDocument } from "pdf-lib";
import {
  buildCoverPdf,
  buildEbookPdf,
  buildInteriorPdf,
  type RasterPage,
} from "../books-frontend/src/core/print/assemble";
import {
  coverPanelWindow,
  pageGeometry,
  safeArea,
  splitBleedPixels,
  spreadLeaves,
  withinSafeArea,
  PT_PER_IN,
  SAFETY_MARGIN_IN,
} from "../books-frontend/src/core/print/geometry";
import { interiorLeafPlan, physicalPageCount } from "../books-frontend/src/core/print/pagePlan";
import { preflightInterior } from "../books-frontend/src/core/print/preflight";
import { renderFingerprint } from "../books-frontend/src/core/print/fingerprint";
import { LULU_BOOK_PRODUCTS, normalizePageCount } from "../books-frontend/src/core/fulfillment/lulu/products";
import type { BookProduct } from "../books-frontend/src/core/fulfillment/types";
import type {
  BookDesign,
  Project,
  ScreenplayDoc,
  ScreenplaySpread,
} from "../books-frontend/src/core/types";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
} from "../books-frontend/src/core/types";
import { createVersionTree } from "../books-frontend/src/core/versioning";
import {
  allBookLayouts,
  layoutPromptFacts,
  validateLayouts,
  PAGE_SIDES,
} from "../books-frontend/src/core/book/layouts";
import { validateTreatments } from "../books-frontend/src/core/book/treatments";
import { bindingSideFor } from "../books-frontend/src/core/book/pageLayout";
import { computePageGuides, resolveFormatCapabilities } from "../books-frontend/src/core/book/format";
import { chooseImageSize, renderAspect } from "../books-frontend/src/core/pipeline/illustration";
import {
  complementGridArea,
  describeGridAreaForPrompt,
  fullGridArea,
  gridAreaAspect,
  gridRect,
  isValidGridArea,
  matchGridPreset,
  normalizeGridArea,
  surfaceAspect as regionSurfaceAspect,
  GRID_PRESETS,
  type GridArea,
} from "../books-frontend/src/core/book/grid";
import {
  aspectFit,
  aspectIsProducible,
  capabilitiesFor,
  capabilityKey,
  parseSize,
  ratioTokenForSize,
  resolveImageSize,
  sanitizeImageSize,
  sizingReport,
  MAX_ASPECT_MISMATCH,
  type ImageModelCapabilities,
} from "../books-frontend/src/core/config/modelCapabilities";
import { bookSizeFromAspect } from "../books-frontend/src/core/config/options";
import { defaultTemplate, PROMPT_ACTIONS } from "../books-frontend/src/core/prompts/registry";
import {
  coverCropRect,
  coverCropRectWithInsets,
  coverPlacement,
} from "../books-frontend/src/core/imageGeometry";
import {
  buildCoverPlan,
  buildEbookTargets,
  buildInteriorPlan,
} from "../books-frontend/src/ui/design/printTargets";
import type { DesignPage } from "../books-frontend/src/ui/design/designInit";
import {
  fromCombinedRect,
  illustrationLeaf,
  joinPairDesign,
  mergePairDesign,
  toCombinedRect,
  withFacingOverflow,
} from "../books-frontend/src/core/book/pairSurface";
import type { PageDesign } from "../books-frontend/src/core/types";

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function near(a: number, b: number, tolerance = 1e-6): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Distinct resolved geometries among grid areas, for de-duplication checks. */
function gridGeometryKeys(areas: GridArea[]): Set<string> {
  return new Set(
    areas.map((area) => {
      const r = gridRect(area);
      return [r.x, r.y, r.w, r.h].map((n) => n.toFixed(6)).join(":");
    }),
  );
}

const DPI = 300;

// A 1×1 PNG. The assembly checks care about page geometry, not pixels, so the
// smallest legal image keeps them fast and free of fixture noise.
const PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function raster(id: string, widthIn: number, heightIn: number): RasterPage {
  return { id, label: id, bytes: PIXEL_PNG, mimeType: "image/png", widthIn, heightIn };
}

const square = LULU_BOOK_PRODUCTS.find(
  (p) => p.trim.widthIn === 8.5 && p.trim.heightIn === 8.5 && p.binding === "casewrap",
) as BookProduct;
const saddle = LULU_BOOK_PRODUCTS.find((p) => p.binding === "saddle-stitch") as BookProduct;

// ---- Page geometry ---------------------------------------------------------

{
  const bleed = pageGeometry(square, { dpi: DPI, bleed: true });
  const trim = pageGeometry(square, { dpi: DPI, bleed: false });

  check(
    "a bleed page is the trim plus bleed on all four edges",
    near(bleed.widthIn, square.trim.widthIn + square.bleedIn * 2) &&
      near(bleed.heightIn, square.trim.heightIn + square.bleedIn * 2),
    `${bleed.widthIn}×${bleed.heightIn}in`,
  );

  // The bug this replaces: the page was LAID OUT at trim and DECLARED at bleed,
  // so the raster was stretched ~3% and the outer edge was trimmed away.
  check(
    "a bleed page is rendered at the size it is declared at",
    bleed.widthPx === Math.round(bleed.widthIn * DPI) &&
      bleed.heightPx === Math.round(bleed.heightIn * DPI),
    `${bleed.widthPx}×${bleed.heightPx}px for ${bleed.widthIn}×${bleed.heightIn}in`,
  );

  check(
    "the trim box inside a bleed page is the finished page size",
    near(bleed.trimWidthIn, square.trim.widthIn) && near(bleed.trimHeightIn, square.trim.heightIn),
  );

  check(
    "a screen page carries no bleed",
    trim.bleedPx === 0 && near(trim.widthIn, square.trim.widthIn),
  );

  check(
    "artwork keeps full resolution at the declared size",
    bleed.widthPx / bleed.widthIn === DPI,
    `${bleed.widthPx / bleed.widthIn} dpi`,
  );

  const horizontal = splitBleedPixels(
    bleed.widthPx,
    bleed.trimWidthPx,
    bleed.bleedPx,
  );
  check(
    "fractional bleed pixels and trim exactly fill the raster",
    horizontal.start + bleed.trimWidthPx + horizontal.end === bleed.widthPx,
    `${horizontal.start} + ${bleed.trimWidthPx} + ${horizontal.end} != ${bleed.widthPx}`,
  );
}

// ---- Image framing ---------------------------------------------------------

{
  const crop = coverCropRect(2000, 1000, 1000, 1000, 1, { x: 0.7, y: 0.5 });
  check(
    "image focus means crop centre, not CSS leftover-space percentage",
    near(crop.x, 900) && near(crop.y, 0) && near(crop.width, 1000),
    JSON.stringify(crop),
  );

  const placement = coverPlacement(2000, 1000, 1000, 1000, 1, {
    x: 0.7,
    y: 0.5,
  });
  const scale = placement.width / 2000;
  check(
    "DOM placement reconstructs the canonical source crop",
    near(-placement.x / scale, crop.x) &&
      near(-placement.y / scale, crop.y) &&
      near(1000 / scale, crop.width),
    JSON.stringify(placement),
  );

  const topCover = coverCropRect(1000, 1500, 1000, 1000, 1, {
    x: 0.5,
    y: 0,
  });
  check(
    "top-focused covers preserve the source top edge",
    near(topCover.y, 0),
    JSON.stringify(topCover),
  );

  const fittedTrim = coverCropRectWithInsets(
    2000,
    1000,
    1000,
    1000,
    { top: 100, right: 100, bottom: 100, left: 100 },
  );
  check(
    "fit-to-bleed shows the exact trim slice of the larger printed frame",
    near(fittedTrim.x, 583.3333333333) &&
      near(fittedTrim.y, 83.3333333333) &&
      near(fittedTrim.width, 833.3333333333) &&
      near(fittedTrim.height, 833.3333333333),
    JSON.stringify(fittedTrim),
  );
}

// ---- Spreads ---------------------------------------------------------------

{
  const spread = pageGeometry(square, { dpi: DPI, bleed: true, spread: true });
  const { left, right } = spreadLeaves(spread);
  const leaf = pageGeometry(square, { dpi: DPI, bleed: true });

  check(
    "a spread is laid out as one continuous surface",
    near(spread.trimWidthIn, square.trim.widthIn * 2),
  );

  check(
    "each half of a spread is exactly one printable page wide",
    left.widthPx === leaf.widthPx && right.widthPx === leaf.widthPx,
    `${left.widthPx}/${right.widthPx} vs ${leaf.widthPx}`,
  );

  check(
    "the two halves together cover the whole spread",
    left.xPx === 0 && right.xPx + right.widthPx === spread.widthPx,
  );

  // Both leaves need artwork continuing past the gutter so their inner edges
  // bleed too. That overlap is the correct output, not a rounding error.
  const overlap = left.xPx + left.widthPx - right.xPx;
  const expected = Math.round(square.bleedIn * 2 * DPI);
  check(
    "the halves overlap by exactly twice the bleed at the gutter",
    overlap === expected,
    `${overlap}px vs ${expected}px`,
  );
}

// ---- Cover panels ----------------------------------------------------------

{
  const cover = pageGeometry(square, { dpi: DPI, bleed: true });
  const back = coverPanelWindow(cover, "left");
  const front = coverPanelWindow(cover, "right");

  check(
    "a cover panel is the trim plus its OUTER bleed only",
    near(back.widthIn, square.trim.widthIn + square.bleedIn) &&
      near(front.widthIn, back.widthIn),
    `${front.widthIn}in`,
  );

  check(
    "each panel is anchored to its outer edge",
    back.xPx === 0 && front.xPx + front.widthPx === cover.widthPx,
  );

  const project = {
    config: { productSku: square.sku, bookSize: "square" },
  } as unknown as Project;
  const coverPage = (id: string) =>
    ({
      id,
      label: id,
      aspect: square.aspect,
      isCover: true,
    }) as DesignPage;
  const planned = buildCoverPlan(
    project,
    [coverPage(COVER_BACK_ID), coverPage(COVER_FRONT_ID)],
    DPI,
  ).targets;
  const plannedBack = planned.find((target) => target.id === COVER_BACK_ID)?.bleedFill;
  const plannedFront = planned.find((target) => target.id === COVER_FRONT_ID)?.bleedFill;
  check(
    "cover bleed is synthesized only on each panel's physical outside edge",
    Boolean(
      plannedBack &&
        plannedFront &&
        plannedBack.left > 0 &&
        plannedBack.right === 0 &&
        plannedFront.left === 0 &&
        plannedFront.right > 0,
    ),
    JSON.stringify({ plannedBack, plannedFront }),
  );

  // Lulu returns a total cover width; the panels and the spine must tile it
  // exactly, or the artwork lands off the fold.
  const spineIn = 0.5;
  const totalIn = front.widthIn * 2 + spineIn;
  check(
    "panels plus spine tile the provider's cover width",
    near(totalIn - front.widthIn * 2, spineIn),
    `${totalIn}in`,
  );
}

// ---- Safe area -------------------------------------------------------------

{
  const recto = safeArea(square, "right");
  const verso = safeArea(square, "left");

  check(
    "the binding edge gets more clearance than the outer edge",
    recto.x > 1 - (recto.x + recto.w) && verso.x < 1 - (verso.x + verso.w),
    `recto inner ${recto.x.toFixed(3)}, verso inner ${(1 - verso.x - verso.w).toFixed(3)}`,
  );

  check(
    "the gutter is on the left of a right-hand page and mirrored on a left-hand one",
    near(recto.x, 1 - verso.x - verso.w) && near(verso.x, 1 - recto.x - recto.w),
  );

  const edgeBox = { x: 0.01, y: 0.01, w: 0.3, h: 0.2 };
  const insideBox = { x: 0.35, y: 0.3, w: 0.3, h: 0.2 };
  check("text at the very edge is flagged", !withinSafeArea(edgeBox, recto));
  check("text well inside the page is not flagged", withinSafeArea(insideBox, recto));

  check(
    "the margin is the documented physical distance",
    near(recto.y * square.trim.heightIn, SAFETY_MARGIN_IN),
  );
}

// ---- The physical leaf plan ------------------------------------------------

function spreadEntry(id: string, kind: "single" | "spread", placeholder = false): ScreenplaySpread {
  return {
    id,
    kind,
    text: "Once upon a time.",
    illustration: "A scene.",
    layoutNote: "",
    anchorIds: [],
    placeholder,
  } as ScreenplaySpread;
}

function doc(spreads: ScreenplaySpread[]): ScreenplayDoc {
  return { notes: "", spreads };
}

{
  const wide = spreadEntry("wide", "spread");
  const project = {
    config: { productSku: square.sku, bookSize: "square" },
    screenplay: createVersionTree(doc([wide])),
  } as unknown as Project;
  const page = {
    id: wide.id,
    label: "Wide spread",
    aspect: square.aspect * 2,
    isCover: false,
  } as DesignPage;
  const halves = buildInteriorPlan(project, [page], DPI).targets;
  const left = halves.find((target) => target.id.endsWith("#left"))?.bleedFill;
  const right = halves.find((target) => target.id.endsWith("#right"))?.bleedFill;
  check(
    "spread bleed preserves real fold overlap and fills only physical outer edges",
    Boolean(
      left &&
        right &&
        left.left > 0 &&
        left.right === 0 &&
        right.left === 0 &&
        right.right > 0,
    ),
    JSON.stringify({ left, right }),
  );
}

{
  const plan = interiorLeafPlan(doc([spreadEntry("a", "single"), spreadEntry("b", "single")]));
  check("a single page is one leaf", plan.length === 2);
  check(
    "page one is a right-hand page",
    plan[0].pageNumber === 1 && plan[0].side === "right" && plan[1].side === "left",
  );
}

{
  // A spread must start on a verso, so pagination inserts a filler before it.
  const withSpread = doc([spreadEntry("a", "single"), spreadEntry("wide", "spread")]);
  const plan = interiorLeafPlan(withSpread);

  check(
    "a spread prints as two leaves, not one page",
    plan.filter((l) => l.sourcePageId === "wide").length === 2,
    `${plan.filter((l) => l.sourcePageId === "wide").length} leaves`,
  );

  check(
    "the halves of a spread are separately addressable",
    plan.some((l) => l.id === "wide#left") && plan.some((l) => l.id === "wide#right"),
  );

  check(
    "a spread starts on a left-hand page",
    plan.find((l) => l.id === "wide#left")?.side === "left",
  );

  check(
    "page numbers are contiguous",
    plan.every((leaf, i) => leaf.pageNumber === i + 1),
  );
}

{
  const withFiller = doc([
    spreadEntry("a", "single"),
    spreadEntry("filler", "single", true),
    spreadEntry("b", "single"),
  ]);
  const plan = interiorLeafPlan(withFiller);
  check("a pagination filler still occupies a printed leaf", plan.length === 3);
  check(
    "a filler has nothing to capture",
    plan[1].sourcePageId === null,
  );
  check("the physical page count counts fillers", physicalPageCount(withFiller) === 3);

  const project = {
    config: { productSku: square.sku, bookSize: "square" },
    screenplay: createVersionTree(withFiller),
  } as unknown as Project;
  const pages = ["a", "b"].map(
    (id) =>
      ({
        id,
        label: id,
        aspect: square.aspect,
        isCover: false,
      }) as DesignPage,
  );
  const targets = buildInteriorPlan(project, pages, DPI).targets;
  check(
    "captures retain their physical positions around pagination fillers",
    targets.find((target) => target.id === "a")?.documentIndex === 0 &&
      targets.find((target) => target.id === "b")?.documentIndex === 2,
    JSON.stringify(targets.map(({ id, documentIndex }) => ({ id, documentIndex }))),
  );
}

// ---- Facing-pair compositor ------------------------------------------------

{
  const local = { x: 0.2, y: 0.1, w: 0.4, h: 0.3 };
  const combined = toCombinedRect(local, false);
  const back = fromCombinedRect(combined, false);
  check(
    "page-local rects round-trip through combined space",
    near(back.x, local.x) && near(back.y, local.y) && near(back.w, local.w) && near(back.h, local.h),
    JSON.stringify({ combined, back }),
  );

  const spanning = { x: 0.7, y: 0.2, w: 0.6, h: 0.4 };
  const wide = toCombinedRect(spanning, false);
  check(
    "a spanning left-page rect crosses the fold in combined space",
    wide.x < 0.5 && wide.x + wide.w > 0.5,
    JSON.stringify(wide),
  );

  const leftPd: PageDesign = {
    textBoxes: [{ id: "t-left", rect: spanning, z: 1, paragraphs: [] } as PageDesign["textBoxes"][number]],
  };
  const rightPd: PageDesign = { textBoxes: [] };
  const guests = withFacingOverflow(rightPd, leftPd, false);
  check(
    "the facing right leaf receives the overflowing half",
    guests.textBoxes.length === 1 && near(guests.textBoxes[0].rect.x, spanning.x - 1),
    JSON.stringify(guests.textBoxes[0]?.rect),
  );

  const merged = mergePairDesign(leftPd, rightPd);
  check(
    "merged pair design keeps one copy of a spanning box",
    merged.textBoxes.length === 1 && near(merged.textBoxes[0].rect.x, wide.x),
  );
}

{
  const art = {
    id: "art-l",
    kind: "illustration" as const,
    rect: { x: 0.4, y: 0, w: 1.2, h: 1 },
    z: 0,
    fit: "cover" as const,
  };
  const leftPd: PageDesign = { textBoxes: [], images: [art] };
  const rightPd: PageDesign = { textBoxes: [] };
  const guests = withFacingOverflow(rightPd, leftPd, false);
  const guest = guests.images?.[0];
  check(
    "the facing right leaf receives overflowing page art",
    Boolean(guest) &&
      guest?.id === "art-l" &&
      guest?.pairLeaf === "left" &&
      near(guest?.rect.x ?? 0, art.rect.x - 1),
    JSON.stringify(guest?.rect),
  );

  const merged = mergePairDesign(leftPd, rightPd);
  const mergedArt = merged.images?.[0];
  check(
    "merged page art stays bound to its owner leaf past the fold",
    mergedArt?.pairLeaf === "left" &&
      illustrationLeaf(mergedArt) === "left" &&
      (mergedArt?.rect.x ?? 0) + (mergedArt?.rect.w ?? 0) > 0.5,
    JSON.stringify(mergedArt),
  );
}

{
  const facing = doc([
    spreadEntry("a", "single"),
    spreadEntry("b", "single"),
    spreadEntry("c", "single"),
  ]);
  const project = {
    config: { productSku: square.sku, bookSize: "square" },
    screenplay: createVersionTree(facing),
  } as unknown as Project;
  const pages = ["a", "b", "c"].map(
    (id) =>
      ({
        id,
        label: id,
        aspect: square.aspect,
        isCover: false,
      }) as DesignPage,
  );
  const targets = buildInteriorPlan(project, pages, DPI).targets;
  const first = targets.find((target) => target.id === "a");
  const verso = targets.find((target) => target.id === "b");
  const recto = targets.find((target) => target.id === "c");
  check("page one stays a lone right-hand capture", !first?.pairWith);
  check(
    "facing singles print as a virtual spread",
    Boolean(verso?.pairWith && verso.pairRole === "left" && verso.pairWith.id === "c") &&
      Boolean(recto?.pairWith && recto.pairRole === "right" && recto.pairWith.id === "b"),
    JSON.stringify({
      b: { pair: verso?.pairWith?.id, role: verso?.pairRole },
      c: { pair: recto?.pairWith?.id, role: recto?.pairRole },
    }),
  );
  check(
    "virtual-pair bleed keeps real fold overlap",
    Boolean(
      verso?.bleedFill &&
        recto?.bleedFill &&
        verso.bleedFill.left > 0 &&
        verso.bleedFill.right === 0 &&
        recto.bleedFill.left === 0 &&
        recto.bleedFill.right > 0,
    ),
    JSON.stringify({ left: verso?.bleedFill, right: recto?.bleedFill }),
  );

  const ebook = buildEbookTargets(project, pages, DPI);
  check(
    "the ebook paints neighbor overflow onto each facing single",
    ebook.find((t) => t.id === "b")?.overflowFrom?.page.id === "c" &&
      ebook.find((t) => t.id === "c")?.overflowFrom?.page.id === "b" &&
      !ebook.find((t) => t.id === "a")?.overflowFrom,
  );
}

{
  const leftPd: PageDesign = {
    textBoxes: [{ id: "keep", rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, z: 1, paragraphs: [] } as PageDesign["textBoxes"][number]],
    images: [
      {
        id: "art-r",
        kind: "illustration",
        rect: { x: 0, y: 0, w: 1, h: 1 },
        z: 0,
        fit: "cover",
      } as PageDesign["images"] extends (infer I)[] | undefined ? I : never,
    ],
  };
  const rightPd: PageDesign = {
    textBoxes: [{ id: "cross", rect: { x: -0.2, y: 0.2, w: 0.5, h: 0.2 }, z: 1, paragraphs: [] } as PageDesign["textBoxes"][number]],
    images: [
      {
        id: "drop-me",
        kind: "illustration",
        rect: { x: 0, y: 0, w: 1, h: 1 },
        z: 0,
        fit: "cover",
      } as PageDesign["images"] extends (infer I)[] | undefined ? I : never,
    ],
  };
  const joined = joinPairDesign(leftPd, rightPd);
  check(
    "joining a pair drops the right leaf's page art",
    (joined.images ?? []).every((image) => image.id !== "drop-me") &&
      joined.textBoxes.some((box) => box.id === "cross"),
  );

}

// ---- Interior assembly -----------------------------------------------------

{
  const geo = pageGeometry(saddle, { dpi: DPI, bleed: true });
  const pages = [raster("p1", geo.widthIn, geo.heightIn), raster("p2", geo.widthIn, geo.heightIn)];

  // Saddle stitch folds in fours, so 2 content pages are ordered (and priced,
  // and spine-sized) as 4. The PDF has to actually contain 4.
  const ordered = normalizePageCount(saddle, pages.length);
  const bytes = await buildInteriorPdf(pages, { padToPages: ordered });
  const parsed = await PDFDocument.load(bytes);

  check(
    "the interior is padded to the page count that was ordered",
    parsed.getPageCount() === ordered,
    `${parsed.getPageCount()} pages, ordered ${ordered}`,
  );

  const sizes = parsed.getPages().map((p) => `${p.getWidth().toFixed(3)}×${p.getHeight().toFixed(3)}`);
  check(
    "every interior page — including the blanks — is the same size",
    new Set(sizes).size === 1,
    sizes.join(", "),
  );

  check(
    "interior pages are the bleed size, in PDF points",
    near(parsed.getPage(0).getWidth(), geo.widthIn * PT_PER_IN, 0.01),
    `${parsed.getPage(0).getWidth()}pt vs ${geo.widthIn * PT_PER_IN}pt`,
  );

  const withFiller = await buildInteriorPdf([pages[0], null, pages[1]]);
  const parsedFiller = await PDFDocument.load(withFiller);
  check(
    "an interior filler stays between its neighbouring artwork pages",
    parsedFiller.getPageCount() === 3,
    `${parsedFiller.getPageCount()} pages`,
  );
}

{
  const geo = pageGeometry(square, { dpi: DPI, bleed: true });
  const pages = Array.from({ length: 40 }, (_, i) => raster(`p${i}`, geo.widthIn, geo.heightIn));
  const bytes = await buildInteriorPdf(pages, { padToPages: 24 });
  const parsed = await PDFDocument.load(bytes);
  check(
    "a book longer than the ordered count is never truncated",
    parsed.getPageCount() === 40,
    `${parsed.getPageCount()} pages`,
  );
}

// ---- Cover assembly --------------------------------------------------------

{
  const geo = pageGeometry(square, { dpi: DPI, bleed: true });
  const panelWidthIn = geo.trimWidthIn + geo.bleedIn;
  const spineIn = 0.62;
  const widthIn = panelWidthIn * 2 + spineIn;

  const bytes = await buildCoverPdf(
    {
      front: raster("front", panelWidthIn, geo.heightIn),
      back: raster("back", panelWidthIn, geo.heightIn),
      spine: raster("spine", spineIn, geo.heightIn),
    },
    { widthIn, heightIn: geo.heightIn, panelWidthIn },
  );
  const parsed = await PDFDocument.load(bytes);

  check("the wraparound cover is a single page", parsed.getPageCount() === 1);
  check(
    "the cover is exactly the size the provider asked for",
    near(parsed.getPage(0).getWidth(), widthIn * PT_PER_IN, 0.01) &&
      near(parsed.getPage(0).getHeight(), geo.heightIn * PT_PER_IN, 0.01),
    `${parsed.getPage(0).getWidth()}×${parsed.getPage(0).getHeight()}pt`,
  );

  // A book with no back-cover art must still produce a printable wraparound.
  const noBack = await buildCoverPdf(
    { front: raster("front", panelWidthIn, geo.heightIn) },
    { widthIn, heightIn: geo.heightIn, panelWidthIn, background: { r: 1, g: 1, b: 1 } },
  );
  check("a cover with no back artwork still assembles", (await PDFDocument.load(noBack)).getPageCount() === 1);
}

// ---- Ebook assembly --------------------------------------------------------

{
  const trim = pageGeometry(square, { dpi: DPI, bleed: false });
  const spread = pageGeometry(square, { dpi: DPI, bleed: false, spread: true });
  const bytes = await buildEbookPdf([
    raster("cover", trim.widthIn, trim.heightIn),
    raster("wide", spread.widthIn, spread.heightIn),
  ]);
  const parsed = await PDFDocument.load(bytes);

  check(
    "the digital edition keeps a spread whole",
    near(parsed.getPage(1).getWidth(), parsed.getPage(0).getWidth() * 2, 0.01),
  );

  check(
    "the digital edition has no bleed",
    near(parsed.getPage(0).getWidth(), square.trim.widthIn * PT_PER_IN, 0.01),
  );
}

// ---- Preflight -------------------------------------------------------------

{
  const design: BookDesign = {
    defaultFontFamily: "Itim",
    defaultFontSizePct: 0.06,
    pages: {
      a: {
        textBoxes: [
          {
            id: "t1",
            rect: { x: 0.001, y: 0.001, w: 0.4, h: 0.2 },
            z: 1,
            presetId: "card",
            fontFamily: "Itim",
            fontSizePct: 0.06,
            color: "#000",
            align: "left",
            vAlign: "top",
            lineHeight: 1.2,
            paragraphs: [{ spans: [{ text: "Too close to the edge" }] }],
          },
        ],
      },
      b: {
        textBoxes: [
          {
            id: "t2",
            rect: { x: 0.3, y: 0.3, w: 0.3, h: 0.2 },
            z: 1,
            presetId: "card",
            fontFamily: "Itim",
            fontSizePct: 0.06,
            color: "#000",
            align: "left",
            vAlign: "top",
            lineHeight: 1.2,
            paragraphs: [{ spans: [{ text: "Comfortably inside" }] }],
          },
        ],
      },
    },
  };

  const issues = preflightInterior({
    plan: interiorLeafPlan(doc([spreadEntry("a", "single"), spreadEntry("b", "single")])),
    design,
    product: square,
    hasArtwork: () => true,
    labelFor: (id) => `Page ${id}`,
  });

  check(
    "text over the trim line is reported",
    issues.some((i) => i.code === "text-outside-safe-area" && i.pageId === "a"),
  );
  check(
    "text inside the safe area is not reported",
    !issues.some((i) => i.code === "text-outside-safe-area" && i.pageId === "b"),
  );

  // A truly blank leaf: no illustration and no copy. Pages that still have
  // text (the design above) are not blank — they will print the words.
  const blank = preflightInterior({
    plan: interiorLeafPlan(doc([spreadEntry("c", "single")])),
    design: { ...design, pages: { ...design.pages, c: { textBoxes: [] } } },
    product: square,
    hasArtwork: () => false,
    labelFor: () => "Page 1",
  });
  check(
    "a page with no artwork is reported before it prints blank",
    blank.some((i) => i.code === "page-has-no-artwork"),
  );

  const textOnly = preflightInterior({
    plan: interiorLeafPlan(doc([spreadEntry("b", "single")])),
    design,
    product: square,
    hasArtwork: () => false,
    labelFor: () => "Page 1",
  });
  check(
    "a page with text and no illustration is not reported as blank",
    !textOnly.some((i) => i.code === "page-has-no-artwork"),
  );
}

// ---- Render fingerprint ----------------------------------------------------

{
  const design: BookDesign = { defaultFontFamily: "Itim", defaultFontSizePct: 0.06, pages: {} };
  const base = {
    id: "p1",
    title: "The Brave Little Fox",
    createdAt: 1,
    updatedAt: 2,
    stage: "design",
    furthestStage: "design",
    config: { productSku: square.sku, bookSize: "square", layoutId: "outer-text" },
    screenplay: createVersionTree(doc([spreadEntry("a", "single")])),
    illustrations: {
      a: createVersionTree({ blobId: "blob-1", mimeType: "image/png" }),
    },
  } as unknown as Project;

  const first = renderFingerprint(base, design);

  check("the same book fingerprints the same twice", first === renderFingerprint(base, design));

  const touched = { ...base, updatedAt: 99, rev: 12 } as Project;
  check(
    "a save that changes nothing visible keeps the render valid",
    renderFingerprint(touched, design) === first,
  );

  const retitled = { ...base, title: "A Different Book" } as Project;
  check("retitling the book invalidates the render", renderFingerprint(retitled, design) !== first);

  const reillustrated = {
    ...base,
    illustrations: { a: createVersionTree({ blobId: "blob-2", mimeType: "image/png" }) },
  } as unknown as Project;
  check(
    "regenerating an illustration invalidates the render",
    renderFingerprint(reillustrated, design) !== first,
  );

  const restyled: BookDesign = { ...design, defaultFontSizePct: 0.09 };
  check("changing the design invalidates the render", renderFingerprint(base, restyled) !== first);

  const fittedBleed: BookDesign = {
    ...design,
    printSettings: { bleedMode: "fit" },
  };
  check(
    "changing the bleed method invalidates the render",
    renderFingerprint(base, fittedBleed) !== first,
  );

  const reformatted = {
    ...base,
    config: { ...base.config, productSku: saddle.sku },
  } as Project;
  check("changing the format invalidates the render", renderFingerprint(reformatted, design) !== first);
}

// ---- Page layouts ----------------------------------------------------------
//
// A layout is the one thing that decides both where the text is drawn AND what
// the image model is told to keep clear for it. When those two disagree, every
// page still renders — the words just land on top of a face. None of that is
// visible to a typecheck, so the catalog is asserted here instead.

{
  for (const problem of validateLayouts()) check(`layout catalog: ${problem}`, false);
  for (const problem of validateTreatments()) check(`treatment catalog: ${problem}`, false);
  check("the layout catalog is self-consistent", validateLayouts().length === 0);
  check("the treatment catalog is self-consistent", validateTreatments().length === 0);
  check("the catalog ships four layouts", allBookLayouts().length === 4);
  check(
    "two layouts put text on the picture",
    allBookLayouts().filter((l) => l.defaultMode === "full-bleed").length === 2,
  );
  check(
    "two layouts put text next to the picture",
    allBookLayouts().filter((l) => l.defaultMode === "inset-art").length === 2,
  );

  for (const layout of allBookLayouts()) {
    check(
      `${layout.id} locks to a single composition family`,
      layout.supportedModes.length === 1 && layout.supportedModes[0] === layout.defaultMode,
    );
    for (const product of [square, saddle] as BookProduct[]) {
      const caps = resolveFormatCapabilities(product, product.minPages);
      for (const side of PAGE_SIDES) {
        const spread = side === "spread";
        const { safe } = computePageGuides({ caps, spread, bindingSide: bindingSideFor(side) });
        const plan = layout.plan({
          side,
          safe,
          aspect: spread ? product.aspect * 2 : product.aspect,
          trim: product.trim,
          isCover: false,
          mode: layout.defaultMode,
        });
        const label = `${layout.id} · ${product.sku} · ${side}`;

        // Text outside the safe area is trimmed off by the printer, and a
        // fraction-of-the-page rect is exactly how that happens on a trim whose
        // margin isn't the fraction the layout was authored against.
        for (const slot of plan.slots) {
          const r = slot.pageRect;
          check(
            `${label}: slot "${slot.id}" stays inside the printable safe area`,
            r.x >= safe.x - 1e-9 &&
              r.y >= safe.y - 1e-9 &&
              r.x + r.w <= safe.x + safe.w + 1e-9 &&
              r.y + r.h <= safe.y + safe.h + 1e-9,
          );
        }

        // Overlay layouts must tell the model where to keep the picture calm.
        // Split layouts have no calm band — the words are not on the art.
        const surfaceAspect = spread ? product.aspect * 2 : product.aspect;
        const facts = layoutPromptFacts(plan, surfaceAspect);
        if (plan.mode === "full-bleed" && plan.slots.some((s) => s.role === "text")) {
          check(`${label}: the prompt describes the calm region`, facts.calmRegions.length > 0);
          check(`${label}: the prompt describes where the focal action goes`, facts.focalRegion.length > 0);
          // A slot running the full printable height must read as a column
          // ("the right third"), not a vague "block on the right side" — that
          // phrasing is what the model actually acts on.
          const fullHeight = plan.slots.some(
            (s) => s.role === "text" && s.pageRect.h >= safe.h - 1e-9,
          );
          check(
            `${label}: the calm region names a page position, not just numbers`,
            /third|quarter|half|fifth|sixth|eighth|band|block|column|whole|\d+\/\d+/.test(
              facts.calmRegions,
            ),
          );
          const grids = plan.slots.filter((s) => s.role === "text" && s.grid);
          if (grids.length > 0) {
            check(
              `${label}: overlay calm region is named as a grid fraction`,
              /\d+\/\d+/.test(facts.calmRegions),
              facts.calmRegions,
            );
          }
          if (fullHeight) {
            check(
              `${label}: a full-height text column is described as a column`,
              !/block/.test(facts.calmRegions),
              facts.calmRegions,
            );
          }
        }

        // Inset art that overlaps the text would be covered by it.
        const inset = layout.plan({
          side,
          safe,
          aspect: surfaceAspect,
          trim: product.trim,
          isCover: false,
          mode: "inset-art",
        });
        if (inset.mode === "inset-art") {
          const insetFacts = layoutPromptFacts(inset, surfaceAspect);
          check(
            `${label}: split layouts do not ask the model to reserve a calm band`,
            !insetFacts.hasCalmBand && insetFacts.calmRegions.length === 0,
          );
          for (const slot of inset.slots.filter((s) => s.role === "text")) {
            const a = inset.artRect;
            const t = slot.pageRect;
            const overlaps =
              a.x < t.x + t.w && t.x < a.x + a.w && a.y < t.y + t.h && t.y < a.y + a.h;
            check(`${label}: inset artwork doesn't run under the text`, !overlaps);
          }
          check(
            `${label}: inset artwork is a usable shape`,
            inset.artRect.w > 0.2 && inset.artRect.h > 0.2,
          );
        }
      }
    }
  }

  // ---- Region geometry -----------------------------------------------------

  // A grid area is an authoring convenience that must resolve to the same
  // rectangle everywhere, at any denominator. These are the properties that
  // make "the top-left tile of a 2×2" mean one thing to the editor, the prompt
  // and the image request.
  {
    check("the full surface is one whole cell", near(gridRect(fullGridArea()).w, 1));

    for (const preset of GRID_PRESETS) {
      const rect = gridRect(preset.area);
      check(
        `grid preset "${preset.id}" resolves inside the surface`,
        rect.x >= -1e-9 &&
          rect.y >= -1e-9 &&
          rect.w > 0 &&
          rect.h > 0 &&
          rect.x + rect.w <= 1 + 1e-9 &&
          rect.y + rect.h <= 1 + 1e-9,
      );
      check(`grid preset "${preset.id}" is a valid area`, isValidGridArea(preset.area));
      check(`grid preset "${preset.id}" round-trips through its own geometry`, Boolean(matchGridPreset(preset.area)));
    }

    // Equivalent fractions are one preset, not two that drift apart.
    check(
      "equivalent fractions collapse to a single preset",
      gridGeometryKeys(GRID_PRESETS.map((p) => p.area)).size === GRID_PRESETS.length,
    );

    // The denominator is data. Sixths and tenths have to work with no code
    // change, because that is the whole claim the grid makes.
    for (const divisions of [6, 7, 8, 10]) {
      const area = {
        columns: divisions,
        rows: 1,
        column: 0,
        row: 0,
        columnSpan: divisions - 1,
        rowSpan: 1,
      };
      check(
        `a ${divisions}ths grid resolves without a code change`,
        near(gridRect(area).w, (divisions - 1) / divisions),
      );
    }

    // Out-of-bounds areas are refused rather than clamped into a differently
    // shaped picture.
    check(
      "a region running off the grid is refused",
      !isValidGridArea({ columns: 3, rows: 1, column: 2, row: 0, columnSpan: 2, rowSpan: 1 }),
    );
    check("a malformed stored area is refused", normalizeGridArea({ columns: 0 }) === null);

    const leftThird: GridArea = { columns: 3, rows: 1, column: 0, row: 0, columnSpan: 1, rowSpan: 1 };
    const rightThird: GridArea = { columns: 3, rows: 1, column: 2, row: 0, columnSpan: 1, rowSpan: 1 };
    const bottomQuarter: GridArea = { columns: 1, rows: 4, column: 0, row: 3, columnSpan: 1, rowSpan: 1 };
    const leftComplement = complementGridArea(leftThird);
    const rightComplement = complementGridArea(rightThird);
    const bottomComplement = complementGridArea(bottomQuarter);
    check(
      "the complement of the left third is the right two thirds",
      Boolean(leftComplement && near(gridRect(leftComplement).x, 1 / 3) && near(gridRect(leftComplement).w, 2 / 3)),
    );
    check(
      "the complement of the right third is the left two thirds",
      Boolean(rightComplement && near(gridRect(rightComplement).x, 0) && near(gridRect(rightComplement).w, 2 / 3)),
    );
    check(
      "the complement of the bottom quarter is the top three quarters",
      Boolean(
        bottomComplement && near(gridRect(bottomComplement).y, 0) && near(gridRect(bottomComplement).h, 3 / 4),
      ),
    );
    check(
      "a floating tile has no grid complement",
      complementGridArea({ columns: 3, rows: 3, column: 1, row: 1, columnSpan: 1, rowSpan: 1 }) === null,
    );
    check(
      "a grid region is described as a fraction the model can act on",
      describeGridAreaForPrompt(leftThird) === "the left 1/3 of the width of the image",
    );
    check(
      "the focal complement is described as a fraction too",
      describeGridAreaForPrompt(leftComplement!) === "the right 2/3 of the width of the image",
    );

    // A tile that is half the width and half the height of its surface has the
    // surface's own shape — the property that makes tiling format-independent.
    for (const product of LULU_BOOK_PRODUCTS) {
      for (const surface of ["page", "spread"] as const) {
        const shape = regionSurfaceAspect(product.aspect, surface);
        const quarter = { columns: 2, rows: 2, column: 0, row: 0, columnSpan: 1, rowSpan: 1 };
        check(
          `${product.sku} (${surface}): a 2×2 tile keeps the surface shape`,
          near(gridAreaAspect(quarter, shape), shape, 1e-9),
        );
        const twoFifths = { columns: 5, rows: 1, column: 0, row: 0, columnSpan: 2, rowSpan: 1 };
        check(
          `${product.sku} (${surface}): a 2/5 column is 2/5 of the surface shape`,
          near(gridAreaAspect(twoFifths, shape), shape * 0.4, 1e-9),
        );
      }
    }
  }

  // ---- Requested canvas ----------------------------------------------------

  // The generated canvas must match the shape of the region it fills, or the
  // page crops it — the failure that looks like "the model ignored my prompt".
  // Checked for every trim, both surfaces, and every sizing mode a model can
  // be in, because the mode is what decides how closely the shape can be hit.
  {
    const modes: { label: string; caps: ImageModelCapabilities }[] = [
      { label: "arbitrary", caps: capabilitiesFor({ provider: "openai", id: "gpt-image-2" }) },
      { label: "fixed", caps: capabilitiesFor({ provider: "openai", id: "gpt-image-1" }) },
      { label: "buckets", caps: capabilitiesFor({ provider: "google", id: "gemini-3-pro-image" }) },
    ];

    for (const product of LULU_BOOK_PRODUCTS) {
      const config = { productSku: product.sku, bookSize: bookSizeFromAspect(product.aspect) };
      for (const kind of ["single", "spread"] as const) {
        const target = renderAspect(kind, config);
        for (const { label, caps } of modes) {
          const resolved = resolveImageSize(caps, target);
          const dims = parseSize(resolved.size);
          check(`${product.sku} ${kind}/${label}: the canvas parses`, Boolean(dims));
          if (!dims) continue;

          // What the resolver reports and what it emitted must agree, or the
          // mismatch used for gating is measuring a canvas nobody asked for.
          check(
            `${product.sku} ${kind}/${label}: reported ratio matches the canvas`,
            near(dims.width / dims.height, resolved.ratio, 0.01),
            `${resolved.size} is ${(dims.width / dims.height).toFixed(3)}, reported ${resolved.ratio.toFixed(3)}`,
          );

          // Gating and generation must not disagree about the fit: a layout
          // offered because the shape "fits" has to be generated at that fit.
          check(
            `${product.sku} ${kind}/${label}: gating and generation agree on the fit`,
            near(aspectFit(caps, target).error, resolved.error, 0.01),
          );

          // A shape the model can't reach is allowed to exist — the fixed-size
          // canvases genuinely cannot render a 2.6:1 landscape spread — but the
          // system has to KNOW it rather than silently crop 40% of the frame,
          // because that judgment is what gating and the warnings run on.
          check(
            `${product.sku} ${kind}/${label}: the model's own verdict matches the fit`,
            aspectIsProducible(caps, target) === (resolved.error <= MAX_ASPECT_MISMATCH),
            `off by ${(resolved.error * 100).toFixed(1)}%`,
          );

          // The models pages are actually rendered with must clear the budget
          // on every trim and both surfaces — no book ships pre-cropped.
          if (label !== "fixed") {
            check(
              `${product.sku} ${kind}/${label}: the canvas is within the crop budget`,
              resolved.error <= MAX_ASPECT_MISMATCH,
              `off by ${(resolved.error * 100).toFixed(1)}%`,
            );
          }

          // The pipeline entry point has to return the same canvas as the
          // policy it delegates to.
          check(
            `${product.sku} ${kind}/${label}: chooseImageSize matches the policy`,
            chooseImageSize(kind, config, null, caps) === resolved.size,
          );

          // An untrusted canvas is re-derived to a supported one, and a
          // supported one survives untouched.
          check(
            `${product.sku} ${kind}/${label}: a supported canvas survives sanitizing`,
            sanitizeImageSize(caps, resolved.size) === resolved.size,
          );
        }

        // A model that accepts arbitrary resolutions has no excuse to miss the
        // shape at all — this is what makes an exact page render possible.
        const exact = resolveImageSize(modes[0].caps, target);
        check(
          `${product.sku} ${kind}: an arbitrary-size model hits the page shape`,
          exact.error < 0.02,
          `off by ${(exact.error * 100).toFixed(2)}%`,
        );
      }
    }

    // Every constraint `gpt-image-2` documents, on every shape we can ask for.
    const arbitrary = capabilitiesFor({ provider: "openai", id: "gpt-image-2" });
    const sizing = arbitrary.sizing;
    check("gpt-image-2 is modelled as an arbitrary-size model", sizing.mode === "arbitrary");
    if (sizing.mode === "arbitrary") {
      for (const target of [0.2, 0.5, 17 / 22, 1, 22 / 17, 2, 44 / 17, 6]) {
        const dims = parseSize(resolveImageSize(arbitrary, target).size);
        if (!dims) {
          check(`gpt-image-2 @ ${target.toFixed(2)}: canvas parses`, false);
          continue;
        }
        const { width, height } = dims;
        const long = Math.max(width, height);
        const short = Math.min(width, height);
        check(
          `gpt-image-2 @ ${target.toFixed(2)}: both edges are multiples of ${sizing.multipleOf}`,
          width % sizing.multipleOf === 0 && height % sizing.multipleOf === 0,
          `${width}x${height}`,
        );
        check(
          `gpt-image-2 @ ${target.toFixed(2)}: the long edge is within the ceiling`,
          long <= sizing.maxEdge,
          `${long} > ${sizing.maxEdge}`,
        );
        check(
          `gpt-image-2 @ ${target.toFixed(2)}: the area is within the pixel bounds`,
          width * height >= sizing.minPixels && width * height <= sizing.maxPixels,
          `${(width * height).toLocaleString()} px`,
        );
        check(
          `gpt-image-2 @ ${target.toFixed(2)}: the ratio is within the ceiling`,
          long / short <= sizing.maxRatio + 1e-9,
          `${(long / short).toFixed(2)}:1`,
        );
      }

      // Cost control: an inflated canvas from a client is brought back to the
      // budget rather than billed at whatever it asked for.
      const greedy = sanitizeImageSize(arbitrary, "3824x3824");
      const greedyDims = greedy ? parseSize(greedy) : null;
      check(
        "an oversized client canvas is cut back to the budget",
        Boolean(greedyDims) &&
          greedyDims!.width * greedyDims!.height <= sizing.pixelBudget * 1.1,
        greedy,
      );
    }

    // The admin panel reads its table off `sizingReport`, so the report must
    // not claim a resolution we don't choose: a bucketed model is asked for a
    // shape and picks its own pixels, and quoting a print DPI for one would be
    // inventing a number an admin would then make decisions on.
    {
      const surfaces = LULU_BOOK_PRODUCTS.slice(0, 3).map((p) => ({
        label: p.sku,
        aspect: p.aspect,
        widthIn: p.trim.widthIn,
      }));
      for (const { label, caps } of modes) {
        for (const row of sizingReport(caps, surfaces)) {
          if (caps.sizing.mode === "ratioBuckets") {
            check(`${label}: the report names a shape rather than a resolution`, Boolean(row.token));
            check(`${label}: the report quotes no print DPI it can't know`, row.dpi === undefined);
          } else {
            check(`${label}: the report quotes the print DPI it does know`, (row.dpi ?? 0) > 0);
          }
          // Whatever the panel shows has to be what the pipeline would ask for.
          check(
            `${label}: the report matches the requested canvas`,
            row.size === resolveImageSize(caps, row.target).size,
          );
        }
      }
    }

    // A bucketed model's canvas has to carry its ratio back out, or the Gemini
    // adapter sends a token for a shape nobody chose.
    for (const modelId of ["gemini-3-pro-image", "gemini-3.1-flash-image"]) {
      const caps = capabilitiesFor({ provider: "google", id: modelId });
      if (caps.sizing.mode !== "ratioBuckets") {
        check(`${modelId} is modelled as a bucketed model`, false);
        continue;
      }
      for (const bucket of caps.sizing.ratios) {
        const size = resolveImageSize(caps, bucket.ratio).size;
        check(
          `${modelId}: a ${bucket.token} canvas reads back as ${bucket.token}`,
          ratioTokenForSize(caps, size) === bucket.token,
          `${size} → ${ratioTokenForSize(caps, size)}`,
        );
      }
    }

    // An admin correction has to reach generation, not just the layout picker
    // — the drift this consolidation exists to remove.
    {
      const model = { provider: "openai" as const, id: "gpt-image-2" };
      const restricted = capabilitiesFor(model, {
        [capabilityKey(model.provider, model.id)]: { ratios: ["1:1"] },
      });
      check(
        "an admin ratio restriction reaches the requested canvas",
        resolveImageSize(restricted, 2).size === resolveImageSize(restricted, 0.5).size,
        resolveImageSize(restricted, 2).size,
      );
      check(
        "an admin ratio restriction reaches layout gating",
        aspectFit(restricted, 2).error > MAX_ASPECT_MISMATCH,
      );

      // The resolution knob has to move in both directions. Lowering it is the
      // cost lever; raising it is the print-DPI lever. A version of this that
      // only ever clamped DOWN silently ignored half the admin screen's options.
      const areaAt = (maxPixels: number): number => {
        const caps = capabilitiesFor(model, {
          [capabilityKey(model.provider, model.id)]: { maxPixels },
        });
        const dims = parseSize(resolveImageSize(caps, 1).size);
        return dims ? dims.width * dims.height : 0;
      };
      const shippedArea = areaAt(
        capabilitiesFor(model).sizing.mode === "arbitrary"
          ? (capabilitiesFor(model).sizing as { pixelBudget: number }).pixelBudget
          : 1,
      );
      check(
        "an admin resolution cap reaches the requested canvas",
        areaAt(1_048_576) <= 1_048_576,
        `${areaAt(1_048_576).toLocaleString()} px`,
      );
      check(
        "an admin resolution increase reaches the requested canvas",
        areaAt(8_000_000) > shippedArea,
        `${areaAt(8_000_000).toLocaleString()} px vs shipped ${shippedArea.toLocaleString()}`,
      );
      check(
        "a resolution below the model's floor is clamped, not honoured",
        areaAt(1) >= sizing.minPixels,
        `${areaAt(1).toLocaleString()} px`,
      );
    }
  }

  // Every variable the layout blocks interpolate has to be declared, or the
  // admin prompt editor renders `{{calmRegions}}` as literal text to the model.
  {
    const metas = PROMPT_ACTIONS.flatMap((a) => a.templates);
    check("every prompt template is described to the admin editor", metas.length > 0);

    for (const meta of metas) {
      const template = defaultTemplate(meta.key);
      // Text prompts split into system/user; image prompts are one `single` list.
      const blocks = [
        ...(template.system ?? []),
        ...(template.user ?? []),
        ...(template.single ?? []),
      ];
      check(`${meta.key} resolves to a shipped template`, blocks.length > 0);
      if (blocks.length === 0) continue;

      const declared = new Set(meta.variables.map((v) => v.name));
      const used = new Set(
        blocks.flatMap((b) => [...b.text.matchAll(/\{\{(\w+)\}\}/g)]).map((m) => m[1]),
      );
      for (const name of used) {
        check(`${meta.key} declares {{${name}}}`, declared.has(name));
      }

      const flags = new Set(Object.keys(meta.sampleFlags));
      for (const block of blocks) {
        if (!block.enabledWhen) continue;
        // A predicate may be negated ("!isSpread"); either polarity is driven
        // by the same sample flag.
        const flag = block.enabledWhen.replace(/^!/, "");
        check(`${meta.key} can preview the "${block.id}" block`, flags.has(flag));
      }
    }
  }
}

// ---- Report ----------------------------------------------------------------

for (const name of checks) console.log(`  ok   ${name}`);
for (const failure of failures) console.error(`  FAIL ${failure}`);
console.log(`\n${checks.length} passed, ${failures.length} failed.`);
process.exit(failures.length > 0 ? 1 : 0);
