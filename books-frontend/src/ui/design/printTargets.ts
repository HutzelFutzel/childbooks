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
  spreadLeaves,
  type PageGeometry,
} from "../../core/print/geometry";
import { interiorLeafPlan, type LeafPlan } from "../../core/print/pagePlan";
import { getCursor } from "../../core/versioning";
import { COVER_BACK_ID, COVER_FRONT_ID, type BookDesign, type Project } from "../../core/types";
import type { DesignPage } from "./designInit";
import type { PrintTarget, ResolvedArtwork } from "./PrintBook";

/** Capture id of the spine band (not a design page — we render it ourselves). */
export const SPINE_CAPTURE_ID = "__spine";

export interface PlannedTarget extends PrintTarget {
  label: string;
  /** Physical size of the captured slice, in inches. */
  widthIn: number;
  heightIn: number;
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

  return ordered.map((page) => {
    const geo = isSpread(page, product) ? spread : single;
    return {
      id: page.id,
      page,
      label: page.label,
      surfaceWidthPx: geo.widthPx,
      surfaceHeightPx: geo.heightPx,
      bleedPx: 0,
      widthIn: geo.widthIn,
      heightIn: geo.heightIn,
    };
  });
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

  const targets: PlannedTarget[] = [];
  for (const leaf of leaves) {
    if (!leaf.sourcePageId) continue;
    const page = byId.get(leaf.sourcePageId);
    if (!page) continue;

    if (leaf.half) {
      const window = halves[leaf.half];
      targets.push({
        id: leaf.id,
        page,
        label: `${page.label} (${leaf.half === "left" ? "left" : "right"} half)`,
        surfaceWidthPx: spread.widthPx,
        surfaceHeightPx: spread.heightPx,
        bleedPx: spread.bleedPx,
        clip: { xPx: window.xPx, widthPx: window.widthPx },
        widthIn: window.widthIn,
        heightIn: spread.heightIn,
      });
    } else {
      targets.push({
        id: leaf.id,
        page,
        label: page.label,
        surfaceWidthPx: single.widthPx,
        surfaceHeightPx: single.heightPx,
        bleedPx: single.bleedPx,
        widthIn: single.widthIn,
        heightIn: single.heightIn,
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

  for (const [pageId, side] of [
    [COVER_BACK_ID, "left"],
    [COVER_FRONT_ID, "right"],
  ] as const) {
    const page = byId.get(pageId);
    if (!page) continue;
    const window = coverPanelWindow(geometry, side);
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
    });
  }

  return { targets, geometry, panelWidthIn: geometry.trimWidthIn + geometry.bleedIn };
}

/** Every blob a set of targets needs before it can be captured. */
export function artworkBlobIds(targets: PlannedTarget[], design: BookDesign): string[] {
  const ids = new Set<string>();
  for (const target of targets) {
    if (target.page.blobId) ids.add(target.page.blobId);
    for (const image of design.pages[target.page.id]?.images ?? []) {
      if (image.kind === "asset" && image.blobId) ids.add(image.blobId);
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
export function expectedImageCount(
  targets: PlannedTarget[],
  design: BookDesign,
  artwork: ResolvedArtwork,
): number {
  let count = 0;
  for (const target of targets) {
    const pd = design.pages[target.page.id];
    const images = pd?.images ?? [];
    const hasIllustrationEl = images.some((im) => im.kind === "illustration");
    const pageArt = target.page.blobId ? artwork[target.page.blobId] : undefined;
    if (pageArt && !hasIllustrationEl) count += 1;
    for (const image of images) {
      if (image.hidden) continue;
      const src = image.kind === "illustration" ? pageArt : image.blobId && artwork[image.blobId];
      if (!src) continue;
      // A contained illustration draws a blurred backdrop copy behind itself.
      count += image.fit === "contain" && image.kind === "illustration" ? 2 : 1;
    }
  }
  return count;
}
