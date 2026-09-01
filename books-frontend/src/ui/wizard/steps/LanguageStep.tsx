"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Globe2, Search, Sparkles, X } from "lucide-react";
import {
  BOOK_LANGUAGES,
  detectDefaultBookLanguage,
  enabledBookLanguages,
  getBookLanguage,
  type BookLanguageDefinition,
  type BookLanguageId,
} from "../../../core/config/bookLanguages";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { resolveShipCountry, useShipCountryStore } from "../../../state/shipCountryStore";
import { cn } from "../../lib/cn";
import { fadeRise, spring } from "../../lib/motion";
import type { StepProps } from "./types";

interface LanguageGroup {
  key: string;
  endonym: string;
  englishLabel: string | null;
  storyGreeting: string;
  singleFlag?: string;
  variants: BookLanguageDefinition[];
}

export function LanguageStep({ config, update }: StepProps) {
  const policy = useAppConfigStore((state) => state.bookLanguages);
  const current = getBookLanguage(config.contentLocale);
  const enabled = enabledBookLanguages(policy);
  const choices = enabled.some((language) => language.id === current.id)
    ? enabled
    : [current, ...enabled];

  const [query, setQuery] = useState("");

  const hasStory = config.storyText.trim().length > 0;
  const originLocale: BookLanguageId =
    (config.storyBrief?.generatedForLocale as BookLanguageId) ?? "en-US";
  const currentLocale: BookLanguageId =
    (config.contentLocale as BookLanguageId) ?? "en-US";
  const languageChanged = hasStory && originLocale !== currentLocale;

  // Ensure geolocation country detection is triggered and syncs default language if unset
  const geoCountry = useShipCountryStore((s) => s.detected);
  useEffect(() => {
    useShipCountryStore.getState().hydrate();
    void useShipCountryStore.getState().detect();
  }, []);

  useEffect(() => {
    if (!config.contentLocale) {
      if (hasStory) {
        // Existing stories created before language selection always default to en-US
        update({ contentLocale: "en-US" }, { skipHistory: true });
      } else {
        const countryHint = resolveShipCountry(useShipCountryStore.getState());
        const detected = detectDefaultBookLanguage(policy, countryHint);
        update({ contentLocale: detected }, { skipHistory: true });
      }
    }
  }, [config.contentLocale, geoCountry, hasStory, policy, update]);

  // Group languages cleanly by primary code (en, es, fr, de, it, pt, nl, pl, tr)
  const groups = useMemo(() => {
    const map = new Map<string, LanguageGroup>();

    for (const lang of choices) {
      const key = lang.id.split("-")[0] ?? lang.id;
      const existing = map.get(key);
      const cleanEnglishName = lang.englishName.split(" (")[0] ?? lang.englishName;
      const hasDistinctEnglishName =
        cleanEnglishName.toLowerCase() !== lang.endonym.toLowerCase();

      if (!existing) {
        map.set(key, {
          key,
          endonym: lang.endonym,
          englishLabel: hasDistinctEnglishName ? cleanEnglishName : null,
          storyGreeting: lang.storyGreeting,
          singleFlag: lang.flag,
          variants: [lang],
        });
      } else {
        existing.variants.push(lang);
      }
    }

    return Array.from(map.values());
  }, [choices]);

  const activeGroupKey = current.id.split("-")[0] ?? current.id;

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;

    return groups.filter((g) => {
      if (
        g.endonym.toLowerCase().includes(q) ||
        (g.englishLabel && g.englishLabel.toLowerCase().includes(q)) ||
        g.storyGreeting.toLowerCase().includes(q)
      ) {
        return true;
      }
      return g.variants.some(
        (v) =>
          v.region.toLowerCase().includes(q) ||
          v.regionShort.toLowerCase().includes(q) ||
          v.id.toLowerCase().includes(q) ||
          v.tagline.toLowerCase().includes(q) ||
          v.englishName.toLowerCase().includes(q),
      );
    });
  }, [groups, query]);

  const handleSelectGroup = (group: LanguageGroup) => {
    // If the currently selected locale is already in this group, keep it
    if (group.variants.some((v) => v.id === current.id)) {
      return;
    }
    // Otherwise pick the preferred variant (e.g. en-US for English, fr-FR for French, es-ES for Spanish)
    const preferred =
      group.variants.find((v) => v.id === `${group.key}-${group.key.toUpperCase()}`) ??
      group.variants[0];
    if (preferred) {
      update({ contentLocale: preferred.id });
    }
  };

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show" className="space-y-4">
      {/* Informative notice when changing language for an existing story */}
      {hasStory && languageChanged && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3 text-xs text-amber-900 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-base select-none shrink-0">✨</span>
            <div className="min-w-0">
              <span className="font-semibold">
                Language set to {current.endonym} ({current.regionShort})
              </span>
              <p className="text-[11px] text-amber-800/90 truncate">
                Your story is in {getBookLanguage(originLocale).endonym}. You can translate it in the Story step.
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-flex shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-[10px] text-amber-800">
            Translate next ➔
          </span>
        </div>
      )}

      {/* Clean minimal Search Bar */}
      <div className="relative w-full">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
        <input
          data-native-undo
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search language or country (e.g. English, United Kingdom, Español)…"
          className="h-10 w-full rounded-2xl border border-ink-200/80 bg-white/90 pl-10 pr-9 text-xs text-ink-800 placeholder:text-ink-400 shadow-2xs focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Clean Modern Language Grid */}
      <AnimatePresence mode="popLayout">
        {filteredGroups.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredGroups.map((group, i) => {
              const isSelected = activeGroupKey === group.key;
              const hasMultipleVariants = group.variants.length > 1;
              const singleVariant = !hasMultipleVariants ? group.variants[0] : null;

              return (
                <motion.div
                  key={group.key}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ ...spring, delay: i * 0.015 }}
                  onClick={() => handleSelectGroup(group)}
                  className={cn(
                    "group relative flex flex-col justify-between rounded-2xl p-3.5 text-left cursor-pointer transition-all duration-150",
                    isSelected
                      ? "bg-white ring-2 ring-brand-500 shadow-soft"
                      : "bg-white/85 ring-1 ring-ink-100 hover:bg-white hover:ring-brand-300 hover:shadow-2xs",
                  )}
                >
                  {/* Top Header Row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {/* Single country flag for 1-country languages */}
                        {singleVariant && (
                          <span className="text-base select-none shrink-0 leading-none mr-0.5">
                            {singleVariant.flag}
                          </span>
                        )}
                        <span className="font-display text-sm font-bold tracking-tight text-ink-900">
                          {group.endonym}
                        </span>
                        {group.englishLabel && (
                          <span className="text-xs text-ink-400 font-normal">
                            ({group.englishLabel})
                          </span>
                        )}
                      </div>

                      <p className="mt-0.5 truncate font-serif text-xs italic text-ink-500">
                        &ldquo;{group.storyGreeting}&rdquo;
                      </p>
                    </div>

                    {/* Radio / Check Badge */}
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border transition",
                        isSelected
                          ? "border-brand-500 bg-brand-500 text-white shadow-2xs"
                          : "border-ink-200 bg-ink-50/60 text-transparent group-hover:border-brand-300",
                      )}
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  </div>

                  {/* Multi-country inline selector */}
                  {hasMultipleVariants && (
                    <div className="mt-2.5 pt-2 border-t border-ink-100/70">
                      {isSelected ? (
                        <div className="space-y-1.5">
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                            Spelling & country
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {group.variants.map((variant) => {
                              const isVariantActive = variant.id === current.id;
                              return (
                                <button
                                  key={variant.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    update({ contentLocale: variant.id });
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition",
                                    isVariantActive
                                      ? "bg-brand-600 text-white shadow-2xs font-semibold"
                                      : "bg-ink-50 text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                                  )}
                                >
                                  <span className="text-xs select-none">{variant.flag}</span>
                                  <span>{variant.region}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] text-ink-400 font-medium truncate">
                          <span>{group.variants.map((v) => v.regionShort).join(" · ")}</span>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-white/50 p-6 text-center">
            <Globe2 className="size-7 text-ink-300" />
            <p className="mt-1.5 text-xs font-semibold text-ink-700">
              No languages match &ldquo;{query}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-2 rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-600 hover:bg-ink-200"
            >
              Clear search
            </button>
          </div>
        )}
      </AnimatePresence>

      {choices.length === 1 && BOOK_LANGUAGES.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-500">
          <Sparkles className="size-3 text-brand-500" />
          <span>More languages can be enabled by an administrator in Settings.</span>
        </div>
      )}
    </motion.div>
  );
}
