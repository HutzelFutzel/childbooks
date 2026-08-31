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

export function LanguageStep({ config, update }: StepProps) {
  const policy = useAppConfigStore((state) => state.bookLanguages);
  const current = getBookLanguage(config.contentLocale);
  const enabled = enabledBookLanguages(policy);
  const choices = enabled.some((language) => language.id === current.id)
    ? enabled
    : [current, ...enabled];

  const [query, setQuery] = useState("");

  const hasStory = config.storyText.trim().length > 0;
  const originLocale: BookLanguageId = (config.storyBrief?.generatedForLocale as BookLanguageId) ?? "en-US";
  const currentLocale: BookLanguageId = (config.contentLocale as BookLanguageId) ?? "en-US";
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
        update({ contentLocale: "en-US" });
      } else {
        const countryHint = resolveShipCountry(useShipCountryStore.getState());
        const detected = detectDefaultBookLanguage(policy, countryHint);
        update({ contentLocale: detected });
      }
    }
  }, [config.contentLocale, geoCountry, hasStory, policy, update]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return choices;
    return choices.filter((lang) => {
      return (
        lang.englishName.toLowerCase().includes(q) ||
        lang.endonym.toLowerCase().includes(q) ||
        lang.region.toLowerCase().includes(q) ||
        lang.regionShort.toLowerCase().includes(q) ||
        lang.id.toLowerCase().includes(q) ||
        lang.storyGreeting.toLowerCase().includes(q)
      );
    });
  }, [choices, query]);

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show" className="space-y-3.5">
      {/* Informative notice when changing language for an existing story */}
      {hasStory && languageChanged && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200/80 bg-linear-to-r from-amber-50/90 via-amber-50/50 to-white p-3 text-xs text-amber-900 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-base select-none shrink-0">✨</span>
            <div className="min-w-0">
              <span className="font-semibold">
                Language changed to {current.endonym} ({current.regionShort})
              </span>
              <p className="text-[11px] text-amber-700/90 truncate">
                Your current story is written in {getBookLanguage(originLocale).endonym}. You can translate it in the Story step.
              </p>
            </div>
          </div>
          <span className="hidden sm:inline-flex shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-[10px] text-amber-800">
            Translate next ➔
          </span>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by language, country, or code (e.g. French, DE, Español)…"
          className="h-10 w-full rounded-2xl border border-ink-200/80 bg-white pl-9 pr-9 text-xs text-ink-800 placeholder:text-ink-400 shadow-2xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
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

      {/* High-density, flag-centered responsive card grid */}
      <AnimatePresence mode="popLayout">
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((language, i) => {
              const selected = language.id === current.id;
              const noLongerOffered = !enabled.some((item) => item.id === language.id);

              return (
                <motion.button
                  key={language.id}
                  type="button"
                  layout
                  onClick={() => update({ contentLocale: language.id as BookLanguageId })}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ ...spring, delay: i * 0.015 }}
                  whileHover={{ y: -1.5 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-2xl p-3 text-left shadow-2xs ring-1 transition",
                    selected
                      ? "bg-white ring-2 ring-brand-500 shadow-soft"
                      : "bg-white/90 ring-ink-100 hover:bg-white hover:ring-brand-300 hover:shadow-soft",
                  )}
                >
                  {/* Flag Icon Circle */}
                  <span
                    className={cn(
                      "flex size-11 shrink-0 select-none items-center justify-center rounded-xl text-2xl shadow-2xs ring-1 transition",
                      selected
                        ? "bg-brand-50/70 ring-brand-200/80"
                        : "bg-ink-50/80 ring-black/5 group-hover:scale-105",
                    )}
                  >
                    {language.flag}
                  </span>

                  {/* Language and Region Text */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate font-display text-sm font-bold tracking-tight text-ink-900">
                        {language.endonym}
                      </span>
                      <span className="truncate text-xs font-semibold text-ink-400">
                        ({language.regionShort})
                      </span>
                    </div>

                    <p className="truncate font-serif text-xs italic text-ink-500">
                      &ldquo;{language.storyGreeting}&rdquo;
                    </p>

                    {noLongerOffered && (
                      <span className="mt-0.5 block text-[10px] font-medium text-amber-700">
                        Existing book only
                      </span>
                    )}
                  </div>

                  {/* Radio / Check Badge */}
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border transition",
                      selected
                        ? "border-brand-500 bg-brand-500 text-white shadow-2xs"
                        : "border-ink-200 bg-ink-50/60 text-transparent group-hover:border-brand-300",
                    )}
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                </motion.button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-white/50 p-6 text-center">
            <Globe2 className="size-7 text-ink-300" />
            <p className="mt-1.5 text-xs font-semibold text-ink-700">No languages match &ldquo;{query}&rdquo;</p>
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
