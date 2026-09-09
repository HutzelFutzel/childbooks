/**
 * Turns a project into the list of things a render pass has to capture.
 *
 * Three passes, one source of geometry:
 *   - the digital edition — front cover, content, back cover, at trim size;
 *   - the print interior  — one bleed-sized leaf per physical page;
 *   - the wraparound cover — two bleed-sized panels plus a spine band.
 *
 * Deriving all three here is what keeps them consistent. They used to be built
 * inline in two different components, which is how the digital edition and the
 * printed book ended up disagreeing about what a page even was.
 */
import { bookProductForConfig } from "../../core/book";
import { EXPORT_DPI } from "../../core/config/options";
import {
  coverPanelWindow,
  pageGeometry,
  splitBleedPixels,
  spreadLeaves,
  type PageGeometry,
} from "../../core/print/geometry";
import { paginate } from "../../core/pipeline/pagination";
import { interiorLeafPlan, type LeafPlan } from "../../core/print/pagePlan";
import { getCursor } from "../../core/versioning";
import { COVER_BACK_ID, COVER_FRONT_ID, type BookDesign, type PageDesign, type Project } from "../../core/types";
import { withFacingOverflow } from "../../core/book/pairSurface";
import type { DesignPage } from "./designInit";
import type { PrintTarget, ResolvedArtwork } from "./PrintBook";

/** Capture id of the spine band (not a design page — we render it ourselves). */
export const SPINE_CAPTURE_ID = "__spine";

export interface PlannedTarget extends PrintTarget {
  label: string;
  /** Zero-based position in its finished document (may skip blank leaves). */
  documentIndex?: number;
  /** Physical size of the captured slice, in inches. */
  widthIn: number;
  heightIn: number;
  /**
   * Illustrations are rendered in trim space so preview and PDF framing agree.
   * The server mirrors adjacent composed pixels into these sacrificial strips
   * without scaling or reframing that trim composition.
   */
  bleedFill?: { top: number; right: number; bottom: number; left: number };
}

function pageById(pages: DesignPage[]): Map<string, DesignPage> {
  return new Map(pages.map((p) => [p.id, p]));
}

/** Whether a design page is a double-page spread (twice as wide as the trim). */
function isSpread(page: DesignPage, product: { aspect: number }): boolean {
  return page.aspect > product.aspect * 1.5;
}

/**
 * The digital edition, in reading order.
 *
 * Trim-sized and un-split: nothing is cut off a screen, and a double-page
 * illustration reads better whole than as two halves.
 */
export function buildEbookTargets(
  project: Project,
  pages: DesignPage[],
  dpi = EXPORT_DPI,
): PlannedTarget[] {
  const product = bookProductForConfig(project.config);
  const single = pageGeometry(product, { dpi, bleed: false });
  const spread = pageGeometry(product, { dpi, bleed: false, spread: true });

  const ordered = [
    ...pages.filter((p) => p.id === COVER_FRONT_ID),
    ...pages.filter((p) => !p.isCover),
    ...pages.filter((p) => p.id === COVER_BACK_ID),
  ];

  const overflowById = ebookOverflowNeighbors(project, pages);

  return ordered.map((page) => {
    const geo = isSpread(page, product) ? spread : single;
    const overflowFrom = overflowById.get(page.id);
    return {
      id: page.id,
      page,
      label: page.label,
      surfaceWidthPx: geo.widthPx,
      surfaceHeightPx: geo.heightPx,
      bleedPx: 0,
      widthIn: geo.widthIn,
      heightIn: geo.heightIn,
      ...(overflowFrom ? { overflowFrom } : {}),
    };
  });
}

/** Facing singles in the ebook: each leaf paints the neighbor's fold overflow. */
function ebookOverflowNeighbors(
  project: Project,
  pages: DesignPage[],
): Map<string, { page: DesignPage; fromRight: boolean }> {
  const out = new Map<string, { page: DesignPage; fromRight: boolean }>();
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  if (!doc) return out;
  const byId = pageById(pages);
  for (const pair of paginate(doc).pairs) {
    const left = pair.left;
    const right = pair.right;
    if (!left || !right) continue;
    if (left.spread === right.spread || left.spread.placeholder || right.spread.placeholder) continue;
    if (left.spread.kind !== "single" || right.spread.kind !== "single") continue;
    const leftPage = byId.get(left.spread.id);
    const rightPage = byId.get(right.spread.id);
    if (!leftPage || !rightPage) continue;
    out.set(left.spread.id, { page: rightPage, fromRight: true });
    out.set(right.spread.id, { page: leftPage, fromRight: false });
  }
  return out;
}

/** The other single that faces this leaf, when both are ordinary pages. */
function facingSinglePartner(leaves: LeafPlan[], leaf: LeafPlan): LeafPlan | null {
  if (!leaf.sourcePageId || leaf.half) return null;
  const partnerNumber = leaf.side === "left" ? leaf.pageNumber + 1 : leaf.pageNumber - 1;
  const partner = leaves.find((item) => item.pageNumber === partnerNumber) ?? null;
  if (!partner?.sourcePageId || partner.half) return null;
  return partner;
}

export interface InteriorPlan {
  /** What to capture. Blank leaves are absent — they're padding, not renders. */
  targets: PlannedTarget[];
  /** Every physical leaf, including blanks, in order. */
  leaves: LeafPlan[];
  /** Physical page count before the binding's minimum/step is applied. */
  pageCount: number;
}

/**
 * The print interior: one bleed-sized leaf per physical page.
 *
 * Spreads are laid out once, continuously, and sliced into two leaves so the
 * artwork runs across the fold without a seam. Pagination fillers are counted
 * but not captured — a blank page has nothing to render.
 */
export function buildInteriorPlan(
  project: Project,
  pages: DesignPage[],
  dpi = EXPORT_DPI,
): InteriorPlan {
  const product = bookProductForConfig(project.config);
  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const leaves = interiorLeafPlan(doc);
  const byId = pageById(pages);

  const single = pageGeometry(product, { dpi, bleed: true });
  const spread = pageGeometry(product, { dpi, bleed: true, spread: true });
  const halves = spreadLeaves(spread);
  const verticalBleed = splitBleedPixels(
    spread.heightPx,
    spread.trimHeightPx,
    spread.bleedPx,
  );

  const targets: PlannedTarget[] = [];
  for (const [documentIndex, leaf] of leaves.entries()) {
    if (!leaf.sourcePageId) continue;
    const page = byId.get(leaf.sourcePageId);
    if (!page) continue;

    if (leaf.half) {
      const window = halves[leaf.half];
      const horizontalBleed = splitBleedPixels(
        window.widthPx,
        single.trimWidthPx,
        spread.bleedPx,
      );
      targets.push({
        id: leaf.id,
        page,
        documentIndex,
        label: `${page.label} (${leaf.half === "left" ? "left" : "right"} half)`,
        surfaceWidthPx: spread.widthPx,
        surfaceHeightPx: spread.heightPx,
        bleedPx: spread.bleedPx,
        clip: { xPx: window.xPx, widthPx: window.widthPx },
        widthIn: window.widthIn,
        heightIn: spread.heightIn,
        // Keep the real neighbouring-page pixels in the fold-side overlap;
        // only the physical outside edge needs synthesized bleed.
        bleedFill: {
          top: verticalBleed.start,
          bottom: verticalBleed.end,
          left: leaf.half === "left" ? horizontalBleed.start : 0,
          right: leaf.half === "right" ? horizontalBleed.end : 0,
        },
      });
    } else {
      const partner = facingSinglePartner(leaves, leaf);
      const partnerPage = partner?.sourcePageId ? byId.get(partner.sourcePageId) : undefined;
      if (partner && partnerPage) {
        const window = halves[leaf.side];
        const horizontalBleed = splitBleedPixels(
          window.widthPx,
          single.trimWidthPx,
          spread.bleedPx,
        );
        targets.push({
          id: leaf.id,
          page,
          documentIndex,
          label: page.label,
          surfaceWidthPx: spread.widthPx,
          surfaceHeightPx: spread.heightPx,
          bleedPx: spread.bleedPx,
          clip: { xPx: window.xPx, widthPx: window.widthPx },
          widthIn: window.widthIn,
          heightIn: spread.heightIn,
          pairWith: partnerPage,
          pairRole: leaf.side,
          // Same fold treatment as a true spread: real neighbour pixels in the
          // gutter overlap, synthesized bleed only on the physical outside.
          bleedFill: {
            top: verticalBleed.start,
            bottom: verticalBleed.end,
            left: leaf.side === "left" ? horizontalBleed.start : 0,
            right: leaf.side === "right" ? horizontalBleed.end : 0,
          },
        });
        continue;
      }
      const horizontalBleed = splitBleedPixels(
        single.widthPx,
        single.trimWidthPx,
        single.bleedPx,
      );
      const singleVerticalBleed = splitBleedPixels(
        single.heightPx,
        single.trimHeightPx,
        single.bleedPx,
      );
      targets.push({
        id: leaf.id,
        page,
        documentIndex,
        label: page.label,
        surfaceWidthPx: single.widthPx,
        surfaceHeightPx: single.heightPx,
        bleedPx: single.bleedPx,
        widthIn: single.widthIn,
        heightIn: single.heightIn,
        bleedFill: {
          top: singleVerticalBleed.start,
          right: horizontalBleed.end,
          bottom: singleVerticalBleed.end,
          left: horizontalBleed.start,
        },
      });
    }
  }

  return { targets, leaves, pageCount: leaves.length };
}

export interface CoverPlan {
  targets: PlannedTarget[];
  geometry: PageGeometry;
  /** Panel width (trim + outer bleed), inches. */
  panelWidthIn: number;
}

/**
 * The wraparound cover's two artwork panels.
 *
 * Each panel is the trim plus its OUTER bleed only: the inner edge butts
 * against the spine and is never trimmed, so including bleed there would pull
 * the artwork away from the fold by an eighth of an inch.
 */
export function buildCoverPlan(
  project: Project,
  pages: DesignPage[],
  dpi = EXPORT_DPI,
): CoverPlan {
  const product = bookProductForConfig(project.config);
  const geometry = pageGeometry(product, { dpi, bleed: true });
  const byId = pageById(pages);
  const targets: PlannedTarget[] = [];
  const verticalBleed = splitBleedPixels(
    geometry.heightPx,
    geometry.trimHeightPx,
    geometry.bleedPx,
  );

  for (const [pageId, side] of [
    [COVER_BACK_ID, "left"],
    [COVER_FRONT_ID, "right"],
  ] as const) {
    const page = byId.get(pageId);
    if (!page) continue;
    const window = coverPanelWindow(geometry, side);
    const outerBleedPx = Math.max(0, window.widthPx - geometry.trimWidthPx);
    targets.push({
      id: pageId,
      page,
      label: page.label,
      surfaceWidthPx: geometry.widthPx,
      surfaceHeightPx: geometry.heightPx,
      bleedPx: geometry.bleedPx,
      clip: { xPx: window.xPx, widthPx: window.widthPx },
      widthIn: window.widthIn,
      heightIn: geometry.heightIn,
      bleedFill: {
        top: verticalBleed.start,
        right: side === "right" ? outerBleedPx : 0,
        bottom: verticalBleed.end,
        left: side === "left" ? outerBleedPx : 0,
      },
    });
  }

  return { targets, geometry, panelWidthIn: geometry.trimWidthIn + geometry.bleedIn };
}

function targetDesignPages(target: PlannedTarget): DesignPage[] {
  const pages = [target.page];
  if (target.pairWith) pages.push(target.pairWith);
  if (target.overflowFrom) pages.push(target.overflowFrom.page);
  return pages;
}

/** Every blob a set of targets needs before it can be captured. */
export function artworkBlobIds(targets: PlannedTarget[], design: BookDesign): string[] {
  const ids = new Set<string>();
  for (const target of targets) {
    for (const page of targetDesignPages(target)) {
      if (page.blobId) ids.add(page.blobId);
      for (const image of design.pages[page.id]?.images ?? []) {
        if (image.kind === "asset" && image.blobId) ids.add(image.blobId);
      }
    }
  }
  return [...ids];
}

/**
 * How many `<img>` elements a set of targets will produce once rendered.
 *
 * The readiness check needs this to tell "the artwork hasn't arrived yet" from
 * "this book has no artwork". It mirrors what {@link PrintBook} draws: a
 * full-bleed illustration unless a placed illustration element replaced it,
 * plus every placed image — and the blurred backdrop behind a contained one.
 */
function countDrawnImages(
  pd: PageDesign,
  artwork: ResolvedArtwork,
  pageArt: string | undefined,
  overflow?: { art: string | undefined; leaf: "left" | "right" },
): number {
  let count = 0;
  const images = pd.images ?? [];
  const hasOwnIllustrationEl = images.some(
    (im) =>
      im.kind === "illustration" && !(overflow && im.pairLeaf === overflow.leaf),
  );
  if (pageArt && !hasOwnIllustrationEl) count += 1;
  for (const image of images) {
    if (image.hidden) continue;
    const src =
      image.kind === "illustration"
        ? overflow && image.pairLeaf === overflow.leaf
          ? overflow.art
          : pageArt
        : image.blobId && artwork[image.blobId];
    if (!src) continue;
    const backdrop = image.fitBackdrop ?? (image.kind === "illustration" ? "blur" : "none");
    count += image.fit === "contain" && backdrop === "blur" ? 2 : 1;
  }
  return count;
}

export function expectedImageCount(
  targets: PlannedTarget[],
  design: BookDesign,
  artwork: ResolvedArtwork,
): number {
  let count = 0;
  const empty: PageDesign = { textBoxes: [] };
  for (const target of targets) {
    if (target.overflowFrom && !target.pairWith) {
      const self = design.pages[target.page.id] ?? empty;
      const neighbor = design.pages[target.overflowFrom.page.id] ?? empty;
      const pd = withFacingOverflow(self, neighbor, target.overflowFrom.fromRight);
      count += countDrawnImages(
        pd,
        artwork,
        target.page.blobId ? artwork[target.page.blobId] : undefined,
        {
          art: target.overflowFrom.page.blobId
            ? artwork[target.overflowFrom.page.blobId]
            : undefined,
          leaf: target.overflowFrom.fromRight ? "right" : "left",
        },
      );
      continue;
    }
    for (const page of targetDesignPages(target)) {
      count += countDrawnImages(
        design.pages[page.id] ?? empty,
        artwork,
        page.blobId ? artwork[page.blobId] : undefined,
      );
    }
  }
  return count;
}
