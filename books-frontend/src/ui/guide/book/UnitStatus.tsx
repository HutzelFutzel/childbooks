"use client";

/**
 * The state of one picture on the book: a violet sheen while it is being
 * drawn, a quiet label when it is out of date or needs another go. Nothing at
 * all when it is fine.
 */
import { AnimatePresence, motion } from "framer-motion";
import { useJobsStore } from "../../../state/jobsStore";
import { useGuideT } from "../intl";

export function UnitStatus({ unitId, stale = false }: { unitId: string; stale?: boolean }) {
  const t = useGuideT("chrome");
  const active = useJobsStore((s) => s.activeUnitIds.has(unitId));
  const failed = useJobsStore((s) => Boolean(s.failedUnits[unitId]));
  const label = active ? t("working") : failed ? t("failed") : stale ? t("stale") : null;
  return (
    <AnimatePresence>
      {active && (
        <motion.span
          key="sheen"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <span className="absolute inset-0 bg-magic-500/[0.06]" />
          <span className="absolute inset-y-0 -left-1/2 w-1/2 animate-[guide-sheen_2.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent motion-reduce:hidden" />
        </motion.span>
      )}
      {label && (
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={
            active
              ? "absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-magic-700 shadow-soft"
              : failed
                ? "absolute bottom-2 left-2 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-medium text-amber-700 shadow-soft ring-1 ring-amber-200"
                : "absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-ink-600 shadow-soft"
          }
        >
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
