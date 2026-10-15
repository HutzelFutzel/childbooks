"use client";

/**
 * Preview | Edit: the one control that says whether the finished book is being
 * read or worked on. It is always on screen once the pages exist, on a phone as
 * well, and it is the way in and the way out. Preview is the book as it prints;
 * Edit is the same page with handles.
 */
import { useRef } from "react";
import { motion } from "framer-motion";
import { Eye, SlidersHorizontal } from "lucide-react";
import { cn } from "../../lib/cn";
import { useGuideT } from "../intl";
import { frameMove } from "../motion";

export type BookMode = "preview" | "edit";

const MODES: readonly BookMode[] = ["preview", "edit"];

export function ModeSwitch({
  mode,
  onChange,
  className,
}: {
  mode: BookMode;
  onChange: (mode: BookMode) => void;
  className?: string;
}) {
  const t = useGuideT("chrome");
  const refs = useRef<Record<BookMode, HTMLButtonElement | null>>({ preview: null, edit: null });

  // A radio group: arrows move between the two and choose, as the platform does.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next: BookMode = mode === "preview" ? "edit" : "preview";
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("bookMode")}
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex h-8 shrink-0 items-center rounded-lg bg-ink-900/[0.055] p-0.5 ring-1 ring-inset ring-ink-900/[0.08]",
        className,
      )}
    >
      {MODES.map((id) => {
        const active = id === mode;
        const Icon = id === "preview" ? Eye : SlidersHorizontal;
        return (
          <button
            key={id}
            ref={(node) => {
              refs.current[id] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => !active && onChange(id)}
            className={cn(
              "relative inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs font-semibold tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 sm:px-2.5",
              active ? "text-ink-900" : "text-ink-500 hover:text-ink-800",
            )}
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId="guide-mode-pill"
                transition={frameMove}
                className="absolute inset-0 rounded-[6px] bg-white shadow-[0_1px_2px_rgba(20,22,58,0.12),0_0_0_1px_rgba(20,22,58,0.08)]"
              />
            )}
            <Icon
              className={cn(
                "relative size-3 shrink-0",
                active ? "text-ink-900" : "text-ink-400",
              )}
              aria-hidden
            />
            <span className="relative">{t(id === "preview" ? "modePreview" : "modeEdit")}</span>
          </button>
        );
      })}
    </div>
  );
}
