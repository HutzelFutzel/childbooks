import { useMemo } from "react";
import { Shape } from "react-konva";
import type { ElementEffects } from "../../../core/types";
import { konvaShadow, shadowCastsOnBox, textBoxPlateRadius } from "../effects";

function roundRectPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Drop shadow for a text-box plate that stays visible even when the fill is
 * fully transparent.
 *
 * Konva/canvas shadows scale with fill alpha, so a near-invisible plate casts
 * a near-invisible shadow. We rasterize an opaque shadowed rect on an
 * offscreen canvas, punch out the solid fill, and draw only the soft shadow.
 */
export function KonvaBoxShadow({
  w,
  h,
  presetId,
  effects,
  pageHeight,
}: {
  w: number;
  h: number;
  presetId: string;
  effects: ElementEffects | undefined;
  pageHeight: number;
}) {
  const active = shadowCastsOnBox(effects);
  const props = active ? konvaShadow(effects, pageHeight) : null;
  const radius = textBoxPlateRadius(presetId, w, h);

  const shadowBlur = props?.shadowBlur ?? 0;
  const shadowOffsetX = props?.shadowOffsetX ?? 0;
  const shadowOffsetY = props?.shadowOffsetY ?? 0;
  const shadowOpacity = props?.shadowOpacity ?? 0;
  const shadowColor = props?.shadowColor ?? "#000000";

  const pad =
    shadowBlur * 2 + Math.max(Math.abs(shadowOffsetX), Math.abs(shadowOffsetY)) + 2;

  const sprite = useMemo(() => {
    if (!active || !(w > 0) || !(h > 0)) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(w + pad * 2));
    canvas.height = Math.max(1, Math.ceil(h + pad * 2));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.translate(pad, pad);
    roundRectPath(ctx, 0, 0, w, h, radius);
    ctx.fillStyle = shadowColor;
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowOffsetX;
    ctx.shadowOffsetY = shadowOffsetY;
    ctx.globalAlpha = shadowOpacity;
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();

    return canvas;
  }, [
    active,
    w,
    h,
    pad,
    radius,
    shadowBlur,
    shadowOffsetX,
    shadowOffsetY,
    shadowOpacity,
    shadowColor,
  ]);

  if (!sprite) return null;

  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        ctx.drawImage(sprite, -pad, -pad);
      }}
    />
  );
}
