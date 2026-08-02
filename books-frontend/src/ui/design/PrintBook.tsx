import type { BookDesign } from "../../core/types";
import { CompositedPage, type ResolvedArtwork } from "./CompositedPage";
import { defaultIllustrationFocus, type DesignPage } from "./designInit";

export type { ResolvedArtwork };

/**
 * One thing to capture: a page drawn onto a surface, optionally showing only a
 * horizontal slice of it.
 *
 * The slice is how a double-page spread becomes two printable leaves and how a
 * cover becomes a wraparound panel — the page is laid out once, continuously,
 * and the window decides which part of it this capture is for. Two windows onto
 * the same page render the page twice; that costs a little memory and buys
 * artwork that stays continuous across the fold.
 */
export interface PrintTarget {
  /** Value of `data-export-page`, and the id the capture loop looks up. */
  id: string;
  page: DesignPage;
  /** Rendered surface, including any bleed, in device pixels. */
  surfaceWidthPx: number;
  surfaceHeightPx: number;
  /** Bleed inset on each edge. The trim box sits inside it. */
  bleedPx: number;
  /** Horizontal slice of the surface to expose, if not all of it. */
  clip?: { xPx: number; widthPx: number };
}

/**
 * A print-friendly, read-only rendering of a set of capture targets.
 *
 * Used two ways: the browser's own print dialog (`window.print()`, one page per
 * sheet, no bleed) and the export pipeline (offscreen, at print resolution,
 * with bleed and slicing).
 */
export function PrintBook({
  targets,
  design,
  artwork,
  trimIn,
  forExport = false,
}: {
  targets: PrintTarget[];
  design: BookDesign;
  /** Pre-resolved artwork. When omitted, pages fetch their own (on-screen path). */
  artwork?: ResolvedArtwork;
  /** When set, emits an `@page` rule sized to the book's real trim for `window.print()`. */
  trimIn?: { widthIn: number; heightIn: number };
  /** Export mode renders pages stacked with no page-break CSS for snapshotting. */
  forExport?: boolean;
}) {
  return (
    // Export mode is a plain wrapper: the offscreen stage that hosts it owns
    // the positioning, so anything else it renders (the spine band) is hidden
    // by the same rule rather than landing in the middle of the page.
    <div className={forExport ? undefined : "print-root"}>
      {trimIn && !forExport && <PageSizeStyle trimIn={trimIn} />}
      {targets.map((target) => (
        <PrintTargetView
          key={target.id}
          target={target}
          design={design}
          artwork={artwork}
          forExport={forExport}
        />
      ))}
    </div>
  );
}

/** Injects an `@page` rule so the browser print dialog uses the real trim size. */
function PageSizeStyle({ trimIn }: { trimIn: { widthIn: number; heightIn: number } }) {
  const css = `@media print { @page { size: ${trimIn.widthIn}in ${trimIn.heightIn}in; margin: 0; } }`;
  return <style>{css}</style>;
}

/** The capture element: a window onto a rendered page surface. */
function PrintTargetView({
  target,
  design,
  artwork,
  forExport,
}: {
  target: PrintTarget;
  design: BookDesign;
  artwork?: ResolvedArtwork;
  forExport: boolean;
}) {
  const clip = target.clip;
  const pd = design.pages[target.page.id] ?? { textBoxes: [] };
  return (
    <div
      className={forExport ? "export-page" : "print-page"}
      data-export-page={forExport ? target.id : undefined}
      style={{
        width: clip ? clip.widthPx : target.surfaceWidthPx,
        height: target.surfaceHeightPx,
        position: "relative",
        overflow: "hidden",
        background: "#fff",
        // Force backgrounds/colors to print exactly as designed.
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: clip ? -clip.xPx : 0,
          width: target.surfaceWidthPx,
          height: target.surfaceHeightPx,
        }}
      >
        <CompositedPage
          pageDesign={pd}
          surfaceWidthPx={target.surfaceWidthPx}
          surfaceHeightPx={target.surfaceHeightPx}
          bleedPx={target.bleedPx}
          illustrationBlobId={target.page.blobId}
          artwork={artwork}
          illustrationFocus={defaultIllustrationFocus(target.page)}
        />
      </div>
    </div>
  );
}

/**
 * The printed spine: a coloured band with the title running down it, rendered
 * in the book's own typeface.
 *
 * It's a DOM element rather than something drawn onto a canvas so it goes
 * through the same font pipeline as every other page — the spine used to be
 * drawn in hardcoded Georgia regardless of what the book was set in, which is
 * the one piece of typography a person sees on a shelf.
 */
export function PrintSpine({
  id,
  widthPx,
  heightPx,
  text,
  fontFamily,
  background,
  color,
}: {
  id: string;
  widthPx: number;
  heightPx: number;
  text: string;
  fontFamily: string;
  background: string;
  color: string;
}) {
  return (
    <div
      data-export-page={id}
      className="export-page"
      style={{
        width: widthPx,
        height: heightPx,
        position: "relative",
        overflow: "hidden",
        background,
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
    >
      {text.trim() && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            // Rotated to read top-to-bottom, the convention for English-language
            // spines. Sized against the band width so it can't touch the edges.
            transform: "translate(-50%, -50%) rotate(90deg)",
            transformOrigin: "center",
            width: heightPx * 0.86,
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "clip",
            fontFamily,
            fontWeight: 600,
            fontSize: widthPx * 0.42,
            lineHeight: 1,
            color,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
