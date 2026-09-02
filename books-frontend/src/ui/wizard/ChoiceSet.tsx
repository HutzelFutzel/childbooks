"use client";

import { cn } from "../lib/cn";

/**
 * Shared choice language for the Story wizard.
 *
 * Primary choice is a quiet equal-height tile. Follow-up (region, reading
 * style) is a single segmented control revealed under the grid — never nested
 * inside the tile. Selection is the fill, not a check badge.
 */

export function ChoiceGrid({
  "aria-label": ariaLabel,
  columns = 2,
  children,
}: {
  "aria-label": string;
  columns?: 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "grid gap-2",
        columns === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2",
      )}
    >
      {children}
    </div>
  );
}

export function ChoiceTile({
  selected,
  onSelect,
  title,
  caption,
  leading,
  size = "md",
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  caption?: string;
  leading?: React.ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex h-full min-h-14 w-full items-center gap-3 rounded-2xl text-left ring-1 ring-inset transition",
        size === "lg" ? "px-4 py-4" : "px-3.5 py-3",
        selected
          ? "bg-brand-50 ring-brand-400"
          : "bg-white ring-ink-200/80 hover:ring-ink-300",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
      )}
    >
      {leading ? (
        <span className="shrink-0 text-xl leading-none select-none">{leading}</span>
      ) : null}
      <span className="min-w-0">
        <span
          className={cn(
            "block font-display font-semibold tracking-tight text-ink-900",
            size === "lg" ? "text-2xl leading-none" : "text-[15px] leading-snug",
          )}
        >
          {title}
        </span>
        {caption ? (
          <span className="mt-1 block text-xs leading-snug text-ink-400">{caption}</span>
        ) : null}
      </span>
    </button>
  );
}

export function SubChoice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string; leading?: React.ReactNode }[];
}) {
  const cols =
    options.length <= 2
      ? "grid-cols-2"
      : options.length === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : "grid-cols-2 sm:grid-cols-4";

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn("grid gap-1 rounded-2xl bg-ink-100 p-1", cols)}
      >
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.id)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                selected
                  ? "bg-white text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-800",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
              )}
            >
              {option.leading ? (
                <span className="text-sm leading-none select-none">{option.leading}</span>
              ) : null}
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ChoiceHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink-500">{children}</p>;
}

export function StepNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink-500">{children}</p>;
}
