import type { BookDesign, ImageElement, ShapeElement, TextBox } from "../../core/types";
import { defaultIllustrationFocus, type DesignPage } from "./designInit";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { cssFilter } from "./effects";
import { PatternFill } from "./patterns";
import { ShapeSvg } from "./ShapeRender";
import { TextBoxView } from "./TextBoxView";

/**
 * A print-friendly, read-only rendering of every page (one per sheet).
 *
 * Pages share a common pixel height; spreads (aspect ≈ 2×) are simply twice as
 * wide. `pageHeightPx` lets the export pipeline render at print resolution while
 * the on-screen `window.print()` path keeps a comfortable default.
 */
export function PrintBook({
  pages,
  design,
  trimIn,
  pageHeightPx = 900,
  forExport = false,
}: {
  pages: DesignPage[];
  design: BookDesign;
  /** When set, emits an `@page` rule sized to the book's real trim for `window.print()`. */
  trimIn?: { widthIn: number; heightIn: number };
  /** Pixel height of a single page (export uses trimHeightIn × DPI). */
  pageHeightPx?: number;
  /** Export mode renders pages stacked with no page-break CSS for snapshotting. */
  forExport?: boolean;
}) {
  return (
    <div className={forExport ? "export-root" : "print-root"}>
      {trimIn && !forExport && <PageSizeStyle trimIn={trimIn} />}
      {pages.map((page) => (
        <PrintPage
          key={page.id}
          page={page}
          design={design}
          height={pageHeightPx}
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

function PrintPage({
  page,
  design,
  height = 900,
  forExport = false,
}: {
  page: DesignPage;
  design: BookDesign;
  height?: number;
  forExport?: boolean;
}) {
  const url = useBlobUrl(page.blobId);
  const pd = design.pages[page.id] ?? { textBoxes: [] };
  const H = height;
  const W = Math.round(H * page.aspect);

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
    <div
      className={forExport ? "export-page" : "print-page"}
      data-export-page={forExport ? page.id : undefined}
      style={{
        width: W,
        height: H,
        position: "relative",
        overflow: "hidden",
        background: "#fff",
        // Force backgrounds/colors to print exactly as designed.
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
    >
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
              <PrintImage image={el.image} w={w} h={h} illustrationUrl={url ?? undefined} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PrintImage({
  image,
  w,
  h,
  illustrationUrl,
}: {
  image: ImageElement;
  w: number;
  h: number;
  illustrationUrl?: string;
}) {
  const assetUrl = useBlobUrl(image.kind === "asset" ? image.blobId : undefined);
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
