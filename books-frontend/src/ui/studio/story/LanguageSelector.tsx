"use client";

import { ChevronDown, Globe } from "lucide-react";
import {
  enabledBookLanguages,
  getBookLanguage,
  type BookLanguageId,
} from "../../../core/config/bookLanguages";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { cn } from "../../lib/cn";

export interface LanguageSelectorProps {
  value?: BookLanguageId;
  onChange: (locale: BookLanguageId) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function LanguageSelector({
  value = "en-US",
  onChange,
  disabled,
  className,
  size = "md",
}: LanguageSelectorProps) {
  const policy = useAppConfigStore((state) => state.bookLanguages);
  const current = getBookLanguage(value);
  const enabled = enabledBookLanguages(policy);
  const choices = enabled.some((l) => l.id === current.id) ? enabled : [current, ...enabled];

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <label className="sr-only" htmlFor="story-content-language-select">
        Story language
      </label>
      <div className="relative flex items-center">
        <Globe
          className={cn(
            "pointer-events-none absolute left-2.5 text-ink-400",
            size === "sm" ? "size-3" : "size-3.5",
          )}
          aria-hidden
        />
        <select
          id="story-content-language-select"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as BookLanguageId)}
          className={cn(
            "appearance-none rounded-lg border border-ink-200 bg-white font-medium text-ink-700 shadow-2xs transition hover:border-ink-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20 disabled:opacity-60 cursor-pointer",
            size === "sm"
              ? "h-8 py-1 pl-7 pr-7 text-xs"
              : "h-9 py-1.5 pl-8 pr-8 text-xs",
          )}
          title="Story language"
        >
          {choices.map((lang) => (
            <option key={lang.id} value={lang.id}>
              {lang.flag} {lang.endonym} ({lang.regionShort})
            </option>
          ))}
        </select>
        <ChevronDown
          className={cn(
            "pointer-events-none absolute right-2 text-ink-400",
            size === "sm" ? "size-3" : "size-3.5",
          )}
          aria-hidden
        />
      </div>
    </div>
  );
}
