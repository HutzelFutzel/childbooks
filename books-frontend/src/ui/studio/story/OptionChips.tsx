"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Pencil } from "lucide-react";
import type { StoryOption } from "../../../core/config/storyCraftCatalog";
import { Input } from "../../components/Input";
import { cn } from "../../lib/cn";
import { spring } from "../../lib/motion";
import type { StoryHistoryOptions } from "./storyUndo";

export interface OptionChipsProps {
  label: string;
  /** Shown next to the label when the choice is optional. */
  optional?: boolean;
  hint?: string;
  options: StoryOption[];
  selectedId: string | null | undefined;
  custom: string | undefined;
  onChange: (
    patch: { id: string | null; custom?: string },
    options?: StoryHistoryOptions,
  ) => void;
  customPlaceholder: string;
}

/**
 * One curated catalog rendered as chips, with an always-available escape hatch
 * to the reader's own words. Catalog and custom are mutually exclusive — the
 * prompt takes one or the other, so the UI can't leave both set.
 */
export function OptionChips({
  label,
  optional,
  hint,
  options,
  selectedId,
  custom,
  onChange,
  customPlaceholder,
}: OptionChipsProps) {
  const [customOpen, setCustomOpen] = useState(Boolean(custom?.trim()));
  const customRef = useRef<HTMLInputElement>(null);

  // Reopen when a custom value arrives from elsewhere (e.g. loading a project).
  useEffect(() => {
    if (custom?.trim()) setCustomOpen(true);
  }, [custom]);

  const selected = options.find((o) => o.id === selectedId);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</span>
        {optional && (
          <span className="text-[11px] font-medium text-ink-400">optional</span>
        )}
        {hint && <span className="text-[11px] text-ink-400">· {hint}</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {options.map((option, i) => {
          const active = option.id === selectedId;
          return (
            <motion.button
              key={option.id}
              type="button"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: Math.min(i, 10) * 0.02 }}
              onClick={() => {
                setCustomOpen(false);
                onChange({ id: active ? null : option.id, custom: "" });
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "bg-magic-500 text-white shadow-soft"
                  : "bg-white/80 text-ink-600 ring-1 ring-ink-200 hover:ring-magic-300",
              )}
            >
              {active && <Check className="mr-1 inline size-3" strokeWidth={3} />}
              {option.label}
            </motion.button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setCustomOpen(true);
            onChange({ id: null });
            requestAnimationFrame(() => customRef.current?.focus());
          }}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition",
            customOpen
              ? "bg-ink-800 text-white shadow-soft"
              : "bg-white/80 text-ink-500 ring-1 ring-dashed ring-ink-300 hover:ring-ink-400",
          )}
        >
          <Pencil className="mr-1 inline size-3" />
          Something else
        </button>
      </div>

      {customOpen && (
        <Input
          ref={customRef}
          value={custom ?? ""}
          onChange={(e) =>
            onChange(
              { id: null, custom: e.target.value },
              { coalesce: `story-option:${label}` },
            )
          }
          placeholder={customPlaceholder}
          maxLength={300}
          aria-label={`${label} — your own`}
          className="mt-2.5"
        />
      )}

      {selected && !customOpen && (
        <p className="mt-2 text-xs leading-relaxed text-ink-500">{selected.description}</p>
      )}
    </div>
  );
}
