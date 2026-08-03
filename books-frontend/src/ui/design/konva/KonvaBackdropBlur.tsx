import { useEffect, useId, useRef } from "react";
import Konva from "konva";
import { Shape } from "react-konva";

function roundRectPath(
  ctx: {
    beginPath(): void;
    moveTo(x: number, y: number): void;
    arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
    closePath(): void;
  },
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

function isGroupBusy(group: Konva.Node): boolean {
  if (typeof (group as Konva.Group).isDragging === "function" && (group as Konva.Group).isDragging()) {
    return true;
  }
  // Mid-transform the group carries a non-identity scale from the Transformer.
  const sx = group.scaleX();
  const sy = group.scaleY();
  return Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6;
}

/**
 * Frosted-glass backdrop for a text box.
 *
 * Bakes a *stage-sized* blurred buffer of everything painted under this element
 * (debounced, when the scene behind changes). While dragging/resizing, that
 * buffer is only *sampled* under the live plate transform — no re-blur — so the
 * frost tracks the box in real time.
 */
export function KonvaBackdropBlur({
  w,
  h,
  blurPx,
  cornerRadius,
  /** Skip rebaking the under-buffer (e.g. mid-resize); live sampling continues. */
  pauseRebake = false,
}: {
  w: number;
  h: number;
  blurPx: number;
  cornerRadius: number;
  pauseRebake?: boolean;
}) {
  const shapeRef = useRef<Konva.Shape>(null);
  /** Stage-space blurred snapshot of content below this box. */
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const capturing = useRef(false);
  const ns = `backdrop${useId().replace(/:/g, "")}`;
  const pauseRef = useRef(pauseRebake);
  pauseRef.current = pauseRebake;

  useEffect(() => {
    if (!(blurPx > 0)) {
      bufferRef.current = null;
      shapeRef.current?.getLayer()?.batchDraw();
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const rebake = () => {
      if (cancelled || capturing.current) return;
      const shape = shapeRef.current;
      const group = shape?.getParent();
      const stage = shape?.getStage();
      const layer = shape?.getLayer();
      if (!shape || !group || !stage || !layer) return;
      if (pauseRef.current || isGroupBusy(group)) return;

      const children = layer.getChildren();
      const idx = children.findIndex((n) => n === group);
      if (idx < 0) return;

      capturing.current = true;
      const hidden: Konva.Node[] = [];
      try {
        // Hide this box + everything above so the export only has under-content.
        // Do NOT layer.draw() first — toCanvas renders offscreen, so the on-screen
        // frame keeps showing us (no flicker).
        for (let i = idx; i < children.length; i++) {
          const n = children[i];
          if (n.isVisible()) {
            n.visible(false);
            hidden.push(n);
          }
        }

        const sw = Math.max(1, Math.ceil(stage.width()));
        const sh = Math.max(1, Math.ceil(stage.height()));
        const stageCanvas = stage.toCanvas({ pixelRatio: 1 });

        const out = document.createElement("canvas");
        out.width = sw;
        out.height = sh;
        const ctx = out.getContext("2d");
        if (!ctx) return;
        ctx.filter = `blur(${blurPx}px)`;
        ctx.drawImage(stageCanvas, 0, 0, sw, sh);
        ctx.filter = "none";

        bufferRef.current = out;
      } finally {
        for (const n of hidden) n.visible(true);
        capturing.current = false;
        if (!cancelled) layer.batchDraw();
      }
    };

    const schedule = () => {
      if (capturing.current || cancelled) return;
      clearTimeout(timer);
      timer = setTimeout(rebake, 100);
    };

    const raf = requestAnimationFrame(() => {
      const layer = shapeRef.current?.getLayer();
      layer?.on(`draw.${ns}`, schedule);
      schedule();
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      shapeRef.current?.getLayer()?.off(`draw.${ns}`);
    };
  }, [blurPx, ns]);

  // After a paused stretch (resize), rebake once so the buffer matches any
  // under-content that may have changed while we skipped.
  useEffect(() => {
    if (pauseRebake || !(blurPx > 0)) return;
    const t = setTimeout(() => {
      shapeRef.current?.getLayer()?.fire("draw");
    }, 0);
    return () => clearTimeout(t);
  }, [pauseRebake, blurPx]);

  if (!(blurPx > 0)) return null;

  return (
    <Shape
      ref={shapeRef}
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx, shape) => {
        const buf = bufferRef.current;
        const group = shape.getParent();
        if (!buf || !group) return;

        ctx.save();
        roundRectPath(ctx, 0, 0, w, h, cornerRadius);
        ctx.clip();

        // Map stage-space buffer into this group's live local space so the frost
        // tracks drag/resize/rotate without rebaking.
        const inv = group.getAbsoluteTransform().copy().invert();
        const m = inv.getMatrix();
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.drawImage(buf, 0, 0);
        ctx.restore();
      }}
    />
  );
}
