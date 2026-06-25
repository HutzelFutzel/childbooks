import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { EXPORT_DPI } from "../../core/config/options";
import { pageTrimForConfig } from "../../core/book";
import type { BookDesign, Project } from "../../core/types";
import type { DesignPage } from "./designInit";
import { PrintBook } from "./PrintBook";
import {
  buildImagesZip,
  buildPdf,
  capturePageElement,
  computeFontEmbedCss,
  saveBlob,
  waitForStageReady,
  type CapturedPage,
} from "./bookExport";

export type ExportMode = "pdf" | "images";

type Phase = "working" | "done" | "error";

/**
 * Renders the whole book offscreen at print resolution, rasterizes each page,
 * and exports a full-bleed PDF or a zip of page images.
 *
 * The render stage is offscreen and the progress UI is a small, non-blocking
 * corner card — the rest of the app stays interactive during export. The export
 * runs exactly once (guarded by a ref) and tolerates React StrictMode's
 * mount/cleanup/mount cycle without aborting itself.
 */
export function ExportRunner({
  mode,
  pages,
  design,
  project,
  onDone,
}: {
  mode: ExportMode;
  pages: DesignPage[];
  design: BookDesign;
  project: Project;
  onDone: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const [status, setStatus] = useState("Preparing pages…");
  const [phase, setPhase] = useState<Phase>("working");

  const trim = pageTrimForConfig(project.config);
  const pageHeightPx = Math.round(trim.heightIn * EXPORT_DPI);

  useEffect(() => {
    // Run exactly once. StrictMode re-invokes the effect after a synthetic
    // cleanup; the guard keeps a single in-flight export and prevents the run
    // from being cancelled by that synthetic unmount.
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      // Wait a frame so the offscreen stage is mounted and laid out.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const stage = stageRef.current;
      if (!stage) {
        setStatus("Could not prepare the export stage.");
        setPhase("error");
        return;
      }
      try {
        setStatus("Loading fonts & artwork…");
        await waitForStageReady(stage);

        setStatus("Embedding fonts…");
        const fontEmbedCSS = await computeFontEmbedCss(stage);

        const captured: CapturedPage[] = [];
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          setStatus(`Rendering page ${i + 1} of ${pages.length}…`);
          const el = stage.querySelector<HTMLElement>(`[data-export-page="${cssEscape(page.id)}"]`);
          if (!el) continue;
          const blob = await capturePageElement(el, { fontEmbedCSS });
          captured.push({
            id: page.id,
            label: page.label,
            blob,
            widthPx: el.offsetWidth,
            heightPx: el.offsetHeight,
            heightIn: trim.heightIn,
            widthIn: trim.heightIn * page.aspect,
          });
        }

        if (captured.length === 0) throw new Error("No pages were available to export.");

        const base = fileBase(project.title);
        let saved: boolean;
        if (mode === "pdf") {
          setStatus("Assembling PDF…");
          const blob = await buildPdf(captured);
          setStatus("Saving…");
          saved = await saveBlob(`${base}.pdf`, blob);
        } else {
          setStatus("Compressing images…");
          const blob = await buildImagesZip(captured);
          setStatus("Saving…");
          saved = await saveBlob(`${base}-images.zip`, blob);
        }

        setStatus(saved ? "Export complete." : "Export cancelled.");
        setPhase("done");
        if (saved) toast.success(mode === "pdf" ? "PDF exported" : "Images exported");
        // Auto-dismiss the success card shortly after.
        setTimeout(onDone, saved ? 2500 : 0);
      } catch (err) {
        console.error("Export failed:", err);
        const message = err instanceof Error ? err.message : "Export failed";
        setStatus(message);
        setPhase("error");
        toast.error(message);
        setTimeout(onDone, 5000);
      }
    }

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <>
      {/* Offscreen, full-resolution render stage (does not block the UI). */}
      <div ref={stageRef} aria-hidden>
        <PrintBook pages={pages} design={design} pageHeightPx={pageHeightPx} forExport />
      </div>

      {/* Non-blocking progress card, bottom-right. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-100">
        <div className="pointer-events-auto flex w-72 items-start gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-3 shadow-xl">
          <span className="mt-0.5 shrink-0">
            {phase === "working" && <Loader2 className="size-5 animate-spin text-brand-500" />}
            {phase === "done" && <CheckCircle2 className="size-5 text-emerald-500" />}
            {phase === "error" && <XCircle className="size-5 text-red-500" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-800">
              {mode === "pdf" ? "Exporting PDF" : "Exporting images"}
            </p>
            <p className="truncate text-xs text-ink-500" title={status}>
              {status}
            </p>
            {phase === "working" && (
              <p className="mt-0.5 text-[11px] text-ink-400">{EXPORT_DPI} DPI · keep working as usual</p>
            )}
          </div>
          {phase !== "working" && (
            <button
              onClick={onDone}
              className="ml-auto rounded-md px-1.5 text-xs text-ink-400 transition hover:text-ink-700"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** A filesystem-friendly base name derived from the book title. */
function fileBase(title: string): string {
  const cleaned = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "childbook";
}

/** Minimal CSS.escape fallback for attribute selectors. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\\]]/g, "\\$&");
}
