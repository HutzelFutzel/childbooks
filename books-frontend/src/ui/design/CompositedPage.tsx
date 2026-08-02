import type { ImageElement, PageDesign, ShapeElement, TextBox } from "../../core/types";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { cssFilter } from "./effects";
import { PatternFill } from "./patterns";
import { ShapeSvg } from "./ShapeRender";
import { TextBoxView } from "./TextBoxView";

/**
 * Resolved artwork for a render pass: blob id -> object URL.
 *
 * Export passes resolve every blob BEFORE the stage mounts and hand the result
 * in here, so a page renders its illustration on its first paint.
 */
export type ResolvedArtwork = Record<string, string>;

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
 * A page surface as printed: full-bleed background + illustration, then designed
 * elements (text boxes, shapes, images) on the trim box.
 *
 * Shared by the print/export pipeline and on-screen cover previews so thumbnails
 * match what the reader gets.
 */
export function CompositedPage({
  pageDesign,
  surfaceWidthPx,
  surfaceHeightPx,
  bleedPx = 0,
  illustrationBlobId,
  illustrationUrl,
  artwork,
  illustrationFocus,
}: {
  pageDesign: PageDesign;
  surfaceWidthPx: number;
  surfaceHeightPx: number;
  bleedPx?: number;
  illustrationBlobId?: string;
  /** Pre-resolved illustration URL. Wins over fetching `illustrationBlobId`. */
  illustrationUrl?: string | null;
  artwork?: ResolvedArtwork;
  illustrationFocus?: { x: number; y: number };
}) {
  const fetched = useBlobUrl(
    illustrationUrl || artwork ? undefined : illustrationBlobId,
  );
  const url =
    illustrationUrl ??
    (illustrationBlobId ? artwork?.[illustrationBlobId] : undefined) ??
    fetched;

  const W = surfaceWidthPx - bleedPx * 2;
  const H = surfaceHeightPx - bleedPx * 2;

  const hasIllustrationEl = (pageDesign.images ?? []).some((im) => im.kind === "illustration");
  const bgObjectPosition = illustrationFocus
    ? `${(illustrationFocus.x * 100).toFixed(2)}% ${(illustrationFocus.y * 100).toFixed(2)}%`
    : undefined;

  const stacked: Stacked[] = [
    ...pageDesign.textBoxes.map((b) => ({
      id: b.id,
      z: b.z,
      rect: b.rect,
      rotation: b.rotation,
      hidden: b.hidden,
      box: b,
    })),
    ...(pageDesign.shapes ?? []).map((s) => ({
      id: s.id,
      z: s.z,
      rect: s.rect,
      rotation: s.rotation,
      hidden: s.hidden,
      shape: s,
    })),
    ...(pageDesign.images ?? []).map((im) => ({
      id: im.id,
      z: im.z,
      rect: im.rect,
      rotation: im.rotation,
      hidden: im.hidden,
      image: im,
    })),
  ]
    .filter((el) => !el.hidden)
    .sort((a, b) => a.z - b.z);

  return (
    <div style={{ position: "absolute", inset: 0, width: surfaceWidthPx, height: surfaceHeightPx }}>
      {pageDesign.background?.color && (
        <div style={{ position: "absolute", inset: 0, background: pageDesign.background.color }} />
      )}
      {pageDesign.background?.pattern && <PatternFill config={pageDesign.background.pattern} />}
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

      <div style={{ position: "absolute", left: bleedPx, top: bleedPx, width: W, height: H }}>
        {stacked.map((el) => {
          const w = el.rect.w * W;
          const h = el.rect.h * H;
          const wrapEffects =
            el.shape || el.image
              ? {
                  filter: cssFilter((el.shape ?? el.image)?.effects, H),
                  opacity: el.image
                    ? (el.image.opacity ?? el.image.effects?.opacity ?? 1)
                    : undefined,
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
                <CompositedImage
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

function CompositedImage({
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

/** True when the page design has anything beyond a blank surface. */
export function pageDesignHasContent(pd: PageDesign | undefined): boolean {
  if (!pd) return false;
  if (pd.textBoxes.length > 0) return true;
  if ((pd.shapes?.length ?? 0) > 0) return true;
  if ((pd.images?.length ?? 0) > 0) return true;
  if (pd.background?.color || pd.background?.pattern) return true;
  return false;
}
