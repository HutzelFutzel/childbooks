/**
 * Progress strip for a running art-style transfer. Sits above the Design stage
 * so the reader can keep working while cast sheets and pages are re-rendered —
 * each item shows its own spinner in the filmstrips; this only summarizes.
 */
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "../components/Button";
import { useStyleRenew } from "./useStyleRenew";

export function StyleRenewBanner() {
  const status = useStyleRenew();
  if (!status) return null;

  const { castDone, castTotal, pagesDone, pagesTotal, stalled, stuckCount } = status;
  const parts = [
    castTotal > 0 && `cast ${castDone}/${castTotal}`,
    pagesTotal > 0 && `pages ${pagesDone}/${pagesTotal}`,
  ].filter(Boolean) as string[];

  if (stalled) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950 sm:px-5">
        <AlertTriangle className="size-4 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">
            {stuckCount} item{stuckCount === 1 ? "" : "s"} still to update
          </span>{" "}
          <span className="opacity-90">— {parts.join(" · ")} in {status.styleLabel}.</span>
        </p>
        <Button size="sm" variant="secondary" onClick={status.retry}>
          Retry
        </Button>
        <button
          type="button"
          onClick={status.dismiss}
          title="Stop updating"
          className="rounded-lg p-1 text-amber-700 hover:bg-amber-100"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-brand-100 bg-brand-50/70 px-3 py-2 text-xs text-brand-900 sm:px-5">
      <Loader2 className="size-4 shrink-0 animate-spin text-brand-500" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Applying {status.styleLabel}</span>{" "}
        <span className="opacity-80">
          — {status.phase === "cast" ? "creating new cast looks" : "creating new page versions"} (
          {parts.join(" · ")}). You can keep working.
        </span>
      </p>
    </div>
  );
}
