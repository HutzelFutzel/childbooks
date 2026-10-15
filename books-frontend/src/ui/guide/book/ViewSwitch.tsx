"use client";

/**
 * The view switch: architectural studio tabs anchored to the pane header bar,
 * with a crisp bottom indicator and subtle hover states.
 */
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { BookOpen, FileText, Palette, Users } from "lucide-react";
import type { BookViewId } from "../../../core/guide/journey";
import { cn } from "../../lib/cn";
import { useGuideT } from "../intl";
import { frameMove } from "../motion";

const VIEW_ICONS: Record<BookViewId, React.ComponentType<{ className?: string }>> = {
  story: FileText,
  style: Palette,
  cast: Users,
  pages: BookOpen,
};

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
  const tabRefs = useRef<Partial<Record<BookViewId, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!active) return;
    const node = tabRefs.current[active];
    node?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active, views.length]);

  if (views.length === 0) return null;
  const announced = views.filter((view) => arrived?.has(view)).map((view) => t(view));
  return (
    <nav
      className={cn(
        "flex h-8 min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none rounded-lg bg-ink-900/[0.055] p-0.5 ring-1 ring-inset ring-ink-900/[0.08]",
        className,
      )}
      role="tablist"
      aria-label="Book"
    >
      <span className="sr-only" aria-live="polite">
        {announced.length > 0 ? announced.join(", ") : ""}
      </span>
      {views.map((view) => {
        const fresh = arrived?.has(view) ?? false;
        const isActive = view === active;
        const Icon = VIEW_ICONS[view];
        return (
          <motion.button
            key={view}
            ref={(node) => {
              tabRefs.current[view] = node;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(view)}
            initial={fresh ? { opacity: 0, y: 6, scale: 0.94 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={frameMove}
            className={cn(
              "group relative inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] px-2 text-xs font-semibold tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 sm:px-2.5",
              isActive ? "text-white" : "text-ink-600 hover:bg-ink-900/[0.04] hover:text-ink-900",
            )}
          >
            {isActive && (
              <motion.span
                aria-hidden
                layoutId="guide-view-underline"
                transition={frameMove}
                className="absolute inset-0 rounded-[6px] bg-ink-900 shadow-[0_1px_2px_rgba(20,22,58,0.2),inset_0_1px_0_rgba(255,255,255,0.14)]"
              />
            )}
            {fresh && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[6px] bg-amber-200/80"
                initial={{ opacity: 0.95 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 1.15, ease: "easeOut" }}
              />
            )}
            <Icon
              className={cn(
                "relative size-3 shrink-0 transition-colors",
                isActive ? "text-white/90" : "text-ink-400 group-hover:text-ink-700",
              )}
              aria-hidden
            />
            <span className="relative">{t(view)}</span>
            {attention?.has(view) && (
              <span
                aria-hidden
                className={cn(
                  "relative size-1.5 shrink-0 rounded-full bg-amber-400",
                  isActive ? "ring-1 ring-ink-900" : "ring-1 ring-white",
                )}
              />
            )}
          </motion.button>
        );
      })}
    </nav>
  );
}
