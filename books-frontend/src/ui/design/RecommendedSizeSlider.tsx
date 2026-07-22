import { AlertTriangle } from "lucide-react";
import type { FontSizeRec } from "../../core/config/typography";
import { cn } from "../lib/cn";

/**
 * Font-size slider (in real points) that highlights the age- and format-aware
 * recommended range, marks the ideal size with a tick, and warns when the chosen
 * size drops below the readability floor. The recommendation only *guides* — the
 * user can pick any size; the text box itself is sized independently.
 */
export function RecommendedSizeSlider({
  sizePt,
  rec,
  onChange,
}: {
  sizePt: number;
  rec: FontSizeRec | null;
  onChange: (pt: number) => void;
}) {
  const min = 6;
  // Give a little headroom above the recommended max so users can exceed it.
  const max = Math.max(120, Math.ceil(((rec?.maxPt ?? 0) * 1.4) / 10) * 10);
  const pct = (v: number) => (Math.max(min, Math.min(max, v)) - min) / (max - min) * 100;

  const belowFloor = rec != null && sizePt < rec.floorPt;
  const inRange = rec != null && sizePt >= rec.minPt && sizePt <= rec.maxPt;

  return (
    <div>
      <div className="relative h-5">
        {/* Recommended band highlight */}
        {rec && (
          <div
            className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-200"
            style={{ left: `${pct(rec.minPt)}%`, width: `${pct(rec.maxPt) - pct(rec.minPt)}%` }}
          />
        )}
        {/* Ideal tick */}
        {rec && (
          <div
            className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500"
            style={{ left: `${pct(rec.idealPt)}%` }}
            title={`Recommended: ${rec.idealPt}pt`}
          />
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={sizePt}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full bg-transparent"
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span
          className={cn(
            "tabular-nums",
            belowFloor ? "font-semibold text-amber-600" : inRange ? "text-brand-600" : "text-ink-500",
          )}
        >
          {sizePt}pt
        </span>
        {rec && (
          <button
            type="button"
            onClick={() => onChange(rec.idealPt)}
            className="text-ink-400 underline decoration-dotted underline-offset-2 hover:text-brand-600"
            title="Use the recommended size"
          >
            Recommended {rec.minPt}–{rec.maxPt}pt
          </button>
        )}
      </div>
      {belowFloor && (
        <p className="mt-1 flex items-center gap-1 text-[11px] leading-snug text-amber-600">
          <AlertTriangle className="size-3 shrink-0" />
          Below {rec!.floorPt}pt may be hard to read for this age.
        </p>
      )}
    </div>
  );
}
