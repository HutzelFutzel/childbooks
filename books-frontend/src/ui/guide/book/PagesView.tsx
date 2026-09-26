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
import { useChatStudio } from "../../../state/chatStudio";
import { PreviewSpread } from "../../studio/BookPreview";
import { useStudio } from "../../studio/StudioContext";
import { cn } from "../../lib/cn";
import { useGuideT } from "../intl";
import { UnitStatus } from "./UnitStatus";
import { dispUnitIds, unitTarget } from "./units";

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
              <div className={cn("absolute inset-0 grid", units.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {units.map((unitId) => {
                  const target = unitTarget(project, unitId);
                  const selected = sameTarget(chip, target);
                  return (
                    <button
                      key={unitId}
                      type="button"
                      onClick={() => setChip(selected ? null : target)}
                      onDoubleClick={() => onFocus(unitId)}
                      aria-label={target.kind === "page" ? t("page", { n: target.page }) : t("cover")}
                      aria-pressed={selected}
                      className={cn(
                        "group/half relative transition focus-visible:outline-none",
                        selected ? "ring-2 ring-inset ring-ink-900" : "hover:bg-ink-900/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-500",
                      )}
                    >
                      <UnitStatus unitId={unitId} stale={stale.has(unitId)} />
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
            </motion.div>
          </AnimatePresence>
        </div>
        <Arrow side="right" disabled={at >= total - 1} label={t("nextPage")} onClick={() => onIndex(at + 1)} />
      </div>
      <Strip count={total} at={at} onIndex={onIndex} label={disp.label} />
    </div>
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

/** Where you are in the book: a quiet row of ticks and the spread's name. */
function Strip({ count, at, onIndex, label }: { count: number; at: number; onIndex: (i: number) => void; label: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2 pb-5">
      <div className="flex max-w-full items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none]">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onIndex(i)}
            aria-label={`${i + 1}`}
            aria-current={i === at ? "page" : undefined}
            className="flex h-4 items-center px-0.5"
          >
            <span
              className={cn(
                "block h-1 rounded-full transition-all duration-200",
                i === at ? "w-5 bg-ink-900" : "w-2 bg-ink-200 hover:bg-ink-400",
              )}
            />
          </button>
        ))}
      </div>
      <span className="text-xs text-ink-500">{label}</span>
    </div>
  );
}
