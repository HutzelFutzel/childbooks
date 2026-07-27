/**
 * The one place a book is rasterized.
 *
 * Loads every illustration, mounts an offscreen stage at print resolution,
 * snapshots each capture target, and hands back rasters. The digital edition,
 * the print interior and the wraparound cover all run through it, so they
 * cannot disagree about how a page is drawn.
 *
 * Order matters here and used to be wrong: artwork is fully resolved BEFORE
 * the stage mounts. A stage that mounts first and fetches after is a stage
 * whose pages are briefly empty, and a capture loop cannot tell "empty for
 * now" from "empty".
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RasterPage } from "../../core/print/assemble";
import type { BookDesign } from "../../core/types";
import {
  blobToJpegBytes,
  capturePageElement,
  computeFontEmbedCss,
  rasterLooksBlank,
  waitForStageReady,
} from "./bookExport";
import { loadArtwork, spineColorsFrom, type LoadedArtwork } from "./artwork";
import { PrintBook, PrintSpine } from "./PrintBook";
import { artworkBlobIds, expectedImageCount, SPINE_CAPTURE_ID, type PlannedTarget } from "./printTargets";

/** A spine band to render alongside the pages (wraparound cover pass only). */
export interface SpineRequest {
  widthPx: number;
  heightPx: number;
  widthIn: number;
  heightIn: number;
  text: string;
  fontFamily: string;
  /** Cover artwork to take the band's colours from. */
  colorFromBlobId?: string;
}

export function RenderStage({
  targets,
  design,
  spine,
  onProgress,
  onDone,
  onError,
}: {
  targets: PlannedTarget[];
  design: BookDesign;
  spine?: SpineRequest;
  onProgress: (status: string) => void;
  onDone: (rasters: RasterPage[]) => void;
  onError: (err: unknown) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const capturedRef = useRef(false);
  // Held in a ref as well as state so the unmount cleanup can revoke the object
  // URLs whichever order React ran the effects in — under StrictMode the first
  // mount's cleanup fires long before the load it started has resolved.
  const artworkRef = useRef<LoadedArtwork | null>(null);
  const [loaded, setLoaded] = useState<LoadedArtwork | null>(null);
  const [spineColors, setSpineColors] = useState({ background: "#e8e2d6", text: "#1f2933" });

  // Phase 1 — resolve artwork. Nothing is mounted until this finishes.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    void (async () => {
      try {
        const ids = artworkBlobIds(targets, design);
        onProgress(ids.length > 0 ? `Loading artwork… 0 of ${ids.length}` : "Preparing pages…");
        const result = await loadArtwork(ids, (done, total) => {
          onProgress(`Loading artwork… ${done} of ${total}`);
        });
        artworkRef.current = result;
        if (spine?.colorFromBlobId) {
          setSpineColors(await spineColorsFrom(result.artwork[spine.colorFromBlobId]));
        }
        setLoaded(result);
      } catch (err) {
        onError(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revoke the object URLs on the way out. The bytes stay in the blob cache, so
  // a retry costs no downloads.
  useEffect(
    () => () => {
      artworkRef.current?.dispose();
      artworkRef.current = null;
    },
    [],
  );

  // Phase 2 — capture, once the stage is mounted with resolved artwork.
  useEffect(() => {
    if (!loaded || capturedRef.current) return;
    capturedRef.current = true;

    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const stage = stageRef.current;
      if (!stage) {
        onError(new Error("Could not prepare the render stage."));
        return;
      }
      try {
        const expected = expectedImageCount(targets, design, loaded.artwork);
        onProgress("Loading fonts…");
        await waitForStageReady(stage, { expectedImages: expected });
        onProgress("Embedding fonts…");
        const fontEmbedCSS = await computeFontEmbedCss(stage);

        const rasters: RasterPage[] = [];
        const all: { id: string; label: string; widthIn: number; heightIn: number; mustHaveInk: boolean }[] = [
          ...targets.map((t) => ({
            id: t.id,
            label: t.label,
            widthIn: t.widthIn,
            heightIn: t.heightIn,
            // A page whose design points at an illustration must not come out
            // blank. A genuinely text-only page legitimately can.
            mustHaveInk: Boolean(t.page.blobId && loaded.artwork[t.page.blobId]),
          })),
          ...(spine
            ? [{ id: SPINE_CAPTURE_ID, label: "Spine", widthIn: spine.widthIn, heightIn: spine.heightIn, mustHaveInk: false }]
            : []),
        ];

        for (let i = 0; i < all.length; i++) {
          const item = all[i];
          onProgress(`Rendering ${i + 1} of ${all.length}…`);
          const el = stage.querySelector<HTMLElement>(`[data-export-page="${cssEscape(item.id)}"]`);
          if (!el) throw new Error(`The book's ${item.label} could not be prepared for printing.`);
          const blob = await capturePageElement(el, { fontEmbedCSS });
          if (item.mustHaveInk && (await rasterLooksBlank(blob))) {
            throw new Error(
              `${item.label} came out blank. Its illustration didn't render — please try again.`,
            );
          }
          rasters.push({
            id: item.id,
            label: item.label,
            bytes: await blobToJpegBytes(blob),
            mimeType: "image/jpeg",
            widthIn: item.widthIn,
            heightIn: item.heightIn,
          });
        }

        onDone(rasters);
      } catch (err) {
        onError(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (!loaded) return null;

  return createPortal(
    <div ref={stageRef} className="export-root" aria-hidden>
      <PrintBook targets={targets} design={design} artwork={loaded.artwork} forExport />
      {spine && (
        <PrintSpine
          id={SPINE_CAPTURE_ID}
          widthPx={spine.widthPx}
          heightPx={spine.heightPx}
          text={spine.text}
          fontFamily={spine.fontFamily}
          background={spineColors.background}
          color={spineColors.text}
        />
      )}
    </div>,
    document.body,
  );
}

/** Minimal CSS.escape fallback for attribute selectors. */
export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\\]]/g, "\\$&");
}
