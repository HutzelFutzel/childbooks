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
  canvasLooksBlank,
  canvasToJpegBytes,
  capturePageCanvas,
  computeFontEmbedCss,
  releaseCanvas,
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
        const all: CaptureItem[] = [
          ...targets.map((t) => ({
            id: t.id,
            label: t.label,
            widthIn: t.widthIn,
            heightIn: t.heightIn,
            // A page whose design points at an illustration must not come out
            // blank. A genuinely text-only page legitimately can — and so can
            // one whose illustration was made editable (`makeIllustrationEditable`)
            // and then hidden from the Layers panel: that swaps the full-bleed
            // background for a placed element `PrintPage` skips drawing
            // entirely, and a hidden layer is a design choice, not a failed
            // render. Only a page still expecting the FULL-BLEED illustration —
            // or a still-visible placed one — has to prove it actually painted.
            mustHaveInk: hasExpectedInk(
              design,
              t.page.id,
              Boolean(t.page.blobId && loaded.artwork[t.page.blobId]),
            ),
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
          rasters.push(await captureRaster(el, item, fontEmbedCSS));
          // Hand the browser a turn between pages. Each one allocates a
          // page-sized canvas; captured back to back with no yield, a long book
          // gives it no chance to reclaim them.
          await new Promise((r) => setTimeout(r, 0));
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

/**
 * Whether a page's design still expects its generated illustration to show up
 * as ink, mirroring the same call `PrintPage` makes when it decides what to
 * draw.
 *
 * A page with a source blob doesn't always draw it as the full-bleed
 * background: once the user turns it into a movable/resizable element via
 * "Adjust art", `PrintPage` draws that placed element INSTEAD, and — same as
 * any other layer — the user can hide it from the Layers panel. A hidden
 * illustration element is a page that's SUPPOSED to be blank of it, not a
 * render that silently failed, so it must not trip the same alarm as a
 * genuine artwork-didn't-load bug.
 */
function hasExpectedInk(design: BookDesign, pageId: string, hasArt: boolean): boolean {
  if (!hasArt) return false;
  const illustrationEls = (design.pages[pageId]?.images ?? []).filter(
    (im) => im.kind === "illustration",
  );
  // No placed element ⇒ it's still the full-bleed background `PrintPage` draws
  // whenever a page has art and hasn't been made editable.
  if (illustrationEls.length === 0) return true;
  return illustrationEls.some((im) => !im.hidden);
}

/** What one capture target needs from the loop above. */
interface CaptureItem {
  id: string;
  label: string;
  widthIn: number;
  heightIn: number;
  mustHaveInk: boolean;
}

/**
 * How many times to ask for a page before believing it's really empty.
 *
 * A page that must have ink and comes back white isn't a design that lost its
 * artwork — the artwork is loaded and decoded by the time we get here, and the
 * on-screen editor draws it from the same DOM. It's the rasterizer declining
 * to paint, which it does under memory pressure and recovers from once given
 * room. Failing the whole export on the first white page threw away an entire
 * book's worth of work over a page that renders on the next attempt.
 */
const CAPTURE_ATTEMPTS = 3;

/** Snapshot one page, retrying while it comes back empty. */
async function captureRaster(
  el: HTMLElement,
  item: CaptureItem,
  fontEmbedCSS: string,
): Promise<RasterPage> {
  for (let attempt = 1; ; attempt++) {
    const canvas = await capturePageCanvas(el, { fontEmbedCSS });
    try {
      if (!item.mustHaveInk || !canvasLooksBlank(canvas)) {
        return {
          id: item.id,
          label: item.label,
          bytes: await canvasToJpegBytes(canvas),
          mimeType: "image/jpeg",
          widthIn: item.widthIn,
          heightIn: item.heightIn,
        };
      }
    } finally {
      releaseCanvas(canvas);
    }
    if (attempt >= CAPTURE_ATTEMPTS) {
      throw new Error(
        `${item.label} came out blank. Its illustration didn't render — please try again.`,
      );
    }
    // Wait out whatever stopped it painting: a macrotask for the collector to
    // run in, then a settled frame, each attempt more patient than the last.
    await new Promise((r) => setTimeout(r, 250 * attempt));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
  }
}

/** Minimal CSS.escape fallback for attribute selectors. */
export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\\]]/g, "\\$&");
}
