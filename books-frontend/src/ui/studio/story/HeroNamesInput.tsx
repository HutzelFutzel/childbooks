"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { splitHeroNames } from "../../../core/story/brief";

const MAX_NAMES = 12;
const MAX_NAME_LENGTH = 40;

/** Splits on commas, ampersands, pluses, slashes, or standalone "and"/"und" */
export const splitNames = splitHeroNames;

export interface HeroNamesInputProps {
  names: string[];
  onChange: (names: string[]) => void;
  onDraftChange?: (draft: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * A seamless name input for one or more hero names.
 * Features:
 * - Live draft syncing so the form is immediately valid as the user types without requiring an Enter/blur lock-in step.
 * - Natural splitting on commas, ampersands, or "and" (e.g. "Mila, Leo" or "Mila & Leo" or "Mila and Leo").
 * - Clear chip badges with remove buttons and an inline "+ Add" action for siblings.
 */
export function HeroNamesInput({
  names,
  onChange,
  onDraftChange,
  placeholder = "e.g. Mila",
  autoFocus,
}: HeroNamesInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (textToCommit?: string) => {
    const raw = (textToCommit ?? draft).trim();
    if (!raw) return;

    const room = MAX_NAMES - names.length;
    if (room <= 0) {
      setDraft("");
      onDraftChange?.("");
      return;
    }

    const existing = new Set(names.map((n) => n.toLowerCase()));
    const additions: string[] = [];
    for (const candidate of splitNames(raw)) {
      const trimmed = candidate.slice(0, MAX_NAME_LENGTH);
      const key = trimmed.toLowerCase();
      // De-dupe case-insensitively so retyping "Mila" doesn't create a second chip.
      if (existing.has(key) || additions.length >= room) continue;
      existing.add(key);
      additions.push(trimmed);
    }

    setDraft("");
    onDraftChange?.("");
    if (additions.length > 0) {
      onChange([...names, ...additions]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Auto-split on comma, &, +, /, ;, or typing " and " / " und " / " et "
    if (
      val.includes(",") ||
      val.includes("&") ||
      val.includes("+") ||
      val.includes("/") ||
      val.includes(";") ||
      /\b(?:and|und|et|y)\s+/i.test(val)
    ) {
      commit(val);
      return;
    }
    setDraft(val);
    onDraftChange?.(val);
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={cn(
        "group flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-2.5 py-1.5 transition cursor-text shadow-2xs",
        "focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100",
      )}
    >
      {names.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200/70"
        >
          <span>{name}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(names.filter((_, j) => j !== i));
            }}
            aria-label={`Remove ${name}`}
            className="rounded-full p-0.5 text-brand-500 transition hover:bg-brand-100 hover:text-brand-800"
          >
            <X className="size-3" strokeWidth={2.5} />
          </button>
        </span>
      ))}

      <div className="flex flex-1 items-center gap-1 min-w-28">
        <input
          ref={inputRef}
          data-native-undo
          autoFocus={autoFocus}
          value={draft}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && names.length > 0) {
              onChange(names.slice(0, -1));
            }
          }}
          onBlur={() => commit()}
          placeholder={names.length === 0 ? placeholder : "Add sibling or another hero…"}
          maxLength={MAX_NAME_LENGTH * 2}
          disabled={names.length >= MAX_NAMES}
          aria-label={names.length === 0 ? "Hero name" : "Add another hero name"}
          className="w-full border-0 bg-transparent px-1 py-1 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-0"
        />

        {draft.trim().length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              commit();
              inputRef.current?.focus();
            }}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100 transition ring-1 ring-brand-200"
            title="Add as another hero"
          >
            <Plus className="size-3" />
            <span>Add</span>
          </button>
        )}
      </div>
    </div>
  );
}
