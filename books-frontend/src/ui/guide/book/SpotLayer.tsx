"use client";

/**
 * Marking a spot on a picture: the reader drags a box over the part to change
 * ("the umbrella goes here"), and the next typed change to that picture is held
 * to it. This is the layer drawn over one picture; it owns only the drag. What
 * was marked lives in the chat store, where the redraw reads it.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { NormRect } from "../../../core/design";
import { useChatStudio } from "../../../state/chatStudio";
import { useGuideT } from "../intl";

/** Smaller than this (of the picture's width or height) is a slip of the hand, not a spot. */
const MIN_SIDE = 0.03;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): NormRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

const boxStyle = (rect: NormRect): React.CSSProperties => ({
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.w * 100}%`,
  height: `${rect.h * 100}%`,
});

export function SpotLayer({
  unitId,
  marking,
  onDone,
}: {
  unitId: string;
  marking: boolean;
  onDone: () => void;
}) {
  const t = useGuideT("chrome");
  const region = useChatStudio((s) => s.pictureRegion);
  const setRegion = useChatStudio((s) => s.setPictureRegion);
  const focusComposer = useChatStudio((s) => s.focusComposer);
  const layer = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<NormRect | null>(null);
  const marked = region?.unitId === unitId ? region.rect : null;

  useEffect(() => {
    if (!marking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      start.current = null;
      setDrag(null);
      onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marking, onDone]);

  const point = (event: React.PointerEvent): { x: number; y: number } => {
    const box = layer.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return { x: clamp01((event.clientX - box.left) / box.width), y: clamp01((event.clientY - box.top) / box.height) };
  };

  return (
    <>
      {marked && !marking && (
        <div className="pointer-events-none absolute z-10 rounded-sm border-2 border-dashed border-magic-500 bg-magic-500/15" style={boxStyle(marked)}>
          <span
            role="button"
            tabIndex={-1}
            aria-label={t("clearSpot")}
            title={t("clearSpot")}
            onClick={(event) => {
              event.stopPropagation();
              setRegion(null);
            }}
            className="pointer-events-auto absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-white text-ink-700 shadow-soft hover:text-ink-900"
          >
            <X className="size-3" />
          </span>
          <span className="absolute bottom-0.5 left-0.5 max-w-[calc(100%-4px)] truncate rounded bg-white/90 px-1 py-0.5 text-[10px] leading-none text-ink-700 shadow-soft">
            {t("spotMarked")}
          </span>
        </div>
      )}
      {marking && (
        <div
          ref={layer}
          role="presentation"
          className="absolute inset-0 z-20 cursor-crosshair touch-none bg-ink-900/10"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            event.stopPropagation();
            try {
              // Keeps the drag going when the pointer leaves the page; not every input can be captured.
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* the drag still works while the pointer stays on the page */
            }
            start.current = point(event);
            setDrag(null);
          }}
          onPointerMove={(event) => {
            if (start.current) setDrag(rectBetween(start.current, point(event)));
          }}
          onPointerUp={(event) => {
            const from = start.current;
            start.current = null;
            if (!from) return;
            const rect = rectBetween(from, point(event));
            setDrag(null);
            if (rect.w >= MIN_SIDE && rect.h >= MIN_SIDE) {
              setRegion({ unitId, rect });
              onDone();
              void focusComposer();
            }
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(null);
          }}
        >
          <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded-md bg-white/95 px-2 py-1 text-center text-[11px] leading-tight font-medium text-ink-800 shadow-soft">
            {t("markSpotHint")}
          </span>
          {drag && (
            <div className="pointer-events-none absolute rounded-sm border-2 border-dashed border-magic-500 bg-magic-500/20" style={boxStyle(drag)} />
          )}
        </div>
      )}
    </>
  );
}
