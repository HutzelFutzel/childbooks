"use client";

/**
 * The pages, one spread at a time, as they will print. Arrows or the keyboard
 * turn the page; clicking a page puts it in the composer as the thing a typed
 * change is about. Double-click (or the small open control) opens page focus
 * for direct edits.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Maximize2, SquareDashedMousePointer } from "lucide-react";
import { sameTarget } from "../../../core/guide/target";
import type { Project } from "../../../core/types";
import { illustrationActionFor, redrawUnits, startRedraw } from "../../../state/chatGeneration";
import { useChatStudio } from "../../../state/chatStudio";
import { useJobsStore } from "../../../state/jobsStore";
import { PreviewSpread } from "../../studio/BookPreview";
import { dispAspect, type DisplaySpread } from "../../studio/spreadModel";
import { useStudio } from "../../studio/StudioContext";
import { cn } from "../../lib/cn";
import { useGuideLabel, useGuideT } from "../intl";
import { PaidAction } from "../chat/PaidAction";
import { SpotLayer } from "./SpotLayer";
import { UnitStatus } from "./UnitStatus";
import { VersionPager } from "./VersionPager";
import { dispUnitIds, unitSlots, unitTarget } from "./units";

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
  const hoverUnit = useChatStudio((s) => s.hoverUnit);
  const focusComposer = useChatStudio((s) => s.focusComposer);
  const total = displays.length;
  const at = Math.min(Math.max(0, index), Math.max(0, total - 1));
  const disp = displays[at];
  const stale = useMemo(() => new Set(stalePages), [stalePages]);
  const [marking, setMarking] = useState<string | null>(null);
  // Marking belongs to the picture it started on; turning the page ends it.
  useEffect(() => setMarking(null), [index]);

  const stageRef = useRef<HTMLDivElement>(null);
  const aspect = disp ? dispAspect(disp) : 1;
  const [fitBox, setFitBox] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const update = () => {
      const style = window.getComputedStyle(host);
      const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const pw = host.clientWidth - padX;
      const ph = host.clientHeight - padY;
      if (pw <= 0 || ph <= 0) return;
      let w = pw;
      let h = w / aspect;
      if (h > ph) {
        h = ph;
        w = h * aspect;
      }
      setFitBox({ w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, [aspect]);

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
  const slots = unitSlots(disp);
  const slotOf = (unitId: string) => slots.find((slot) => slot.unitId === unitId) ?? { unitId, left: 0, width: 100 };
  const slotStyle = (unitId: string): React.CSSProperties => {
    const slot = slotOf(unitId);
    return { left: `${slot.left}%`, width: `${slot.width}%` };
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center p-1 sm:p-1.5"
      >
        <Arrow side="left" disabled={at === 0} label={t("previousPage")} onClick={() => onIndex(at - 1)} />
        <div
          className="relative max-h-full max-w-full"
          style={fitBox ? { width: fitBox.w, height: fitBox.h } : { width: "100%", aspectRatio: String(aspect) }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={disp.id}
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ duration: 0.18 }}
              className="relative size-full"
            >
              <PreviewSpread disp={disp} />
              <div className="absolute inset-0">
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
                      style={slotStyle(unitId)}
                      onClick={() => setChip(selected ? null : target)}
                      onDoubleClick={() => onFocus(unitId)}
                      aria-label={target.kind === "page" ? t("page", { n: target.page }) : t("cover")}
                      aria-pressed={selected}
                      className={cn(
                        "group/half absolute inset-y-0 overflow-hidden transition focus-visible:outline-none",
                        selected
                          ? "ring-2 ring-inset ring-ink-900"
                          : hoverUnit === unitId
                            ? "bg-magic-500/10 ring-2 ring-inset ring-magic-400"
                            : "hover:bg-ink-900/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-500",
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
                          setChip(target);
                          void focusComposer();
                        }}
                        className="absolute top-2 right-12 flex h-8 items-center gap-1 rounded-full bg-white/90 px-3 text-xs font-medium text-ink-700 opacity-0 shadow-soft transition group-hover/half:opacity-100 hover:text-ink-900 pointer-coarse:opacity-100"
                      >
                        {t("askAboutPage")}
                      </span>
                      <PageNumberBadge
                        label={target.kind === "page" ? String(target.page) : t("cover")}
                        active={selected || hoverUnit === unitId}
                      />
                      <SpotLayer unitId={unitId} marking={marking === unitId} onDone={() => setMarking(null)} />
                      {hasArt && (
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            setChip(target);
                            setMarking(unitId);
                          }}
                          className="absolute right-2 bottom-2 z-10 flex h-8 items-center gap-1 rounded-full bg-white/90 px-3 text-xs font-medium text-ink-700 opacity-0 shadow-soft transition group-hover/half:opacity-100 hover:text-ink-900 pointer-coarse:opacity-100"
                        >
                          <SquareDashedMousePointer className="size-3.5" />
                          {t("markSpot")}
                        </span>
                      )}
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
              <div className="pointer-events-none absolute inset-0">
                {units.map((unitId) => (
                  <div key={`versions-${unitId}`} className="absolute inset-y-0" style={slotStyle(unitId)}>
                    <VersionPager
                      project={project}
                      target={unitTarget(project, unitId)}
                      className="pointer-events-auto absolute top-2 left-2"
                    />
                  </div>
                ))}
              </div>
              {units.map((unitId) =>
                stale.has(unitId) ? (
                  <div
                    key={`redraw-${unitId}`}
                    className="absolute bottom-4 z-10 -translate-x-1/2"
                    style={{ left: `${slotOf(unitId).left + slotOf(unitId).width / 2}%` }}
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

/**
 * The number a change is asked for by. Always on the page, so nobody has to count; it lights up when the
 * page is the one the message is about, and a tap anywhere on the page (this included) selects it.
 */
export function PageNumberBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute bottom-2 left-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums shadow-soft transition",
        active ? "bg-ink-900 text-white" : "bg-white/90 text-ink-700 ring-1 ring-ink-900/10",
      )}
    >
      {label}
    </span>
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
        "absolute top-1/2 z-20 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink-700 shadow-lifted ring-1 ring-ink-900/10 backdrop-blur-md transition hover:scale-105 hover:bg-white hover:text-ink-900 active:scale-95 disabled:pointer-events-none disabled:opacity-0 sm:size-10",
        side === "left" ? "left-2 sm:left-3.5" : "right-2 sm:right-3.5",
      )}
    >
      <Icon className="size-4.5 sm:size-5" />
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
    <div className="flex shrink-0 items-center justify-center px-4 pb-2.5 pt-0.5">
      <div className="inline-flex max-w-full items-center gap-2.5 rounded-full bg-white/85 px-3.5 py-1 shadow-2xs ring-1 ring-ink-900/8 backdrop-blur-sm">
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
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
                        ? "w-5 bg-magic-500"
                        : "w-5 bg-ink-900"
                      : hasIssue
                        ? "w-2 bg-amber-400 hover:bg-amber-500"
                        : isDrawing
                          ? "w-2 animate-pulse bg-magic-300 hover:bg-magic-500 motion-reduce:animate-none"
                          : isDone
                            ? "w-1.5 bg-ink-400 hover:bg-ink-600"
                            : "w-1.5 bg-ink-200 hover:bg-ink-400",
                  )}
                />
              </button>
            );
          })}
        </div>
        {label && (
          <>
            <span aria-hidden className="h-3 w-px bg-ink-900/10" />
            <span className="shrink-0 text-[11px] font-semibold tracking-tight text-ink-600">
              {label}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
