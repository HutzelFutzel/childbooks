import { useState, type CSSProperties } from "react";
import type {
  ImageElement,
  PageBackground,
  PageDesign,
  PrintBleedMode,
  ShapeElement,
  TextBox,
} from "../../core/types";
import { coverPlacement, type FrameInsets } from "../../core/imageGeometry";
import { illustrationLeaf } from "../../core/book/pairSurface";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { useAppConfigStore } from "../../state/appConfigStore";
import { cssFilter } from "./effects";
import { imageMaskStyle, type ResolvedImageMasks } from "./imageMasks";
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

/** Second leaf of a facing pair: own background and page art, same trim height. */
export interface CompositedRightSurface {
  background?: PageBackground;
  illustrationBlobId?: string;
  illustrationUrl?: string | null;
  illustrationFocus?: { x: number; y: number };
}

/** Neighbor page art on a single-leaf (ebook) capture, bound by `pairLeaf`. */
export interface OverflowIllustration {
  blobId?: string;
  url?: string | null;
  pairLeaf: "left" | "right";
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
 * A page surface as printed: page background across the surface, then the
 * illustration and designed elements in the trim box. The server capture step
 * extends the finished trim edge into sacrificial print bleed without scaling
 * the composition the reader approved.
 *
 * Shared by the print/export pipeline and on-screen cover previews so thumbnails
 * match what the reader gets.
 */
export function CompositedPage({
  pageDesign,
  surfaceWidthPx,
  surfaceHeightPx,
  bleedPx = 0,
  bleedMode = "mirror",
  bleedSides,
  illustrationBlobId,
  illustrationUrl,
  artwork,
  imageMasks,
  illustrationFocus,
  rightSurface,
  overflowIllustration,
}: {
  pageDesign: PageDesign;
  surfaceWidthPx: number;
  surfaceHeightPx: number;
  bleedPx?: number;
  bleedMode?: PrintBleedMode;
  /** Physical outside edges for this target; cover spine edges are excluded. */
  bleedSides?: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  illustrationBlobId?: string;
  /** Pre-resolved illustration URL. Wins over fetching `illustrationBlobId`. */
  illustrationUrl?: string | null;
  artwork?: ResolvedArtwork;
  /** Pre-resolved immutable mask URLs (print); public catalog is the UI fallback. */
  imageMasks?: ResolvedImageMasks;
  illustrationFocus?: { x: number; y: number };
  /** Facing right leaf — backgrounds and page art stay per-page. */
  rightSurface?: CompositedRightSurface;
  /** Ebook guest: overflowing neighbor page art, keyed by `pairLeaf`. */
  overflowIllustration?: OverflowIllustration;
}) {
  const configuredMasks = useAppConfigStore((state) => state.imageMasks.assets);
  const fetched = useBlobUrl(
    illustrationUrl || artwork ? undefined : illustrationBlobId,
  );
  const url =
    illustrationUrl ??
    (illustrationBlobId ? artwork?.[illustrationBlobId] : undefined) ??
    fetched;
  const rightFetched = useBlobUrl(
    rightSurface && (rightSurface.illustrationUrl || artwork)
      ? undefined
      : rightSurface?.illustrationBlobId,
  );
  const rightUrl = rightSurface
    ? (rightSurface.illustrationUrl ??
      (rightSurface.illustrationBlobId
        ? artwork?.[rightSurface.illustrationBlobId]
        : undefined) ??
      rightFetched)
    : undefined;
  const overflowFetched = useBlobUrl(
    overflowIllustration && (overflowIllustration.url || artwork)
      ? undefined
      : overflowIllustration?.blobId,
  );
  const overflowUrl = overflowIllustration
    ? (overflowIllustration.url ??
      (overflowIllustration.blobId
        ? artwork?.[overflowIllustration.blobId]
        : undefined) ??
      overflowFetched)
    : undefined;

  const W = surfaceWidthPx - bleedPx * 2;
  const H = surfaceHeightPx - bleedPx * 2;
  const foldX = bleedPx + W / 2;
  const ownerLeaf = (image: ImageElement) => illustrationLeaf(image);
  const imageOnRight = (image: ImageElement) =>
    Boolean(rightSurface) && ownerLeaf(image) === "right";
  const urlForImage = (image: ImageElement) => {
    if (
      image.kind === "illustration" &&
      overflowIllustration &&
      image.pairLeaf === overflowIllustration.pairLeaf
    ) {
      return overflowUrl;
    }
    return imageOnRight(image) ? rightUrl : url;
  };
  const fitIllustrationsToBleed = bleedPx > 0 && bleedMode === "fit";
  const physicalBleedSides = bleedSides ?? {
    top: true,
    right: true,
    bottom: true,
    left: true,
  };

  const isOwnIllustration = (im: ImageElement) =>
    im.kind === "illustration" &&
    !(overflowIllustration && im.pairLeaf === overflowIllustration.pairLeaf);
  const hasIllustrationEl = (pageDesign.images ?? []).some(isOwnIllustration);
  const hasIllustrationElLeft = (pageDesign.images ?? []).some(
    (im) => isOwnIllustration(im) && !imageOnRight(im),
  );
  const hasIllustrationElRight = (pageDesign.images ?? []).some(
    (im) => isOwnIllustration(im) && imageOnRight(im),
  );
  const illustrationBleedInsets = (image: ImageElement): FrameInsets | undefined => {
    if (
      !fitIllustrationsToBleed ||
      image.kind !== "illustration" ||
      image.fit === "contain" ||
      image.imageMaskId ||
      (image.corner ?? 0) > 0 ||
      Math.abs(image.rotation ?? 0) > 0.001
    ) {
      return undefined;
    }
    const pageStart = 0;
    const pageEnd = 1;
    const tolerance = 0.001;
    const insets = {
      top:
        physicalBleedSides.top && image.rect.y <= tolerance ? bleedPx : 0,
      right:
        physicalBleedSides.right &&
        image.rect.x + image.rect.w >= pageEnd - tolerance
          ? bleedPx
          : 0,
      bottom:
        physicalBleedSides.bottom &&
        image.rect.y + image.rect.h >= 1 - tolerance
          ? bleedPx
          : 0,
      left:
        physicalBleedSides.left && image.rect.x <= pageStart + tolerance ? bleedPx : 0,
    };
    return insets.top + insets.right + insets.bottom + insets.left > 0
      ? insets
      : undefined;
  };
  const legacyBleed = fitIllustrationsToBleed
    ? {
        top: physicalBleedSides.top ? bleedPx : 0,
        right: physicalBleedSides.right ? bleedPx : 0,
        bottom: physicalBleedSides.bottom ? bleedPx : 0,
        left: physicalBleedSides.left ? bleedPx : 0,
      }
    : { top: 0, right: 0, bottom: 0, left: 0 };
  const legacyW = W + legacyBleed.left + legacyBleed.right;
  const legacyH = H + legacyBleed.top + legacyBleed.bottom;
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

  const renderFittedBleedArtwork = () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: surfaceWidthPx,
        height: surfaceHeightPx,
      }}
    >
      {rightSurface ? (
        <>
          {url && !hasIllustrationElLeft && (
            <LegacyHalfArt
              src={url}
              left={bleedPx - (physicalBleedSides.left ? legacyBleed.left : 0)}
              top={bleedPx - legacyBleed.top}
              width={W / 2 + (physicalBleedSides.left ? legacyBleed.left : 0)}
              height={legacyH}
              focus={illustrationFocus}
            />
          )}
          {rightUrl && !hasIllustrationElRight && (
            <LegacyHalfArt
              src={rightUrl}
              left={foldX}
              top={bleedPx - legacyBleed.top}
              width={W / 2 + (physicalBleedSides.right ? legacyBleed.right : 0)}
              height={legacyH}
              focus={rightSurface.illustrationFocus}
            />
          )}
        </>
      ) : (
        url &&
        !hasIllustrationEl && (
          <div
            style={{
              position: "absolute",
              left: bleedPx - legacyBleed.left,
              top: bleedPx - legacyBleed.top,
              width: legacyW,
              height: legacyH,
              overflow: "hidden",
            }}
          >
            <CoverImage
              src={url}
              w={legacyW}
              h={legacyH}
              focus={illustrationFocus}
            />
          </div>
        )
      )}
      {stacked.map((el) => {
        if (!el.image) return null;
        const imageBleed = illustrationBleedInsets(el.image);
        if (!imageBleed) return null;
        const w = el.rect.w * W;
        const h = el.rect.h * H;
        const renderW = w + imageBleed.left + imageBleed.right;
        const renderH = h + imageBleed.top + imageBleed.bottom;
        return (
          <div
            key={el.id}
            style={{
              position: "absolute",
              left: bleedPx + el.rect.x * W - imageBleed.left,
              top: bleedPx + el.rect.y * H - imageBleed.top,
              width: renderW,
              height: renderH,
              filter: cssFilter(el.image.effects, H),
              opacity: el.image.opacity ?? el.image.effects?.opacity ?? 1,
            }}
          >
            <CompositedImage
              image={el.image}
              w={renderW}
              h={renderH}
              pageHeight={H}
              illustrationUrl={urlForImage(el.image) ?? undefined}
              artwork={artwork}
            />
          </div>
        );
      })}
    </div>
  );
  const fittedBleedStrips = fitIllustrationsToBleed
    ? [
        physicalBleedSides.top
          ? { id: "top", left: 0, top: 0, width: surfaceWidthPx, height: bleedPx }
          : null,
        physicalBleedSides.bottom
          ? {
              id: "bottom",
              left: 0,
              top: bleedPx + H,
              width: surfaceWidthPx,
              height: bleedPx,
            }
          : null,
        physicalBleedSides.left
          ? { id: "left", left: 0, top: bleedPx, width: bleedPx, height: H }
          : null,
        physicalBleedSides.right
          ? {
              id: "right",
              left: bleedPx + W,
              top: bleedPx,
              width: bleedPx,
              height: H,
            }
          : null,
      ].filter(
        (
          strip,
        ): strip is {
          id: string;
          left: number;
          top: number;
          width: number;
          height: number;
        } => strip !== null,
      )
    : [];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: surfaceWidthPx,
        height: surfaceHeightPx,
        overflow: "hidden",
      }}
    >
      {rightSurface ? (
        <>
          <HalfBackground
            background={pageDesign.background}
            left={0}
            width={foldX}
            height={surfaceHeightPx}
          />
          <HalfBackground
            background={rightSurface.background}
            left={foldX}
            width={surfaceWidthPx - foldX}
            height={surfaceHeightPx}
          />
        </>
      ) : (
        <>
          {pageDesign.background?.color && (
            <div style={{ position: "absolute", inset: 0, background: pageDesign.background.color }} />
          )}
          {pageDesign.background?.pattern && <PatternFill config={pageDesign.background.pattern} />}
        </>
      )}
      {fittedBleedStrips.map((strip) => (
        <div
          key={strip.id}
          style={{
            position: "absolute",
            left: strip.left,
            top: strip.top,
            width: strip.width,
            height: strip.height,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -strip.left,
              top: -strip.top,
              width: surfaceWidthPx,
              height: surfaceHeightPx,
            }}
          >
            {renderFittedBleedArtwork()}
          </div>
        </div>
      ))}

      <div
        style={{
          position: "absolute",
          left: bleedPx,
          top: bleedPx,
          width: W,
          height: H,
          overflow: "hidden",
        }}
      >
        {rightSurface ? (
          <>
            {url && !hasIllustrationElLeft && (
              <LegacyHalfArt
                src={url}
                left={-legacyBleed.left}
                top={-legacyBleed.top}
                width={W / 2 + legacyBleed.left}
                height={legacyH}
                focus={illustrationFocus}
              />
            )}
            {rightUrl && !hasIllustrationElRight && (
              <LegacyHalfArt
                src={rightUrl}
                left={W / 2}
                top={-legacyBleed.top}
                width={W / 2 + legacyBleed.right}
                height={legacyH}
                focus={rightSurface.illustrationFocus}
              />
            )}
          </>
        ) : (
          url &&
          !hasIllustrationEl && (
            <div
              style={{
                position: "absolute",
                left: -legacyBleed.left,
                top: -legacyBleed.top,
                width: legacyW,
                height: legacyH,
                overflow: "hidden",
              }}
            >
              <CoverImage
                src={url}
                w={legacyW}
                h={legacyH}
                focus={illustrationFocus}
              />
            </div>
          )
        )}
        {stacked.map((el) => {
          const w = el.rect.w * W;
          const h = el.rect.h * H;
          const imageBleed = el.image
            ? illustrationBleedInsets(el.image)
            : undefined;
          const renderW = w + (imageBleed?.left ?? 0) + (imageBleed?.right ?? 0);
          const renderH = h + (imageBleed?.top ?? 0) + (imageBleed?.bottom ?? 0);
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
                width: renderW,
                height: renderH,
                transform: `translate(${el.rect.x * W - (imageBleed?.left ?? 0)}px, ${el.rect.y * H - (imageBleed?.top ?? 0)}px) rotate(${el.rotation ?? 0}deg)`,
                ...wrapEffects,
              }}
            >
              {el.box ? (
                <TextBoxView box={el.box} pageHeight={H} w={w} h={h} aspect={W / H} />
              ) : el.shape ? (
                <ShapeSvg shape={el.shape} w={w} h={h} pageHeight={H} aspect={W / H} />
              ) : el.image ? (
                <CompositedImage
                  image={el.image}
                  w={renderW}
                  h={renderH}
                  pageHeight={H}
                  illustrationUrl={urlForImage(el.image) ?? undefined}
                  artwork={artwork}
                  maskUrl={
                    el.image.imageMaskId
                      ? imageMasks?.[el.image.imageMaskId] ??
                        configuredMasks.find((mask) => mask.id === el.image?.imageMaskId)?.imageUrl
                      : undefined
                  }
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HalfBackground({
  background,
  left,
  width,
  height,
}: {
  background?: PageBackground;
  left: number;
  width: number;
  height: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top: 0,
        width,
        height,
        overflow: "hidden",
      }}
    >
      {background?.color && (
        <div style={{ position: "absolute", inset: 0, background: background.color }} />
      )}
      {background?.pattern && <PatternFill config={background.pattern} />}
    </div>
  );
}

function LegacyHalfArt({
  src,
  left,
  top,
  width,
  height,
  focus,
}: {
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  focus?: { x: number; y: number };
}) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        overflow: "hidden",
      }}
    >
      <CoverImage src={src} w={width} h={height} focus={focus} />
    </div>
  );
}

function CompositedImage({
  image,
  w,
  h,
  pageHeight,
  illustrationUrl,
  artwork,
  maskUrl,
}: {
  image: ImageElement;
  w: number;
  h: number;
  pageHeight: number;
  illustrationUrl?: string;
  artwork?: ResolvedArtwork;
  maskUrl?: string;
}) {
  const fetched = useBlobUrl(artwork || image.kind !== "asset" ? undefined : image.blobId);
  const assetUrl = (image.blobId ? artwork?.[image.blobId] : undefined) ?? fetched;
  const src = image.kind === "illustration" ? illustrationUrl : assetUrl ?? undefined;
  if (!src) return null;
  const radius = image.imageMaskId ? 0 : (image.corner ?? 0) * Math.min(w, h);
  const mask = imageMaskStyle(maskUrl);
  const backdropMode = image.fitBackdrop ?? (image.kind === "illustration" ? "blur" : "none");
  const showBackdrop = image.fit === "contain" && backdropMode === "blur";
  if (showBackdrop) {
    return (
      <div
        style={{
          position: "relative",
          width: w,
          height: h,
          overflow: "hidden",
          borderRadius: radius,
          ...mask,
        }}
      >
        <CoverImage
          src={src}
          w={w}
          h={h}
          zoom={image.zoom}
          focus={image.focus}
          imageStyle={{
            filter: `blur(${pageHeight * 0.04}px)`,
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
      <div style={{ width: w, height: h, overflow: "hidden", borderRadius: radius, ...mask }}>
        <img src={src} alt="" style={{ width: w, height: h, objectFit: "contain" }} />
      </div>
    );
  }
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        overflow: "hidden",
        borderRadius: radius,
        ...mask,
      }}
    >
      <CoverImage
        src={src}
        w={w}
        h={h}
        zoom={image.zoom}
        focus={image.focus}
      />
    </div>
  );
}

/**
 * A clipped Fill image using the same source-crop semantics as Konva.
 *
 * CSS `object-position: 25%` means "move through 25% of the leftover space",
 * while the editor stores 25% as the desired crop centre. Explicit bitmap
 * placement avoids that semantic mismatch for every PDF/server capture.
 */
function CoverImage({
  src,
  w,
  h,
  zoom,
  focus,
  imageStyle,
}: {
  src: string;
  w: number;
  h: number;
  zoom?: number;
  focus?: { x: number; y: number };
  imageStyle?: CSSProperties;
}) {
  const [natural, setNatural] = useState<{
    src: string;
    width: number;
    height: number;
  } | null>(null);
  const current = natural?.src === src ? natural : null;
  const placement = current
    ? coverPlacement(current.width, current.height, w, h, zoom, focus)
    : null;

  return (
    <img
      src={src}
      alt=""
      data-cover-image=""
      data-framing-ready={placement ? "true" : "false"}
      onLoad={(event) => {
        const img = event.currentTarget;
        setNatural({
          src,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
        });
      }}
      style={
        placement
          ? {
              position: "absolute",
              left: placement.x,
              top: placement.y,
              width: placement.width,
              height: placement.height,
              maxWidth: "none",
              ...imageStyle,
            }
          : {
              position: "absolute",
              inset: 0,
              width: w,
              height: h,
              objectFit: "cover",
              ...imageStyle,
            }
      }
    />
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
