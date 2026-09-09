import { useEffect, useRef, useState } from "react";
import Konva from "konva";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import type { ImageElement } from "../../../core/types";
import type { ImageActionId } from "../../../core/ai/actions";
import {
  coverCropRect,
  coverCropRectWithInsets,
  type FrameInsets,
} from "../../../core/imageGeometry";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { konvaShadow } from "../effects";
import { useImage } from "./useImage";
import { KonvaArtBusyVeil } from "./KonvaArtBusyVeil";

/** Konva contents for a placed image (positioned by the owning <Group>). */
export function KonvaImageElement({
  el,
  w,
  h,
  pageHeight,
  bleedInsets,
  illustrationUrl,
  generating,
  busyAction,
  busyRefCount,
  busyCompact,
}: {
  el: ImageElement;
  w: number;
  h: number;
  pageHeight: number;
  /** Physical bleed added around this frame in fit-to-bleed mode. */
  bleedInsets?: FrameInsets;
  /** URL for the page's generated illustration (used by kind "illustration"). */
  illustrationUrl?: string;
  /** Show an in-layer generation veil (must not change element z). */
  generating?: boolean;
  busyAction?: ImageActionId;
  busyRefCount?: number;
  busyCompact?: boolean;
}) {
  const assetUrl = useBlobUrl(el.kind === "asset" ? el.blobId : undefined);
  const url = el.kind === "illustration" ? illustrationUrl : assetUrl ?? undefined;
  const image = useImage(url);
  const maskUrl = useAppConfigStore(
    (state) => state.imageMasks.assets.find((mask) => mask.id === el.imageMaskId)?.imageUrl,
  );
  const maskImage = useImage(maskUrl);
  const imgRef = useRef<Konva.Image>(null);
  const bgRef = useRef<Konva.Image>(null);

  const shadow = konvaShadow(el.effects, pageHeight) ?? undefined;
  const blurPx = (el.effects?.blur ?? 0) * pageHeight;
  const cornerR = (el.corner ?? 0) * Math.min(w, h);

  const iw = image ? image.naturalWidth || image.width : 0;
  const ih = image ? image.naturalHeight || image.height : 0;

  // Fit ("contain") can leave blank bars. Optional soft letterbox fills them
  // with a blurred zoom of the same art; "none" leaves them transparent.
  const backdropMode = el.fitBackdrop ?? (el.kind === "illustration" ? "blur" : "none");
  const showBackdrop = Boolean(image && el.fit === "contain" && backdropMode === "blur");
  const backdropBlurPx = pageHeight * 0.04;

  // Gaussian blur needs an offscreen cache; (re)build it when relevant inputs change.
  const maskedCanvas = useMaskedCanvas({
    image,
    mask: maskImage,
    enabled: Boolean(el.imageMaskId),
    w,
    h,
    fit: el.fit,
    zoom: el.zoom,
    focus: el.focus,
    showBackdrop,
    backdropBlurPx,
  });

  useEffect(() => {
    const node = imgRef.current;
    if (!node || !(maskedCanvas ?? image)) return;
    if (blurPx > 0) {
      node.cache();
      node.filters([Konva.Filters.Blur]);
      node.blurRadius(blurPx);
    } else {
      node.filters([]);
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [blurPx, image, maskedCanvas, w, h, el.fit]);

  // Cache + blur the backdrop copy (only mounted when a contained illustration
  // needs the fill).
  useEffect(() => {
    const node = bgRef.current;
    if (!node || !image || !showBackdrop) return;
    node.cache();
    node.filters([Konva.Filters.Blur]);
    node.blurRadius(backdropBlurPx);
    node.getLayer()?.batchDraw();
  }, [image, showBackdrop, backdropBlurPx, w, h]);

  const coverCrop = () =>
    bleedInsets
      ? coverCropRectWithInsets(iw, ih, w, h, bleedInsets, el.zoom, el.focus)
      : coverCropRect(iw, ih, w, h, el.zoom, el.focus);

  let drawn = { x: 0, y: 0, width: w, height: h, crop: undefined as undefined | { x: number; y: number; width: number; height: number } };
  if (image && iw && ih) {
    if (el.fit === "contain") {
      const scale = Math.min(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      drawn = { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh, crop: undefined };
    } else {
      // cover: crop the source to the box aspect (object-fit: cover).
      drawn = { x: 0, y: 0, width: w, height: h, crop: coverCrop() };
    }
  }

  return (
    <>
      {/* Hit/drag surface over the whole bounding box. */}
      <Rect width={w} height={h} fill="#fff" opacity={0} />
      {image && (
        <Group
          clipFunc={
            !el.imageMaskId && cornerR > 0
              ? (ctx) => roundedRectPath(ctx, 0, 0, w, h, cornerR)
              : undefined
          }
        >
          {el.imageMaskId ? (
            maskedCanvas ? (
              <KonvaImage
                ref={imgRef}
                image={maskedCanvas}
                width={w}
                height={h}
                listening={false}
                {...shadow}
              />
            ) : null
          ) : (
            <>
          {showBackdrop && iw > 0 && ih > 0 && (
            <KonvaImage
              ref={bgRef}
              image={image}
              x={0}
              y={0}
              width={w}
              height={h}
              crop={coverCrop()}
              opacity={0.85}
              listening={false}
            />
          )}
          <KonvaImage
            ref={imgRef}
            image={image}
            x={drawn.x}
            y={drawn.y}
            width={drawn.width}
            height={drawn.height}
            crop={drawn.crop}
            listening={false}
            {...shadow}
          />
            </>
          )}
        </Group>
      )}
      {/* Soft placeholder when generating before the first bitmap lands. */}
      {!image && generating && (
        <Rect width={w} height={h} fill="#EDE8DF" listening={false} />
      )}
      {generating && (
        <KonvaArtBusyVeil
          w={w}
          h={h}
          action={busyAction ?? "pageIllustration"}
          refCount={busyRefCount ?? 0}
          compact={busyCompact}
        />
      )}
    </>
  );
}

function useMaskedCanvas({
  image,
  mask,
  enabled,
  w,
  h,
  fit,
  zoom,
  focus,
  showBackdrop,
  backdropBlurPx,
}: {
  image: HTMLImageElement | null;
  mask: HTMLImageElement | null;
  enabled: boolean;
  w: number;
  h: number;
  fit: ImageElement["fit"];
  zoom?: number;
  focus?: ImageElement["focus"];
  showBackdrop: boolean;
  backdropBlurPx: number;
}): HTMLCanvasElement | null {
  const [result, setResult] = useState<{
    sourceKey: string;
    canvas: HTMLCanvasElement;
  } | null>(null);
  const sourceKey =
    enabled && image && mask
      ? `${image.currentSrc || image.src}|${mask.currentSrc || mask.src}`
      : null;

  useEffect(() => {
    if (!sourceKey || !image || !mask || w <= 0 || h <= 0) {
      setResult(null);
      return;
    }
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih) {
      setResult(null);
      return;
    }

    const cw = Math.max(1, Math.ceil(w));
    const ch = Math.max(1, Math.ceil(h));
    const next = document.createElement("canvas");
    next.width = cw;
    next.height = ch;
    const ctx = next.getContext("2d");
    if (!ctx) {
      setResult(null);
      return;
    }
    ctx.scale(cw / w, ch / h);

    const cropForCover = () =>
      coverCropRect(iw, ih, w, h, zoom, focus);
    const drawCover = () => {
      const crop = cropForCover();
      ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
    };

    if (showBackdrop) {
      ctx.save();
      ctx.filter = `blur(${backdropBlurPx}px)`;
      ctx.globalAlpha = 0.85;
      drawCover();
      ctx.restore();
    }
    if (fit === "contain") {
      const scale = Math.min(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      drawCover();
    }

    ctx.globalCompositeOperation = "destination-in";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.drawImage(mask, 0, 0, w, h);
    setResult({ sourceKey, canvas: next });
  }, [
    image,
    mask,
    enabled,
    w,
    h,
    fit,
    zoom,
    focus?.x,
    focus?.y,
    showBackdrop,
    backdropBlurPx,
    sourceKey,
  ]);

  return result?.sourceKey === sourceKey ? result.canvas : null;
}

function roundedRectPath(
  ctx: Konva.Context | CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
