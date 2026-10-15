"use client";

/**
 * "Something is being drawn", wherever the reader is. While a picture draws the
 * book cannot be printed, so this is on every tab, in Preview and in Edit, and
 * above the message field. A tap brings what is drawing into view.
 */
import { Loader2 } from "lucide-react";
import { useGuideList, useGuideT } from "../intl";
import type { BookBusy, BusyItem } from "../../../core/guide/bookBusy";
import type { Project } from "../../../core/types";
import { useBookBusy } from "../../../state/useBookBusy";
import { useChatStudio } from "../../../state/chatStudio";
import { cn } from "../../lib/cn";

type Translate = ReturnType<typeof useGuideT>;

/** What is drawing, as a short phrase: "Drawing page 3…", "Drawing 3 pictures…". */
export function useBusyPhrase(): (busy: BookBusy) => string {
  const t = useGuideT("chrome");
  const list = useGuideList();
  return (busy) => busyPhrase(busy, t, list);
}

export function busyPhrase(busy: BookBusy, t: Translate, list: (names: readonly string[]) => string): string {
  const { items } = busy;
  if (items.length === 0) return "";
  if (items.length === 1) {
    const only = items[0]!;
    if (only.kind === "page") return t("busyPage", { n: only.page ?? 0 });
    if (only.kind === "cover") return t("busyCover");
    if (only.kind === "plan") return t("busyPlan");
    return t("busyPerson", { name: only.name ?? "" });
  }
  const pages = items.filter((item) => item.kind === "page");
  if (pages.length === items.length && pages.length <= 4) {
    return t("busyPages", { list: list(pages.map((item) => String(item.page))) });
  }
  return t("busyMany", { count: items.length });
}

/** Where a tap on the indicator goes: the first page or cover that is drawing, else the people. */
export function showBusy(items: readonly BusyItem[]): void {
  const store = useChatStudio.getState();
  const drawn = items.filter((item) => item.kind === "page" || item.kind === "cover");
  // One already in front of the reader is where "show me" lands; else the first.
  const first = drawn.find((item) => store.looking.includes(item.id)) ?? drawn[0];
  if (first) store.jumpToPage(first.id);
  else if (items.some((item) => item.kind === "person" || item.kind === "thing")) store.setView("cast");
}

export function BusyPill({ project, className }: { project: Project; className?: string }) {
  const busy = useBookBusy(project);
  const phrase = useBusyPhrase();
  const t = useGuideT("chrome");
  if (!busy.busy) return null;
  return (
    <button
      type="button"
      onClick={() => showBusy(busy.items)}
      title={t("busyHold")}
      aria-live="polite"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-magic-100/70 px-2.5 text-xs font-semibold text-magic-700 ring-1 ring-inset ring-magic-300/70 transition hover:bg-magic-100",
        className,
      )}
    >
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      <span className="truncate">{phrase(busy)}</span>
    </button>
  );
}

/** The same fact above the message field: where the reader is typing, and what it means for printing. */
export function BusyLine({ project }: { project: Project }) {
  const busy = useBookBusy(project);
  const phrase = useBusyPhrase();
  const t = useGuideT("chrome");
  if (!busy.busy || !project.authoringState?.lockedAt) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-2 pb-1.5 text-xs text-ink-600"
    >
      <Loader2 className="size-3.5 shrink-0 animate-spin text-magic-600 motion-reduce:animate-none" aria-hidden />
      <span className="min-w-0 flex-1">{t("busyChatLine", { what: phrase(busy) })}</span>
      <button
        type="button"
        onClick={() => showBusy(busy.items)}
        className="shrink-0 font-medium text-ink-700 underline-offset-2 hover:text-ink-900 hover:underline"
      >
        {t("busyShow")}
      </button>
    </div>
  );
}
