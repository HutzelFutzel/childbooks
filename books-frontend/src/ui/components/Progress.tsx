import { motion } from "framer-motion";
import { cn } from "../lib/cn";

export interface ProgressProps {
  /** 0..1 completion. Ignored when `indeterminate`. */
  value?: number;
  /** Show a looping sweep instead of a fixed fill (e.g. finishing up). */
  indeterminate?: boolean;
  className?: string;
  /** Track height. */
  size?: "sm" | "md";
}

/**
 * A gradient progress bar. Beautiful by default (brand→accent fill, soft glow).
 * Drive `value` from a real estimate for determinate progress, or set
 * `indeterminate` for the "polishing…" tail once the estimate is exceeded.
 */
export function Progress({ value = 0, indeterminate = false, className, size = "md" }: ProgressProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const h = size === "sm" ? "h-1.5" : "h-2.5";
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-full bg-ink-100", h, className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      {indeterminate ? (
        <motion.div
          className="absolute inset-y-0 w-2/5 rounded-full bg-linear-to-r from-brand-400 to-accent-400"
          initial={{ x: "-120%" }}
          animate={{ x: "320%" }}
          transition={{ duration: 1.3, ease: "easeInOut", repeat: Infinity }}
        />
      ) : (
        <motion.div
          className="h-full rounded-full bg-linear-to-r from-brand-500 to-accent-400 shadow-[0_0_12px_-2px_var(--color-brand-400)]"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 24 }}
        />
      )}
    </div>
  );
}
