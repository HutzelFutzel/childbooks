"use client";

import { AlertTriangle } from "lucide-react";
import { useAppConfigStore } from "../../state/appConfigStore";
import { cn } from "../lib/cn";

/**
 * Persistent provenance shown directly on pixels produced by the Fast tier.
 * It is intentionally compact and non-blocking, while remaining discoverable
 * by hover, keyboard focus and tap.
 */
export function FastDraftBadge({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const label = useAppConfigStore((s) => s.modelConfig.imageTierLabels.quick);
  const explanation = useAppConfigStore(
    (s) => s.modelConfig.imageTierUi.quick.generatedImageNotice,
  );
  return (
    <button
      type="button"
      onClick={(event) => event.stopPropagation()}
      aria-label={`${label} image. ${explanation}`}
      className={cn(
        "group pointer-events-auto absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-full",
        "border border-amber-200 bg-amber-50/95 text-amber-800 shadow-soft backdrop-blur",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
        compact ? "size-5 justify-center p-0" : "px-2 py-1 text-[10px] font-semibold",
        className,
      )}
    >
      <AlertTriangle className={compact ? "size-3" : "size-3.5"} />
      {!compact && <span>{label}</span>}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-0 top-full mt-1.5 w-56 rounded-lg bg-ink-900 px-2.5 py-2",
          "text-left text-[11px] font-normal leading-relaxed text-white opacity-0 shadow-lifted",
          "transition group-hover:opacity-100 group-focus:opacity-100",
        )}
      >
        {explanation}
      </span>
    </button>
  );
}
