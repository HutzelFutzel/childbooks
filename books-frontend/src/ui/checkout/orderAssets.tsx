/**
 * The two purchasable renders: the printer's pair of files, and the digital
 * edition.
 *
 * Both work the same way now. The browser rasterizes the pages — it's the only
 * thing that can, since the book is laid out in the DOM — and the backend
 * assembles the documents from those rasters and keeps them. That split is what
 * makes the printed and digital editions the same book: one set of pixels, one
 * set of geometry rules, one assembler.
 *
 * It also means a book is rendered once. A reorder, a gift, a re-download after
 * a plan change: all cache hits, none of which reach these components at all.
 */
import { useCallback } from "react";
import { EXPORT_DPI } from "../../core/config/options";
import type { RasterPage } from "../../core/print/assemble";
import { getCursor } from "../../core/versioning";
import { COVER_BACK_ID, COVER_FRONT_ID, type BookDesign, type Project } from "../../core/types";
import {
  assembleRenderDocument,
  uploadRenderPages,
  type UploadPage,
} from "../../platform/renders";
import { fontStack } from "../typography/fonts";
import type { DesignPage } from "../design/designInit";
import { RenderStage, type SpineRequest } from "../design/RenderStage";
import {
  buildCoverPlan,
  buildEbookTargets,
  buildInteriorPlan,
  SPINE_CAPTURE_ID,
} from "../design/printTargets";

const MM_PER_IN = 25.4;

/** A spine only carries a title once it's thick enough to be legible on a shelf. */
const MIN_TITLED_SPINE_IN = 0.25;

function rastersById(rasters: RasterPage[]): Map<string, RasterPage> {
  return new Map(rasters.map((r) => [r.id, r]));
}

/**
 * Renders the book and has the backend assemble the printer's two files.
 *
 * The interior is padded to `orderedPageCount` — the count the order was priced
 * at and the spine was cut for. A PDF that disagrees with it is a different
 * book from the one the customer bought.
 */
export function OrderAssetRunner({
  project,
  pages,
  design,
  fingerprint,
  printSku,
  coverWidthMm,
  coverHeightMm,
  orderedPageCount,
  onProgress,
  onDone,
  onError,
}: {
  project: Project;
  pages: DesignPage[];
  design: BookDesign;
  fingerprint: string;
  /** Composed print SKU — the cover cache varies by binding and page count. */
  printSku: string;
  coverWidthMm: number;
  coverHeightMm: number;
  orderedPageCount: number;
  onProgress: (status: string) => void;
  onDone: () => void;
  onError: (err: unknown) => void;
}) {
  const interior = buildInteriorPlan(project, pages, EXPORT_DPI);
  const cover = buildCoverPlan(project, pages, EXPORT_DPI);

  const coverWidthIn = coverWidthMm / MM_PER_IN;
  const coverHeightIn = coverHeightMm / MM_PER_IN;
  const spineWidthIn = Math.max(0, coverWidthIn - cover.panelWidthIn * 2);

  const spineText =
    spineWidthIn >= MIN_TITLED_SPINE_IN
      ? (project.screenplay ? getCursor(project.screenplay).content.spine?.text : "")?.trim() ||
        project.title
      : "";

  const spine: SpineRequest | undefined =
    spineWidthIn > 0
      ? {
          widthPx: Math.max(1, Math.round(spineWidthIn * EXPORT_DPI)),
          heightPx: Math.round(coverHeightIn * EXPORT_DPI),
          widthIn: spineWidthIn,
          heightIn: coverHeightIn,
          text: spineText,
          fontFamily: fontStack(design.defaultFontFamily),
          colorFromBlobId: pages.find((p) => p.id === COVER_FRONT_ID)?.blobId,
        }
      : undefined;

  const handleDone = useCallback(
    async (rasters: RasterPage[]) => {
      try {
        const byId = rastersById(rasters);
        const uploads: UploadPage[] = [];

        interior.targets.forEach((target, index) => {
          const raster = byId.get(target.id);
          if (raster) uploads.push({ raster, role: "interior", index });
        });
        for (const target of cover.targets) {
          const raster = byId.get(target.id);
          if (raster) {
            uploads.push({
              raster,
              role: target.id === COVER_BACK_ID ? "cover-back" : "cover-front",
              index: 0,
            });
          }
        }
        const spineRaster = spine ? byId.get(SPINE_CAPTURE_ID) : undefined;
        if (spineRaster) uploads.push({ raster: spineRaster, role: "spine", index: 0 });

        await uploadRenderPages(fingerprint, project.id, uploads, (done, total) => {
          onProgress(`Uploading pages… ${done} of ${total}`);
        });

        onProgress("Assembling the interior…");
        await assembleRenderDocument(fingerprint, {
          kind: "interior",
          padToPages: orderedPageCount,
        });

        onProgress("Assembling the cover…");
        await assembleRenderDocument(fingerprint, {
          kind: "cover",
          sku: printSku,
          padToPages: orderedPageCount,
          cover: {
            widthIn: coverWidthIn,
            heightIn: coverHeightIn,
            panelWidthIn: cover.panelWidthIn,
          },
        });

        onDone();
      } catch (err) {
        onError(err);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fingerprint, printSku, orderedPageCount, coverWidthIn, coverHeightIn],
  );

  return (
    <RenderStage
      targets={[...interior.targets, ...cover.targets]}
      design={design}
      spine={spine}
      onProgress={onProgress}
      onDone={(rasters) => void handleDone(rasters)}
      onError={onError}
    />
  );
}

/**
 * Renders the digital edition: front cover, every content page, back cover, at
 * trim size (no bleed — nothing is cut off a screen).
 */
export function EbookAssetRunner({
  project,
  pages,
  design,
  fingerprint,
  onProgress,
  onDone,
  onError,
}: {
  project: Project;
  pages: DesignPage[];
  design: BookDesign;
  fingerprint: string;
  onProgress: (status: string) => void;
  onDone: () => void;
  onError: (err: unknown) => void;
}) {
  const targets = buildEbookTargets(project, pages, EXPORT_DPI);

  const handleDone = useCallback(
    async (rasters: RasterPage[]) => {
      try {
        await uploadRenderPages(
          fingerprint,
          project.id,
          rasters.map((raster, index) => ({ raster, role: "ebook" as const, index })),
          (done, total) => onProgress(`Uploading pages… ${done} of ${total}`),
        );
        onProgress("Assembling your ebook…");
        await assembleRenderDocument(fingerprint, { kind: "ebook" });
        onDone();
      } catch (err) {
        onError(err);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fingerprint],
  );

  return (
    <RenderStage
      targets={targets}
      design={design}
      onProgress={onProgress}
      onDone={(rasters) => void handleDone(rasters)}
      onError={onError}
    />
  );
}
