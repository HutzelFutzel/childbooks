import type { BookDesign, ImageElement, ShapeElement, TextBox } from "../../core/types";
import { defaultIllustrationFocus, type DesignPage } from "./designInit";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { cssFilter } from "./effects";
import { PatternFill } from "./patterns";
import { ShapeSvg } from "./ShapeRender";
import { TextBoxView } from "./TextBoxView";

/**
 * Resolved artwork for a render pass: blob id -> object URL.
 *
 * Export passes resolve every blob BEFORE the stage mounts and hand the result
 * in here, so a page renders its illustration on its first paint. Fetching per
 * page from inside the component (which is what the on-screen path still does)
 * leaves a gap between mount and artwork that a capture loop will happily
 * rasterize straight through.
 */
export type ResolvedArtwork = Record<string, string>;

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
        <PrintPage target={target} design={design} artwork={artwork} />
      </div>
    </div>
  );
}

interface Stacked {
  id: string;
  z: number;
  rect: { x: number; y: number; w: number; h: number };
  rotation?: number;
  hidden?: boolean;
  box?: TextBox;
  shape?: ShapeElement;
  image?: ImageElement;
}

/**
 * A page surface: full-bleed background layers filling the whole surface, and
 * the designed elements laid out against the TRIM box inside it.
 *
 * That split is the whole point of bleed. Artwork runs past the cut line so
 * there's no white sliver if the knife wanders; text and placed elements stay
 * on the trim box, at the physical position they were designed at, whether or
 * not this pass includes bleed.
 */
function PrintPage({
  target,
  design,
  artwork,
}: {
  target: PrintTarget;
  design: BookDesign;
  artwork?: ResolvedArtwork;
}) {
  const { page, bleedPx } = target;
  // Only fetch when nothing was pre-resolved: passing `undefined` keeps the
  // hook call unconditional (and inert) on the export path.
  const fetched = useBlobUrl(artwork ? undefined : page.blobId);
  const url = (page.blobId ? artwork?.[page.blobId] : undefined) ?? fetched;

  const pd = design.pages[page.id] ?? { textBoxes: [] };
  const W = target.surfaceWidthPx - bleedPx * 2;
  const H = target.surfaceHeightPx - bleedPx * 2;

  const hasIllustrationEl = (pd.images ?? []).some((im) => im.kind === "illustration");

  // Keep the full-bleed crop consistent with the editor: covers anchor to the
  // top so a baked-in title isn't shaved when the art overflows the trim.
  const bgFocus = defaultIllustrationFocus(page);
  const bgObjectPosition = bgFocus
    ? `${(bgFocus.x * 100).toFixed(2)}% ${(bgFocus.y * 100).toFixed(2)}%`
    : undefined;

  const stacked: Stacked[] = [
    ...pd.textBoxes.map((b) => ({ id: b.id, z: b.z, rect: b.rect, rotation: b.rotation, hidden: b.hidden, box: b })),
    ...(pd.shapes ?? []).map((s) => ({ id: s.id, z: s.z, rect: s.rect, rotation: s.rotation, hidden: s.hidden, shape: s })),
    ...(pd.images ?? []).map((im) => ({ id: im.id, z: im.z, rect: im.rect, rotation: im.rotation, hidden: im.hidden, image: im })),
  ]
    .filter((el) => !el.hidden)
    .sort((a, b) => a.z - b.z);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* Background layers fill the surface edge to edge, bleed included. */}
      {pd.background?.color && <div style={{ position: "absolute", inset: 0, background: pd.background.color }} />}
      {pd.background?.pattern && <PatternFill config={pd.background.pattern} />}
      {url && !hasIllustrationEl && (
        <img
          src={url}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: bgObjectPosition,
          }}
        />
      )}

      {/* Trim layer: everything the reader must not lose to the knife. */}
      <div style={{ position: "absolute", left: bleedPx, top: bleedPx, width: W, height: H }}>
        {stacked.map((el) => {
          const w = el.rect.w * W;
          const h = el.rect.h * H;
          const wrapEffects =
            el.shape || el.image
              ? {
                  filter: cssFilter((el.shape ?? el.image)?.effects, H),
                  opacity: el.image ? el.image.opacity ?? el.image.effects?.opacity ?? 1 : undefined,
                }
              : {};
          return (
            <div
              key={el.id}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: w,
                height: h,
                transform: `translate(${el.rect.x * W}px, ${el.rect.y * H}px) rotate(${el.rotation ?? 0}deg)`,
                ...wrapEffects,
              }}
            >
              {el.box ? (
                <TextBoxView box={el.box} pageHeight={H} w={w} h={h} aspect={W / H} />
              ) : el.shape ? (
                <ShapeSvg shape={el.shape} w={w} h={h} pageHeight={H} />
              ) : el.image ? (
                <PrintImage
                  image={el.image}
                  w={w}
                  h={h}
                  illustrationUrl={url ?? undefined}
                  artwork={artwork}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PrintImage({
  image,
  w,
  h,
  illustrationUrl,
  artwork,
}: {
  image: ImageElement;
  w: number;
  h: number;
  illustrationUrl?: string;
  artwork?: ResolvedArtwork;
}) {
  const fetched = useBlobUrl(artwork || image.kind !== "asset" ? undefined : image.blobId);
  const assetUrl = (image.blobId ? artwork?.[image.blobId] : undefined) ?? fetched;
  const src = image.kind === "illustration" ? illustrationUrl : assetUrl ?? undefined;
  if (!src) return null;
  const radius = (image.corner ?? 0) * Math.min(w, h);
  // A rescaled illustration shown whole leaves blank bars in print too — fill
  // them with a blurred, zoomed copy so the printed page matches the editor.
  const showBackdrop = image.fit === "contain" && image.kind === "illustration";
  if (showBackdrop) {
    return (
      <div style={{ position: "relative", width: w, height: h, overflow: "hidden", borderRadius: radius }}>
        <img
          src={src}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: w,
            height: h,
            objectFit: "cover",
            filter: `blur(${h * 0.04}px)`,
            transform: "scale(1.1)",
            opacity: 0.85,
          }}
        />
        <img
          src={src}
          alt=""
          style={{ position: "relative", width: w, height: h, objectFit: "contain" }}
        />
      </div>
    );
  }
  if (image.fit === "contain") {
    return (
      <img src={src} alt="" style={{ width: w, height: h, objectFit: "contain", borderRadius: radius }} />
    );
  }
  // cover: object-position handles the focal point; an extra transform scale
  // (anchored at the same point) applies the zoom, matching the editor's crop.
  const zoom = Math.max(1, image.zoom ?? 1);
  const fx = image.focus?.x ?? 0.5;
  const fy = image.focus?.y ?? 0.5;
  const pos = `${(fx * 100).toFixed(2)}% ${(fy * 100).toFixed(2)}%`;
  return (
    <div style={{ position: "relative", width: w, height: h, overflow: "hidden", borderRadius: radius }}>
      <img
        src={src}
        alt=""
        style={{
          width: w,
          height: h,
          objectFit: "cover",
          objectPosition: pos,
          transform: zoom > 1 ? `scale(${zoom})` : undefined,
          transformOrigin: pos,
        }}
      />
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
