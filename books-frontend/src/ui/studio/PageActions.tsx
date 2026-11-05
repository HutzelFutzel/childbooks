"use client";

/**
 * What can be done with a page as a whole, wherever its card is shown: add a
 * page after it, or take it out. A removed page is kept, so there is no
 * confirmation; the toast and "Recently removed" put it back.
 */
import { Plus, Trash2 } from "lucide-react";
import { getCursor } from "../../core/versioning";
import { addPicturePage } from "./pagePlanOps";
import { removeSpread } from "./pageOps";
import { useStudio } from "./StudioContext";

export function PageActions({ pageId, onAdded }: { pageId: string; onAdded?: (id: string) => void }) {
  const { project } = useStudio();
  const spreads = project.screenplay ? getCursor(project.screenplay).content.spreads : [];
  const at = spreads.findIndex((spread) => spread.id === pageId);
  if (at < 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
      <button
        type="button"
        onClick={() => {
          const id = addPicturePage(at + 1);
          if (id) onAdded?.(id);
        }}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-ink-50 px-3 text-xs font-medium text-ink-700 transition hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
      >
        <Plus className="size-3.5" aria-hidden />
        Add a page after this
      </button>
      <button
        type="button"
        onClick={() => removeSpread(pageId)}
        disabled={spreads.length <= 1}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-ink-500 transition hover:bg-ink-50 hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:pointer-events-none disabled:opacity-40"
      >
        <Trash2 className="size-3.5" aria-hidden />
        Remove this page
      </button>
    </div>
  );
}
