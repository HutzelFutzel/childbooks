"use client";

/**
 * The page or cover being looked at, open for changes beside the book: its words, what
 * happens on it, who is there and its picture. It is the same card the editor
 * and the Story tab use, so a change made here is the same change.
 */
import { X } from "lucide-react";
import { pageNumberOf } from "../../../core/book/pageRefs";
import { COVER_BACK_ID, COVER_FRONT_ID, type Project } from "../../../core/types";
import { cn } from "../../lib/cn";
import { CoverCard } from "../../studio/CoverCard";
import { PageActions } from "../../studio/PageActions";
import { PageCard } from "../../studio/PageCard";

/** What a page or cover is called on the panel: "Page 4", "Front cover". */
function nameOf(project: Project, id: string): string {
  if (id === COVER_FRONT_ID) return "Front cover";
  if (id === COVER_BACK_ID) return "Back cover";
  return `Page ${pageNumberOf(project, id)}`;
}

export function PageSheet({
  project,
  pageId,
  pageIds,
  onPick,
  onClose,
  onOpenEditor,
  onAdded,
}: {
  project: Project;
  /** The page or cover shown. */
  pageId: string | null;
  /** The pages or covers of the spread in view: one, or two for a facing pair. */
  pageIds: readonly string[];
  onPick: (pageId: string) => void;
  onClose: () => void;
  onOpenEditor: () => void;
  onAdded: (pageId: string) => void;
}) {
  return (
    <aside
      aria-label="Edit this page"
      className="absolute inset-y-0 right-0 z-30 flex w-[min(100%,24rem)] flex-col border-l border-ink-100 bg-white shadow-lifted @3xl:static @3xl:shrink-0 @3xl:shadow-none"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-ink-100 px-4 py-2.5">
        {pageIds.length > 1 ? (
          <div role="radiogroup" aria-label="Which page" className="inline-flex rounded-lg bg-ink-900/[0.05] p-0.5">
            {pageIds.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={id === pageId}
                onClick={() => onPick(id)}
                className={cn(
                  "h-7 rounded-md px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                  id === pageId ? "bg-white text-ink-900 shadow-2xs" : "text-ink-500 hover:text-ink-800",
                )}
              >
                {nameOf(project, id)}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="text-sm font-semibold text-ink-900">
            {pageId ? nameOf(project, pageId) : "Cover"}
          </h2>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto flex size-8 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {pageId ? (
          <>
            {pageId === COVER_FRONT_ID || pageId === COVER_BACK_ID ? <CoverCard coverId={pageId} /> : <PageCard pageId={pageId} />}
            <div className="space-y-2 px-4 pb-4">
              {pageId === COVER_FRONT_ID || pageId === COVER_BACK_ID ? null : (
                <PageActions pageId={pageId} onAdded={onAdded} />
              )}
              <button
                type="button"
                onClick={onOpenEditor}
                className="text-xs font-medium text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
              >
                Arrange layout in the editor
              </button>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}
