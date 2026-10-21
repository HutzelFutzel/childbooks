"use client";

/**
 * The state of one picture on the book: an active studio canvas while it is
 * being drawn from scratch, a violet sheen and live badge when an existing
 * picture is being redrawn or prepared, and a quiet label when it is out of
 * date or could not be drawn. Nothing at all when it is fine. A page the book
 * job is still responsible for stays on "Drawing" — the server retries it, and
 * the reader is not asked to.
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Sparkles } from "lucide-react";
import { useJobsStore } from "../../../state/jobsStore";
import { usePortraitStartStore } from "../../../state/portraitAutoStart";
import { useProjectsStore } from "../../../state/projectsStore";
import { cn } from "../../lib/cn";
import { useGuideT } from "../intl";

export function useUnitWorking(unitId: string, extraUnitId?: string, bookPage = false, hasArt = true) {
  const jobActive = useJobsStore((s) => s.activeUnitIds.has(unitId));
  const extraActive = useJobsStore((s) => Boolean(extraUnitId && s.activeUnitIds.has(extraUnitId)));
  const portraitStarting = usePortraitStartStore((s) => unitId in s.started);
  const failed = useJobsStore((s) =>
    Boolean(s.failedUnits[unitId] || (extraUnitId && s.failedUnits[extraUnitId])),
  );
  const drawPhase = useProjectsStore((s) => s.current()?.authoringState?.drawBook?.phase ?? null);
  const drawingBook = drawPhase === "cast" || drawPhase === "pages";
  const active = jobActive || extraActive || portraitStarting;
  const working = active || (bookPage && drawingBook && (failed || !hasArt));
  const preparing = extraActive && !jobActive && !portraitStarting;
  return { working, active, preparing, failed, drawPhase };
}

/** A picture normally takes well under a minute; past this the reader is told it is slow, not stuck. */
const SLOW_AFTER_MS = 3 * 60_000;

/** True once `active` has been true for {@link SLOW_AFTER_MS} without a break. */
function useSlowWhile(active: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [active]);
  return active && slow;
}

export function UnitStatus({
  unitId,
  extraUnitId,
  stale = false,
  bookPage = false,
  hasArt = true,
  title,
  subtitle,
}: {
  unitId: string;
  /** Secondary unit id (e.g. the character's consistency anchor id during book prep). */
  extraUnitId?: string;
  stale?: boolean;
  /** A story page of Draw the book, whose failures the server still owns. */
  bookPage?: boolean;
  /** Whether a rendered image is already displayed beneath this status layer. */
  hasArt?: boolean;
  /** Specific heading shown while drawing (e.g. "Drawing Maya…" or "Drawing page 2…"). */
  title?: string;
  /** Reassuring subtitle shown while drawing from scratch. */
  subtitle?: string;
}) {
  const t = useGuideT("chrome");
  const reduce = useReducedMotion();
  const { working, preparing, failed, drawPhase } = useUnitWorking(
    unitId,
    extraUnitId,
    bookPage,
    hasArt,
  );

  // Not for book pages: a queued page of a long book legitimately waits its turn for many minutes.
  const slow = useSlowWhile(working && !bookPage);

  const activeHeading = preparing
    ? t("preparingUnit")
    : title ?? t("working");
  const activeSubtitle = slow
    ? t("takingLonger")
    : bookPage && drawPhase === "cast"
      ? t("preparingBook")
      : subtitle ?? (bookPage ? t("pageAppearsWhenReady") : undefined);

  const badgeLabel = working
    ? slow && hasArt
      ? t("takingLonger")
      : activeHeading
    : failed
      ? t("failed")
      : stale
        ? t("stale")
        : null;

  return (
    <AnimatePresence>
      {working && !hasArt && !bookPage && (
        <motion.span
          key="plate-canvas"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-aurora p-4 text-center ring-2 ring-inset ring-magic-300/70"
        >
          <span className="shimmer absolute inset-0 opacity-65" />
          <span className="relative z-10 flex max-w-[14rem] flex-col items-center gap-3">
            <span className="relative flex size-14 items-center justify-center rounded-full bg-white/95 shadow-soft ring-1 ring-magic-200">
              {!reduce && (
                <span className="absolute -inset-1 animate-spin rounded-full border-2 border-magic-200 border-t-magic-500 [animation-duration:2.2s]" />
              )}
              <Sparkles className="size-6 text-magic-500" />
            </span>
            <span className="flex flex-col items-center gap-1">
              <span className="font-display text-sm font-medium text-ink-900">
                {activeHeading}
              </span>
              {activeSubtitle && (
                <span className="text-[11px] leading-snug text-ink-500">
                  {activeSubtitle}
                </span>
              )}
            </span>
            <span className="relative h-1 w-24 overflow-hidden rounded-full bg-magic-100">
              {reduce ? (
                <span className="block h-full w-1/2 rounded-full bg-magic-500" />
              ) : (
                <motion.span
                  className="block h-full w-1/2 rounded-full bg-magic-500"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </span>
          </span>
        </motion.span>
      )}

      {working && !hasArt && bookPage && (
        <motion.span
          key="page-canvas"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden p-4 ring-2 ring-inset ring-magic-300/70"
        >
          <span className="absolute inset-0 bg-magic-500/[0.05]" />
          <span className="absolute inset-y-0 -left-1/2 w-1/2 animate-[guide-sheen_2.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/55 to-transparent motion-reduce:hidden" />
          <span className="relative z-10 flex max-w-[16rem] flex-col items-center gap-2.5 rounded-2xl bg-white/95 px-4 py-3.5 text-center shadow-lifted ring-1 ring-magic-200/90 backdrop-blur-xs">
            <span className="relative flex size-10 items-center justify-center rounded-full bg-magic-50 ring-1 ring-magic-200/80">
              {!reduce && (
                <span className="absolute -inset-0.5 animate-spin rounded-full border-2 border-magic-200 border-t-magic-500 [animation-duration:2.2s]" />
              )}
              <Sparkles className="size-4 text-magic-700" />
            </span>
            <span className="flex flex-col items-center gap-0.5">
              <span className="font-display text-[13px] font-medium text-ink-900">
                {activeHeading}
              </span>
              {activeSubtitle && (
                <span className="text-[11px] leading-snug text-ink-500">
                  {activeSubtitle}
                </span>
              )}
            </span>
            <span className="relative h-1 w-28 overflow-hidden rounded-full bg-magic-100">
              {reduce ? (
                <span className="block h-full w-1/2 rounded-full bg-magic-500" />
              ) : (
                <motion.span
                  className="block h-full w-1/2 rounded-full bg-magic-500"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
            </span>
          </span>
        </motion.span>
      )}

      {working && hasArt && (
        <motion.span
          key="sheen"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 overflow-hidden ring-2 ring-inset ring-magic-400/75"
        >
          <span className="absolute inset-0 bg-magic-500/[0.08]" />
          <span className="absolute inset-y-0 -left-1/2 w-1/2 animate-[guide-sheen_2.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/45 to-transparent motion-reduce:hidden" />
        </motion.span>
      )}

      {badgeLabel && (hasArt || !working) && (
        <motion.span
          key={badgeLabel}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={cn(
            "pointer-events-none absolute bottom-2.5 left-2.5 inline-flex max-w-[calc(100%-1.25rem)] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium shadow-soft backdrop-blur-xs",
            working
              ? "bg-white/95 text-magic-700 ring-1 ring-magic-300/80"
              : failed
                ? "bg-white/95 text-amber-800 ring-1 ring-amber-300"
                : "bg-white/95 text-ink-600 ring-1 ring-ink-200",
          )}
        >
          {working ? (
            <span className="relative flex size-2 shrink-0" aria-hidden>
              {!reduce && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-magic-500/70" />
              )}
              <span className="relative size-2 rounded-full bg-magic-500" />
            </span>
          ) : failed ? (
            <AlertTriangle className="size-3 shrink-0 text-amber-600" aria-hidden />
          ) : (
            <Clock className="size-3 shrink-0 text-ink-400" aria-hidden />
          )}
          <span className="truncate">{badgeLabel}</span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
