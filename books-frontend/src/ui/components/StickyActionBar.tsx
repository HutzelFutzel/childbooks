import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface StickyActionBarProps {
  /** Left-aligned helper text / status. */
  hint?: ReactNode;
  /** Right-aligned actions (buttons). */
  children: ReactNode;
  className?: string;
}

/**
 * The floating, sticky bottom bar used to carry a stage's primary action
 * (e.g. "Create characters", "Design the pages"). Shared so every stage's
 * call-to-action looks and sits identically.
 */
export function StickyActionBar({ hint, children, className }: StickyActionBarProps) {
  return (
    <div className={cn("sticky bottom-4 z-10 mt-8", className)}>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white/90 p-3 shadow-lifted backdrop-blur">
        {hint ? <div className="min-w-0 pl-2 text-xs text-ink-400">{hint}</div> : <span />}
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
