"use client";

import { Undo2 } from "lucide-react";
import { removedPagesOf } from "../../core/book/pagePlan";
import { Popover } from "../components/Popover";
import { cn } from "../lib/cn";
import { restoreRemovedPage } from "./pageOps";
import { useStudio } from "./StudioContext";

/** The last pages taken out, with a way to put each one back where it was. Nothing shows until a page has been removed. */
export function RecentlyRemoved({
  horizontal = false,
  className,
  side = "top",
}: {
  horizontal?: boolean;
  className?: string;
  side?: "top" | "bottom";
}) {
  const { project } = useStudio();
  const removed = removedPagesOf(project);
  if (removed.length === 0) return null;
  return (
    <div className={cn("shrink-0 border-ink-100", horizontal ? "absolute right-2 top-2 z-10" : "border-t p-2", className)}>
      <Popover
        align="start"
        side={side}
        panelClassName="max-h-72 w-60 overflow-y-auto p-1.5"
        trigger={
          <span className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-ink-50 px-2 text-xs font-medium text-ink-600 transition hover:bg-ink-100">
            <Undo2 className="size-3.5" aria-hidden />
            {horizontal ? `Removed (${removed.length})` : `Recently removed (${removed.length})`}
          </span>
        }
      >
        {(close) => (
          <div className="space-y-0.5">
            <p className="px-2 pb-1 pt-0.5 text-[11px] leading-snug text-ink-400">
              The last {removed.length === 1 ? "page" : "pages"} you took out, with the pictures. Putting one back keeps its place.
            </p>
            {removed.map((entry) => {
              const words = entry.spread.text.trim() || entry.spread.illustration.trim() || "A page with no words";
              return (
                <button
                  key={entry.spread.id}
                  type="button"
                  onClick={() => {
                    restoreRemovedPage(entry.spread.id);
                    close();
                  }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-ink-700 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <span className="min-w-0 flex-1 truncate">{words}</span>
                  <span className="shrink-0 font-semibold text-brand-700">Put back</span>
                </button>
              );
            })}
          </div>
        )}
      </Popover>
    </div>
  );
}
