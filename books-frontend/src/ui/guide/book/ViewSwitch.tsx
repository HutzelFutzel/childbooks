"use client";

/**
 * The view switch: the book's parts as quiet text tabs, with one ink
 * underline that slides to the open one. Only parts that exist are listed.
 */
import { motion } from "framer-motion";
import type { BookViewId } from "../../../core/guide/journey";
import { cn } from "../../lib/cn";
import { useGuideT } from "../intl";
import { frameMove } from "../motion";

export function ViewSwitch({
  views,
  active,
  onChange,
  attention,
  arrived,
  className,
}: {
  views: readonly BookViewId[];
  active: BookViewId | null;
  onChange: (view: BookViewId) => void;
  /** Views with something the reader should look at. */
  attention?: ReadonlySet<BookViewId>;
  /** Tabs that just appeared, so their arrival can be seen. */
  arrived?: ReadonlySet<BookViewId>;
  className?: string;
}) {
  const t = useGuideT("views");
  if (views.length === 0) return null;
  const announced = views.filter((view) => arrived?.has(view)).map((view) => t(view));
  return (
    <nav
      className={cn("flex items-center gap-1 overflow-x-auto scrollbar-none", className)}
      role="tablist"
      aria-label="Book"
    >
      <span className="sr-only" aria-live="polite">
        {announced.length > 0 ? announced.join(", ") : ""}
      </span>
      {views.map((view) => {
        const fresh = arrived?.has(view) ?? false;
        return (
          <motion.button
            key={view}
            type="button"
            role="tab"
            aria-selected={view === active}
            onClick={() => onChange(view)}
            initial={fresh ? { opacity: 0, y: 8, scale: 0.92 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={frameMove}
            className={cn(
              "relative shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
              view === active ? "text-ink-900" : "text-ink-500 hover:text-ink-800",
            )}
          >
            {fresh && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-md bg-amber-200/80"
                initial={{ opacity: 0.95 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 1.15, ease: "easeOut" }}
              />
            )}
            <span className="relative">{t(view)}</span>
            {attention?.has(view) && (
              <span aria-hidden className="absolute top-1.5 right-1 size-1.5 rounded-full bg-amber-500" />
            )}
            {view === active && (
              <motion.span
                layoutId="guide-view-underline"
                transition={frameMove}
                className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-ink-900"
              />
            )}
          </motion.button>
        );
      })}
    </nav>
  );
}
