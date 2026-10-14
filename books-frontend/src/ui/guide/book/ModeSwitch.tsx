"use client";

/**
 * Preview | Edit: the one control that says whether the finished book is being
 * read or worked on. It is always on screen once the pages exist, on a phone as
 * well, and it is the way in and the way out. Preview is the book as it prints;
 * Edit is the same page with handles.
 */
import { useRef } from "react";
import { motion } from "framer-motion";
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
      className={cn("relative inline-flex items-center rounded-full bg-ink-100/80 p-0.5", className)}
    >
      {MODES.map((id) => {
        const active = id === mode;
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
              "relative min-h-8 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
              active ? "text-ink-900" : "text-ink-500 hover:text-ink-800",
            )}
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId="guide-mode-pill"
                transition={frameMove}
                className="absolute inset-0 rounded-full bg-white shadow-soft ring-1 ring-ink-900/5"
              />
            )}
            <span className="relative">{t(id === "preview" ? "modePreview" : "modeEdit")}</span>
          </button>
        );
      })}
    </div>
  );
}
