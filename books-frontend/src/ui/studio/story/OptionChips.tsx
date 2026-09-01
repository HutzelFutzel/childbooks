"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Pencil, X } from "lucide-react";
import type { StoryOption } from "../../../core/config/storyCraftCatalog";
import { Input } from "../../components/Input";
import { Tooltip } from "../../components/Tooltip";
import { cn } from "../../lib/cn";
import { spring } from "../../lib/motion";
import type { StoryHistoryOptions } from "./storyUndo";

export interface OptionChipsProps {
  label: string;
  /** Shown next to the label when the choice is optional. */
  optional?: boolean;
  hint?: string;
  subhint?: string;
  options: StoryOption[];
  /** Single selection mode id */
  selectedId?: string | null;
  /** Multiple selection mode ids */
  selectedIds?: string[];
  /** Allow choosing multiple options (e.g. up to 2 stylistic devices) */
  multiple?: boolean;
  maxSelectable?: number;
  custom?: string;
  onChange: (
    patch: {
      id?: string | null;
      ids?: string[];
      custom?: string;
    },
    options?: StoryHistoryOptions,
  ) => void;
  customPlaceholder: string;
}

/**
 * Modern curated option chips for Story themes and stylistic devices.
 * Features:
 * - Rich tooltips on hover/focus displaying the full explanation without causing layout shift.
 * - Single-select or multi-select with configurable maximums.
 * - Smooth custom free-text input drawer.
 */
export function OptionChips({
  label,
  optional,
  hint,
  subhint,
  options,
  selectedId,
  selectedIds,
  multiple = false,
  maxSelectable = 2,
  custom,
  onChange,
  customPlaceholder,
}: OptionChipsProps) {
  const [customOpen, setCustomOpen] = useState(Boolean(custom?.trim()));
  const customRef = useRef<HTMLInputElement>(null);

  // Normalize selected IDs set
  const activeIds = multiple
    ? selectedIds ?? (selectedId ? [selectedId] : [])
    : selectedId
    ? [selectedId]
    : [];

  // Reopen when a custom value arrives from elsewhere
  useEffect(() => {
    if (custom?.trim()) setCustomOpen(true);
  }, [custom]);

  const handleToggleOption = (optionId: string) => {
    setCustomOpen(false);

    if (multiple) {
      const isSelected = activeIds.includes(optionId);
      let nextIds: string[];

      if (isSelected) {
        nextIds = activeIds.filter((id) => id !== optionId);
      } else {
        if (activeIds.length >= maxSelectable) {
          // Replace oldest selected option to stay within bounds
          nextIds = [...activeIds.slice(1), optionId];
        } else {
          nextIds = [...activeIds, optionId];
        }
      }

      onChange({
        ids: nextIds,
        id: nextIds[0] ?? null,
        custom: "",
      });
    } else {
      const active = selectedId === optionId;
      const nextId = active ? null : optionId;
      onChange({
        id: nextId,
        ids: nextId ? [nextId] : [],
        custom: "",
      });
    }
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-600">
            {label}
          </span>
          {hint && (
            <span className="text-[11px] font-normal text-ink-400">· {hint}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {multiple && (
            <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-brand-700 ring-1 ring-inset ring-brand-200/70">
              Pick up to {maxSelectable}
            </span>
          )}
          {optional && (
            <span className="rounded-md bg-ink-100/70 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
              optional
            </span>
          )}
        </div>
      </div>

      {subhint && (
        <p className="text-[11px] leading-tight text-ink-400">{subhint}</p>
      )}

      {/* Chips Cloud */}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option, i) => {
          const isSelected = activeIds.includes(option.id);

          return (
            <Tooltip
              key={option.id}
              side="top"
              align="center"
              panelClassName="w-56"
              content={
                <div className="space-y-1 text-left">
                  <div className="font-semibold text-xs text-white">
                    {option.label}
                  </div>
                  <p className="text-[11px] leading-relaxed text-ink-200 font-normal">
                    {option.description}
                  </p>
                  {multiple && (
                    <p className="pt-0.5 text-[10px] font-medium text-brand-300">
                      {isSelected ? "Click to remove" : "Click to select"}
                    </p>
                  )}
                </div>
              }
            >
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: Math.min(i, 8) * 0.015 }}
                onClick={() => handleToggleOption(option.id)}
                aria-pressed={isSelected}
                className={cn(
                  "group relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 select-none",
                  isSelected
                    ? "bg-brand-600 text-white shadow-soft ring-1 ring-brand-600 font-semibold scale-[1.01]"
                    : "bg-white text-ink-700 ring-1 ring-ink-200/90 hover:bg-ink-50 hover:ring-brand-300 hover:text-ink-900 shadow-2xs",
                )}
              >
                {isSelected && (
                  <Check className="size-3 shrink-0 stroke-[2.5]" />
                )}
                <span>{option.label}</span>
              </motion.button>
            </Tooltip>
          );
        })}

        {/* Something else / Custom Toggle */}
        <button
          type="button"
          onClick={() => {
            const nextState = !customOpen;
            setCustomOpen(nextState);
            if (nextState) {
              if (multiple) {
                onChange({ ids: [], id: null });
              } else {
                onChange({ id: null });
              }
              requestAnimationFrame(() => customRef.current?.focus());
            }
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition select-none",
            customOpen
              ? "bg-ink-800 text-white shadow-soft ring-1 ring-ink-900 font-semibold"
              : "bg-white/80 text-ink-600 ring-1 ring-dashed ring-ink-300 hover:bg-ink-50 hover:ring-ink-400 hover:text-ink-800",
          )}
        >
          <Pencil className="size-3" />
          <span>Something else</span>
        </button>
      </div>

      {/* Custom Input Drawer */}
      <AnimatePresence>
        {customOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden pt-1"
          >
            <div className="relative">
              <Input
                ref={customRef}
                value={custom ?? ""}
                onChange={(e) =>
                  onChange(
                    {
                      id: null,
                      ids: [],
                      custom: e.target.value,
                    },
                    { coalesce: `story-option:${label}` },
                  )
                }
                placeholder={customPlaceholder}
                maxLength={300}
                aria-label={`${label} — your own`}
                className="pr-8 text-xs h-8.5 bg-white shadow-2xs"
              />
              {custom && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(
                      { id: null, ids: [], custom: "" },
                      { coalesce: `story-option:${label}` },
                    );
                    customRef.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-ink-400 hover:text-ink-700"
                  aria-label="Clear custom text"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
