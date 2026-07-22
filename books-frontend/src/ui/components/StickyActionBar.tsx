import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface StickyActionBarProps {
  /** Left-aligned helper text / status. */
  hint?: ReactNode;
  /** Right-aligned actions (buttons). */
  children: ReactNode;
  className?: string;
  /**
   * Whether this renders as the bold, floating pill that follows you down
   * the page, or settles for a quiet, plain-in-flow bar. Reserve floating
   * for moments that genuinely need to grab attention (nothing started yet,
   * or the stage is complete and ready to advance) — for everything in
   * between it's one action among several the user might take, not the
   * one thing demanding focus, so it shouldn't hover over their work.
   * Defaults to `true` to match the bar's original, always-floating behavior.
   */
  floating?: boolean;
}

/**
 * The bottom bar used to carry a stage's primary action (e.g. "Create
 * characters", "Design the pages"). Shared so every stage's call-to-action
 * looks and sits identically. See `floating` for when it should — and
 * shouldn't — float over the page.
 */
export function StickyActionBar({
  hint,
  children,
  className,
  floating = true,
}: StickyActionBarProps) {
  if (!floating) {
    return (
      <div
        className={cn(
          "mt-8 flex items-center justify-between gap-3 border-t border-ink-100 pt-4",
          className,
        )}
      >
        {hint ? <div className="min-w-0 text-xs text-ink-400">{hint}</div> : <span />}
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    );
  }
  return (
    <div className={cn("sticky bottom-4 z-10 mt-8", className)}>
      <div className="flex items-center justify-between gap-3 rounded-full bg-white/80 p-3 ring-1 ring-ink-200/60 shadow-lifted backdrop-blur">
        {hint ? <div className="min-w-0 pl-3 text-xs text-ink-400">{hint}</div> : <span />}
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
