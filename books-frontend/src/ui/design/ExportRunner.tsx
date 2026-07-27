import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { EXPORT_DPI } from "../../core/config/options";
import { buildEbookPdf, type RasterPage } from "../../core/print/assemble";
import type { BookDesign, Project } from "../../core/types";
import type { DesignPage } from "./designInit";
import { RenderStage } from "./RenderStage";
import { buildEbookTargets } from "./printTargets";
import { buildImagesZip, saveBlob } from "./bookExport";

export type ExportMode = "pdf" | "images";

type Phase = "working" | "done" | "error";

/**
 * Renders the whole book offscreen at print resolution and exports it as a PDF
 * or a zip of page images.
 *
 * The stage is offscreen and the progress UI is a small, non-blocking corner
 * card — the rest of the app stays interactive during export.
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
  const [status, setStatus] = useState("Preparing pages…");
  const [phase, setPhase] = useState<Phase>("working");

  // The author's own copy of the book, so it matches the digital edition: whole
  // spreads, covers included, trim-sized.
  const targets = buildEbookTargets(project, pages, EXPORT_DPI);

  const finish = useCallback(
    async (rasters: RasterPage[]) => {
      try {
        const base = fileBase(project.title);
        if (mode === "pdf") {
          setStatus("Assembling PDF…");
          const bytes = await buildEbookPdf(rasters);
          setStatus("Saving…");
          await saveBlob(`${base}.pdf`, new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
        } else {
          setStatus("Compressing images…");
          const blob = await buildImagesZip(
            rasters.map((r) => ({
              label: r.label,
              blob: new Blob([r.bytes as unknown as BlobPart], { type: r.mimeType }),
            })),
            "jpg",
          );
          setStatus("Saving…");
          await saveBlob(`${base}-images.zip`, blob);
        }
        setStatus("Export complete.");
        setPhase("done");
        toast.success(mode === "pdf" ? "PDF exported" : "Images exported");
        setTimeout(onDone, 2500);
      } catch (err) {
        fail(err);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, project.title],
  );

  function fail(err: unknown) {
    console.error("Export failed:", err);
    const message = err instanceof Error ? err.message : "Export failed";
    setStatus(message);
    setPhase("error");
    toast.error(message);
    setTimeout(onDone, 5000);
  }

  return (
    <>
      {phase === "working" && (
        <RenderStage
          targets={targets}
          design={design}
          onProgress={setStatus}
          onDone={(rasters) => void finish(rasters)}
          onError={fail}
        />
      )}
      {createPortal(
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
        </div>,
        document.body,
      )}
    </>
  );
}

/** A filesystem-friendly base name derived from the book title. */
function fileBase(title: string): string {
  const cleaned = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "childbook";
}
