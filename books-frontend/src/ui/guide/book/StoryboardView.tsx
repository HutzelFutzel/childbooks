"use client";

/**
 * The story once drawing has started: the pages, in order, with what each one says and shows.
 *
 * Before drawing the story is one text the reader writes and revises as a whole. After, each page
 * holds its own words and its own picture, and the pages are what can change. Showing the frozen
 * story here would show words the book no longer has once a page was edited, so this shows the
 * pages as they are now. A request that would rewrite the whole story is not offered here; the line
 * at the top says what to do instead (name a page and what should change).
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Image as ImageIcon, ImageOff, MessageCircle, Plus, Sparkles, Wand2 } from "lucide-react";
import { hasNoPicture, bookWords } from "../../../core/book/pagePlan";
import { pageNumberOf } from "../../../core/book/pageRefs";
import { unitIsDone, unitNeedsArtwork } from "../../../core/book/pageCompletion";
import { illustrationUnits } from "../../../core/book/units";
import { COVER_BACK_ID, COVER_FRONT_ID, type Project, type ScreenplaySpread } from "../../../core/types";
import { wordCount } from "../../../core/story/brief";
import { illustrationStaleness } from "../../../state/ai";
import { getCursor } from "../../../core/versioning";
import { useChatStudio } from "../../../state/chatStudio";
import { useJobsStore } from "../../../state/jobsStore";
import { Button } from "../../components/Button";
import { SparkEstimateCost, useImageActionRange } from "../../layout/SparkCost";
import { cn } from "../../lib/cn";
import { PageActions } from "../../studio/PageActions";
import { PageCard } from "../../studio/PageCard";
import { addPicturePage } from "../../studio/pagePlanOps";
import { RecentlyRemoved } from "../../studio/RecentlyRemoved";

type PageStatus = "drawn" | "needsDrawing" | "outOfDate" | "noPicture";

function statusOf(project: Project, page: ScreenplaySpread): PageStatus {
  if (hasNoPicture(page) || !unitNeedsArtwork(page)) return "noPicture";
  if (!unitIsDone(project, page)) return "needsDrawing";
  return illustrationStaleness(project, page.id) ? "outOfDate" : "drawn";
}

const STATUS_LABEL: Record<PageStatus, string> = {
  drawn: "Drawn",
  needsDrawing: "Needs drawing",
  outOfDate: "Picture is out of date",
  noPicture: "No picture",
};

const STATUS_TONE: Record<PageStatus, string> = {
  drawn: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  needsDrawing: "bg-amber-50 text-amber-800 ring-amber-200",
  outOfDate: "bg-amber-50 text-amber-800 ring-amber-200",
  noPicture: "bg-ink-50 text-ink-500 ring-ink-200",
};

export function StoryboardView({ project, drawOffered }: { project: Project; /** The conversation already shows the button that draws the unfinished pages. */ drawOffered: boolean }) {
  const pages = illustrationUnits(project).filter((unit) => unit.id !== COVER_FRONT_ID && unit.id !== COVER_BACK_ID);
  const rows = pages.map((page) => ({ page, status: statusOf(project, page) }));
  const needDrawing = rows.filter((row) => row.status === "needsDrawing").map((row) => row.page.id);
  const words = wordCount(bookWords(project));
  const [openId, setOpenId] = useState<string | null>(null);
  const openRow = useRef<HTMLLIElement | null>(null);
  // A page that was taken out closes its card; a page that was just added opens its own.
  const openStillThere = openId !== null && pages.some((page) => page.id === openId);
  const shownId = openStillThere ? openId : null;
  useEffect(() => {
    openRow.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [shownId]);
  const docLength = project.screenplay ? getCursor(project.screenplay).content.spreads.length : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-ink-100 bg-ink-50/50 px-4 py-2.5 sm:px-5">
        <button
          type="button"
          onClick={() => void useChatStudio.getState().focusComposer()}
          className="group flex w-full items-center gap-2.5 border-l-2 border-magic-200/80 py-0.5 pl-3 text-left text-[13px] leading-snug text-ink-600 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
        >
          <Sparkles className="size-3.5 shrink-0 text-magic-600" aria-hidden />
          <span className="min-w-0 flex-1">
            Each page holds its own words now. Open a page to change its words, what happens on it or its picture, or
            tell the assistant which page and what should change.
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-ink-800 ring-1 ring-ink-200 group-hover:bg-white">
            <MessageCircle className="size-3.5" aria-hidden />
            Ask
          </span>
        </button>
      </div>

      {needDrawing.length > 0 ? <NeedsDrawingBar pageIds={needDrawing} drawOffered={drawOffered} /> : null}

      <ol className="min-h-0 flex-1 divide-y divide-ink-100 overflow-y-auto">
        {rows.map(({ page, status }) => {
          const number = pageNumberOf(project, page.id);
          const open = shownId === page.id;
          return (
            <li key={page.id} ref={open ? openRow : undefined} className={open ? "bg-white" : undefined}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : page.id)}
                aria-expanded={open}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-ink-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-400 sm:px-5"
              >
                <span className="mt-0.5 w-12 shrink-0 text-xs font-semibold text-ink-400">Page {number}</span>
                <span className="min-w-0 flex-1 space-y-1">
                  {page.text.trim() ? (
                    <span className={cn("block whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-ink-800", !open && "line-clamp-3")}>
                      {page.text.trim()}
                    </span>
                  ) : (
                    <span className="block text-sm italic text-ink-400">No words on this page</span>
                  )}
                  {!open && page.illustration.trim() && status !== "noPicture" ? (
                    <span className="block text-xs leading-snug text-ink-500 line-clamp-2">{page.illustration.trim()}</span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                    STATUS_TONE[status],
                  )}
                >
                  {status === "noPicture" ? <ImageOff className="size-3" aria-hidden /> : <ImageIcon className="size-3" aria-hidden />}
                  {STATUS_LABEL[status]}
                </span>
                <ChevronDown
                  className={cn("mt-1 size-4 shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
                  aria-hidden
                />
              </button>
              {open ? (
                <div className="space-y-1 border-t border-ink-100 bg-ink-50/40 pb-3 sm:pl-14">
                  <PageCard pageId={page.id} />
                  <div className="px-4">
                    <PageActions pageId={page.id} onAdded={setOpenId} />
                    <button
                      type="button"
                      onClick={() => useChatStudio.getState().jumpToPage(page.id)}
                      className="mt-2 text-xs font-medium text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
                    >
                      Show it in the book
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
        <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => {
              const id = addPicturePage(docLength);
              if (id) setOpenId(id);
            }}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-ink-50 px-3 text-xs font-medium text-ink-700 transition hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
          >
            <Plus className="size-3.5" aria-hidden />
            Add a page at the end
          </button>
          <RecentlyRemoved className="border-0 p-0" side="top" />
        </li>
      </ol>
      <p className="shrink-0 border-t border-ink-100 px-4 py-2 text-[11px] text-ink-400 sm:px-5">
        {pages.length} {pages.length === 1 ? "page" : "pages"} · {words.toLocaleString()} {words === 1 ? "word" : "words"}
      </p>
    </div>
  );
}

/**
 * Pages with no picture yet, drawn together at the price shown. When the conversation already offers the
 * button for the unfinished pages (with its own quote), this only says how many are waiting and where it is,
 * so there is never a second button with a different price for the same pages.
 */
function NeedsDrawingBar({ pageIds, drawOffered }: { pageIds: string[]; drawOffered: boolean }) {
  const each = useImageActionRange("pageIllustration", "fresh", undefined, true);
  const drawing = useJobsStore((s) => s.activeUnitIds.size > 0);
  const total = each
    ? { minSparks: each.minSparks * pageIds.length, maxSparks: each.maxSparks * pageIds.length }
    : null;
  const range = each && total ? { ...each, ...total } : null;
  const count = `${pageIds.length} ${pageIds.length === 1 ? "page needs" : "pages need"} drawing`;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-ink-50 px-4 py-2.5 sm:px-5">
      <p className="text-sm font-medium text-ink-900">
        {count}
        {drawOffered ? <span className="font-normal text-ink-500"> · the button to draw them is in the conversation</span> : null}
        {!drawOffered && drawing ? <span className="font-normal text-ink-500"> · drawing now</span> : null}
      </p>
      {drawOffered || drawing ? null : (
        <Button
          size="sm"
          leftIcon={<Wand2 className="size-4" aria-hidden />}
          onClick={() => void useChatStudio.getState().drawPages(pageIds, Math.ceil(range?.maxSparks ?? 0))}
        >
          {pageIds.length === 1 ? "Draw it" : "Draw them"}
          <SparkEstimateCost range={range} action="pageIllustration" />
        </Button>
      )}
    </div>
  );
}
