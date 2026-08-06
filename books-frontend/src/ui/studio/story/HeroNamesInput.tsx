"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

const MAX_NAMES = 12;
const MAX_NAME_LENGTH = 40;

/** Splits on commas or a standalone "and" — however someone naturally lists names. */
function splitNames(raw: string): string[] {
  return raw
    .split(/,|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A tag input for one or more hero names. Typing "Mila and Leo" (or
 * "Mila, Leo") and pressing Enter or tabbing away splits it into two chips —
 * each is a separate name the story must actually use, not one combined name.
 */
export function HeroNamesInput({
  names,
  onChange,
  placeholder,
}: {
  names: string[];
  onChange: (names: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    if (!draft.trim()) return;
    const room = MAX_NAMES - names.length;
    if (room <= 0) {
      setDraft("");
      return;
    }
    const existing = new Set(names.map((n) => n.toLowerCase()));
    const additions: string[] = [];
    for (const candidate of splitNames(draft)) {
      const trimmed = candidate.slice(0, MAX_NAME_LENGTH);
      const key = trimmed.toLowerCase();
      // De-dupe case-insensitively so retyping "Mila" doesn't create a second chip.
      if (existing.has(key) || additions.length >= room) continue;
      existing.add(key);
      additions.push(trimmed);
    }
    setDraft("");
    if (additions.length > 0) onChange([...names, ...additions]);
  };

  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-2.5 py-1.5 transition",
        "focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100",
      )}
    >
      {names.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-brand-700"
        >
          {name}
          <button
            type="button"
            onClick={() => onChange(names.filter((_, j) => j !== i))}
            aria-label={`Remove ${name}`}
            className="rounded-full p-0.5 text-brand-500 transition hover:bg-brand-100 hover:text-brand-800"
          >
            <X className="size-3" strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && names.length > 0) {
            onChange(names.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={names.length === 0 ? placeholder : "Add another…"}
        maxLength={MAX_NAME_LENGTH * 2}
        disabled={names.length >= MAX_NAMES}
        aria-label={names.length === 0 ? "Hero name" : "Add another hero name"}
        className="min-w-28 flex-1 border-0 bg-transparent px-1 py-1 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-0"
      />
    </div>
  );
}
