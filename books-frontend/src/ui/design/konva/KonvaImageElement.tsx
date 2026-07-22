import { useEffect, useRef } from "react";
import Konva from "konva";
import { Group, Image as KonvaImage, Rect } from "react-konva";
import type { ImageElement } from "../../../core/types";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { konvaShadow } from "../effects";
import { useImage } from "./useImage";

/** Konva contents for a placed image (positioned by the owning <Group>). */
export function KonvaImageElement({
  el,
  w,
  h,
  pageHeight,
  illustrationUrl,
}: {
  el: ImageElement;
  w: number;
  h: number;
  pageHeight: number;
  /** URL for the page's generated illustration (used by kind "illustration"). */
  illustrationUrl?: string;
}) {
  const assetUrl = useBlobUrl(el.kind === "asset" ? el.blobId : undefined);
  const url = el.kind === "illustration" ? illustrationUrl : assetUrl ?? undefined;
  const image = useImage(url);
  const imgRef = useRef<Konva.Image>(null);
  const bgRef = useRef<Konva.Image>(null);

  const shadow = konvaShadow(el.effects, pageHeight) ?? undefined;
  const blurPx = (el.effects?.blur ?? 0) * pageHeight;
  const cornerR = (el.corner ?? 0) * Math.min(w, h);

  const iw = image ? image.naturalWidth || image.width : 0;
  const ih = image ? image.naturalHeight || image.height : 0;

  // A rescaled illustration shown whole ("contain") can leave blank bars; fill
  // them with a blurred, zoomed copy of the same art so the gap reads as an
  // intentional backdrop rather than empty page (the classic letterbox look).
  const showBackdrop = Boolean(image && el.fit === "contain" && el.kind === "illustration");
  const backdropBlurPx = pageHeight * 0.04;

  // Gaussian blur needs an offscreen cache; (re)build it when relevant inputs change.
  useEffect(() => {
    const node = imgRef.current;
    if (!node || !image) return;
    if (blurPx > 0) {
      node.cache();
      node.filters([Konva.Filters.Blur]);
      node.blurRadius(blurPx);
    } else {
      node.filters([]);
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [blurPx, image, w, h, el.fit]);

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

  // Emulate object-fit: cover + object-position + an extra zoom — crop the
  // source to the box aspect, scaled by `zoom` and positioned by `focus`.
  function coverCropRect() {
    const zoom = Math.max(1, el.zoom ?? 1);
    const scale = Math.max(w / iw, h / ih) * zoom;
    const cropW = w / scale;
    const cropH = h / scale;
    const fx = el.focus?.x ?? 0.5;
    const fy = el.focus?.y ?? 0.5;
    const x = clamp(fx * iw - cropW / 2, 0, Math.max(0, iw - cropW));
    const y = clamp(fy * ih - cropH / 2, 0, Math.max(0, ih - cropH));
    return { x, y, width: cropW, height: cropH };
  }

  let drawn = { x: 0, y: 0, width: w, height: h, crop: undefined as undefined | { x: number; y: number; width: number; height: number } };
  if (image && iw && ih) {
    if (el.fit === "contain") {
      const scale = Math.min(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      drawn = { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh, crop: undefined };
    } else {
      // cover: crop the source to the box aspect (object-fit: cover).
      drawn = { x: 0, y: 0, width: w, height: h, crop: coverCropRect() };
    }
  }

  return (
    <>
      {/* Hit/drag surface over the whole bounding box. */}
      <Rect width={w} height={h} fill="#fff" opacity={0} />
      {image && (
        <Group
          clipFunc={
            cornerR > 0
              ? (ctx) => roundedRectPath(ctx, 0, 0, w, h, cornerR)
              : undefined
          }
        >
          {showBackdrop && iw > 0 && ih > 0 && (
            <KonvaImage
              ref={bgRef}
              image={image}
              x={0}
              y={0}
              width={w}
              height={h}
              crop={coverCropRect()}
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
        </Group>
      )}
    </>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
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
