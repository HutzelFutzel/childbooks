"use client";

/**
 * The pages, one spread at a time, as they will print. Arrows or the keyboard
 * turn the page; clicking a page puts it in the composer as the thing a typed
 * change is about. Double-click (or the small open control) opens page focus
 * for direct edits.
 */
import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { sameTarget } from "../../../core/guide/target";
import type { Project } from "../../../core/types";
import { illustrationActionFor, redrawUnits, startRedraw } from "../../../state/chatGeneration";
import { useChatStudio } from "../../../state/chatStudio";
import { useJobsStore } from "../../../state/jobsStore";
import { PreviewSpread } from "../../studio/BookPreview";
import type { DisplaySpread } from "../../studio/spreadModel";
import { useStudio } from "../../studio/StudioContext";
import { cn } from "../../lib/cn";
import { useGuideLabel, useGuideT } from "../intl";
import { PaidAction } from "../chat/PaidAction";
import { UnitStatus } from "./UnitStatus";
import { VersionPager } from "./VersionPager";
import { dispUnitIds, unitTarget } from "./units";

function unitHasArt(project: Project, unitId: string): boolean {
  const tree = project.illustrations?.[unitId];
  return Boolean(tree && Object.keys(tree.nodes ?? {}).length > 0);
}

export function PagesView({
  project,
  index,
  onIndex,
  onFocus,
  stalePages,
}: {
  project: Project;
  index: number;
  onIndex: (index: number) => void;
  onFocus: (unitId: string) => void;
  stalePages: readonly string[];
}) {
  const t = useGuideT("chrome");
  const { displays } = useStudio();
  const chip = useChatStudio((s) => s.chip);
  const setChip = useChatStudio((s) => s.setChip);
  const total = displays.length;
  const at = Math.min(Math.max(0, index), Math.max(0, total - 1));
  const disp = displays[at];
  const stale = useMemo(() => new Set(stalePages), [stalePages]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === "ArrowLeft") onIndex(Math.max(0, at - 1));
      if (event.key === "ArrowRight") onIndex(Math.min(total - 1, at + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, total, onIndex]);

  if (!disp) return null;
  const units = dispUnitIds(disp);
  const isCover = Boolean(disp.cover);
  const overlayBounds = isCover ? "inset-y-0 left-1/4 w-1/2" : "inset-0";

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 py-6 sm:px-16">
        <Arrow side="left" disabled={at === 0} label={t("previousPage")} onClick={() => onIndex(at - 1)} />
        <div className="relative w-full max-w-5xl">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={disp.id}
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={{ duration: 0.2 }}
              className="relative"
            >
              <PreviewSpread disp={disp} />
              <div className={cn("absolute grid", overlayBounds, units.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {units.map((unitId) => {
                  const target = unitTarget(project, unitId);
                  const selected = sameTarget(chip, target);
                  const hasArt = unitHasArt(project, unitId);
                  const drawingTitle =
                    target.kind === "page"
                      ? t("drawingPage", { n: target.page })
                      : t("drawingCover");
                  return (
                    <button
                      key={unitId}
                      type="button"
                      onClick={() => setChip(selected ? null : target)}
                      onDoubleClick={() => onFocus(unitId)}
                      aria-label={target.kind === "page" ? t("page", { n: target.page }) : t("cover")}
                      aria-pressed={selected}
                      className={cn(
                        "group/half relative overflow-hidden transition focus-visible:outline-none",
                        selected ? "ring-2 ring-inset ring-ink-900" : "hover:bg-ink-900/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-500",
                      )}
                    >
                      <UnitStatus
                        unitId={unitId}
                        stale={stale.has(unitId)}
                        bookPage
                        hasArt={hasArt}
                        title={drawingTitle}
                      />
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(event) => {
                          event.stopPropagation();
                          onFocus(unitId);
                        }}
                        className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-white/90 text-ink-600 opacity-0 shadow-soft transition group-hover/half:opacity-100 hover:text-ink-900 pointer-coarse:opacity-100"
                      >
                        <Maximize2 className="size-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className={cn("pointer-events-none absolute grid", overlayBounds, units.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {units.map((unitId) => (
                  <div key={`versions-${unitId}`} className="relative">
                    <VersionPager
                      project={project}
                      target={unitTarget(project, unitId)}
                      className="pointer-events-auto absolute top-2 left-2"
                    />
                  </div>
                ))}
              </div>
              {units.map((unitId, index) =>
                stale.has(unitId) ? (
                  <div
                    key={`redraw-${unitId}`}
                    className={cn(
                      "absolute bottom-4 z-10 -translate-x-1/2",
                      units.length > 1 ? (index === 0 ? "left-1/4" : "left-3/4") : "left-1/2",
                    )}
                  >
                    <PageRedraw project={project} unitId={unitId} />
                  </div>
                ) : null,
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <Arrow side="right" disabled={at >= total - 1} label={t("nextPage")} onClick={() => onIndex(at + 1)} />
      </div>
      <Strip
        displays={displays}
        project={project}
        stale={stale}
        at={at}
        onIndex={onIndex}
        label={disp.label}
      />
    </div>
  );
}

function PageRedraw({ project, unitId }: { project: Project; unitId: string }) {
  const label = useGuideLabel();
  return (
    <span className="rounded-2xl bg-white/95 p-2 shadow-lifted ring-1 ring-ink-900/10">
      <PaidAction
        purpose="redraw"
        units={redrawUnits(project, unitId, illustrationActionFor(unitId))}
        extraKey="page"
        label={label("redrawPage")}
        start={(quote) => startRedraw(quote, "")}
      />
    </span>
  );
}

function Arrow({
  side,
  disabled,
  label,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "absolute top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white text-ink-700 shadow-soft ring-1 ring-ink-900/5 transition hover:text-ink-900 hover:shadow-lifted disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "left-1 sm:left-3" : "right-1 sm:right-3",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

/** Where you are in the book: a row of ticks showing each spread's live state and the spread's name. */
function Strip({
  displays,
  project,
  stale,
  at,
  onIndex,
  label,
}: {
  displays: readonly DisplaySpread[];
  project: Project;
  stale: ReadonlySet<string>;
  at: number;
  onIndex: (i: number) => void;
  label: string;
}) {
  const activeUnitIds = useJobsStore((s) => s.activeUnitIds);
  const failedUnits = useJobsStore((s) => s.failedUnits);
  const drawingBook =
    project.authoringState?.drawBook?.phase === "cast" ||
    project.authoringState?.drawBook?.phase === "pages";

  return (
    <div className="flex shrink-0 flex-col items-center gap-2 pb-5">
      <div className="flex max-w-full items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none]">
        {displays.map((d, i) => {
          const ids = dispUnitIds(d);
          const isCurrent = i === at;
          const isDrawing = ids.some(
            (id) => activeUnitIds.has(id) || (drawingBook && !unitHasArt(project, id)),
          );
          const isDone = ids.length > 0 && ids.every((id) => unitHasArt(project, id));
          const hasIssue =
            !drawingBook && ids.some((id) => Boolean(failedUnits[id]) || stale.has(id));
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => onIndex(i)}
              aria-label={d.label || `${i + 1}`}
              title={d.label}
              aria-current={isCurrent ? "page" : undefined}
              className="flex h-4 items-center px-0.5"
            >
              <span
                className={cn(
                  "block h-1.5 rounded-full transition-all duration-200",
                  isCurrent
                    ? isDrawing
                      ? "w-6 bg-magic-500"
                      : "w-6 bg-ink-900"
                    : hasIssue
                      ? "w-2.5 bg-amber-400 hover:bg-amber-500"
                      : isDrawing
                        ? "w-2.5 animate-pulse bg-magic-300 hover:bg-magic-500 motion-reduce:animate-none"
                        : isDone
                          ? "w-2 bg-ink-400 hover:bg-ink-600"
                          : "w-2 bg-ink-200 hover:bg-ink-400",
                )}
              />
            </button>
          );
        })}
      </div>
      <span className="text-xs text-ink-500">{label}</span>
    </div>
  );
}
