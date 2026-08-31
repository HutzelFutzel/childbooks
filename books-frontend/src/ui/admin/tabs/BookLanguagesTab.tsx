"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Globe2,
  Languages,
  RotateCcw,
  Search,
  Sparkles,
  Type,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  BOOK_LANGUAGES,
  createDefaultBookLanguagesConfig,
  isBookLanguageEnabled,
  type BookLanguageDefinition,
  type BookLanguageOverride,
  type BookLanguagesConfig,
} from "../../../core/config/bookLanguages";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field } from "../../components/Input";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import {
  CATEGORY_LABEL,
  FONT_CATEGORY_ORDER,
  FONTS,
  fontStack,
  fontSupportsBookLanguage,
  getFont,
  loadFont,
} from "../../typography/fonts";
import { cn } from "../../lib/cn";
import { TabIntro } from "./products/parts";

type FilterStatus = "all" | "offered" | "disabled" | "extended-latin";

export function BookLanguagesTab() {
  const stored = useAppConfigStore((state) => state.bookLanguages);
  const save = useAppConfigStore((state) => state.saveBookLanguages);
  const [draft, setDraft] = useState<BookLanguagesConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string>("en-US");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [dirty, stored]);

  const enabledCount = BOOK_LANGUAGES.filter((language) =>
    isBookLanguageEnabled(language.id, draft),
  ).length;

  const extendedLatinCount = BOOK_LANGUAGES.filter(
    (l) => l.fontProfile === "extended-latin",
  ).length;

  const invalid = BOOK_LANGUAGES.some((language) => {
    if (!isBookLanguageEnabled(language.id, draft)) return false;
    const override = draft.overrides[language.id];
    return override?.fontIds !== undefined && override.fontIds.length === 0;
  });

  const filteredLanguages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return BOOK_LANGUAGES.filter((lang) => {
      const isEnabled = isBookLanguageEnabled(lang.id, draft);
      if (statusFilter === "offered" && !isEnabled) return false;
      if (statusFilter === "disabled" && isEnabled) return false;
      if (statusFilter === "extended-latin" && lang.fontProfile !== "extended-latin") return false;

      if (!q) return true;
      return (
        lang.englishName.toLowerCase().includes(q) ||
        lang.endonym.toLowerCase().includes(q) ||
        lang.region.toLowerCase().includes(q) ||
        lang.id.toLowerCase().includes(q) ||
        lang.tagline.toLowerCase().includes(q)
      );
    });
  }, [draft, searchQuery, statusFilter]);

  const setOverride = (
    language: BookLanguageDefinition,
    patch: Partial<BookLanguageOverride>,
  ) => {
    setDraft((current) => ({
      version: 1,
      overrides: {
        ...current.overrides,
        [language.id]: { ...current.overrides[language.id], ...patch },
      },
    }));
    setDirty(true);
  };

  const handleBulkEnable = (predicate: (l: BookLanguageDefinition) => boolean) => {
    setDraft((current) => {
      const nextOverrides = { ...current.overrides };
      for (const lang of BOOK_LANGUAGES) {
        if (predicate(lang)) {
          nextOverrides[lang.id] = { ...nextOverrides[lang.id], enabled: true };
        }
      }
      return { version: 1, overrides: nextOverrides };
    });
    setDirty(true);
    toast.success("Bulk update applied.");
  };

  const handleBulkDisable = () => {
    setDraft((current) => {
      const nextOverrides = { ...current.overrides };
      for (const lang of BOOK_LANGUAGES) {
        nextOverrides[lang.id] = { ...nextOverrides[lang.id], enabled: false };
      }
      return { version: 1, overrides: nextOverrides };
    });
    setDirty(true);
    toast.success("All languages disabled.");
  };

  const onSave = async () => {
    if (invalid) {
      toast.error("Every enabled language needs at least one offered font.");
      return;
    }
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Book languages configuration saved successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save book languages.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <TabIntro
        elsewhere={
          <>
            Website translation and SEO locales are separate. Typography controls point sizes;
            this page controls which writing languages and compatible fonts Studio offers.
          </>
        }
      >
        Enable the languages readers can create books in. Each language is code-certified for
        generation and character coverage before it appears here.
      </TabIntro>

      {/* Overview Metric Banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-100">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Offered in Studio
          </span>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight text-ink-900">
            {enabledCount}{" "}
            <span className="text-sm font-normal text-ink-400">/ {BOOK_LANGUAGES.length}</span>
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-100">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Extended Latin
          </span>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight text-brand-600">
            {extendedLatinCount} <span className="text-xs font-normal text-ink-400">languages</span>
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-100">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Certified Fonts
          </span>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight text-ink-900">
            {FONTS.length} <span className="text-xs font-normal text-ink-400">faces</span>
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-soft ring-1 ring-ink-100">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Status
          </span>
          <p className="mt-1 font-display text-base font-bold tracking-tight">
            {dirty ? (
              <span className="inline-flex items-center gap-1.5 text-amber-600">
                <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                Unsaved edits
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-600">
                <span className="size-2 rounded-full bg-emerald-500" />
                Live synced
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Control Bar: Filters, search, bulk actions & save */}
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-soft ring-1 ring-ink-100 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter Pills */}
          <div className="flex items-center rounded-xl bg-ink-100/70 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={cn(
                "rounded-lg px-2.5 py-1 transition",
                statusFilter === "all" ? "bg-white text-ink-900 shadow-xs" : "text-ink-600 hover:text-ink-900",
              )}
            >
              All ({BOOK_LANGUAGES.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("offered")}
              className={cn(
                "rounded-lg px-2.5 py-1 transition",
                statusFilter === "offered" ? "bg-white text-emerald-700 shadow-xs" : "text-ink-600 hover:text-ink-900",
              )}
            >
              Offered ({enabledCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("disabled")}
              className={cn(
                "rounded-lg px-2.5 py-1 transition",
                statusFilter === "disabled" ? "bg-white text-ink-900 shadow-xs" : "text-ink-600 hover:text-ink-900",
              )}
            >
              Disabled ({BOOK_LANGUAGES.length - enabledCount})
            </button>
          </div>

          {/* Quick Search */}
          <div className="relative min-w-44">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search language or code…"
              className="h-8 w-full rounded-xl border border-ink-200/80 bg-white pl-8 pr-7 text-xs text-ink-800 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 border-r border-ink-100 pr-2">
            <button
              type="button"
              onClick={() => handleBulkEnable(() => true)}
              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-ink-600 hover:bg-ink-100 transition"
            >
              Enable all
            </button>
            <button
              type="button"
              onClick={() => handleBulkEnable((l) => l.fontProfile === "western-latin")}
              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-ink-600 hover:bg-ink-100 transition"
            >
              Enable Western
            </button>
            <button
              type="button"
              onClick={handleBulkDisable}
              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-ink-600 hover:bg-ink-100 transition"
            >
              Disable all
            </button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            leftIcon={<RotateCcw className="size-3.5" />}
            onClick={() => {
              setDraft(createDefaultBookLanguagesConfig());
              setDirty(true);
            }}
          >
            Reset
          </Button>

          <Button
            size="sm"
            disabled={!dirty || invalid}
            loading={saving}
            onClick={() => void onSave()}
          >
            Save changes
          </Button>
        </div>
      </div>

      {/* Language List */}
      <div className="space-y-3">
        {filteredLanguages.length > 0 ? (
          filteredLanguages.map((language) => (
            <LanguageCard
              key={language.id}
              language={language}
              config={draft}
              open={openId === language.id}
              onOpen={() => setOpenId((current) => (current === language.id ? "" : language.id))}
              onChange={(patch) => setOverride(language, patch)}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center">
            <Globe2 className="size-8 text-ink-300" />
            <p className="mt-2 text-sm font-semibold text-ink-700">No languages match the filter</p>
            <p className="mt-0.5 text-xs text-ink-400">Clear your search query or change filter tabs.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LanguageCard({
  language,
  config,
  open,
  onOpen,
  onChange,
}: {
  language: BookLanguageDefinition;
  config: BookLanguagesConfig;
  open: boolean;
  onOpen: () => void;
  onChange: (patch: Partial<BookLanguageOverride>) => void;
}) {
  const override = config.overrides[language.id] ?? {};
  const enabled = isBookLanguageEnabled(language.id, config);
  const certified = useMemo(
    () => FONTS.filter((font) => fontSupportsBookLanguage(font, language.id)),
    [language.id],
  );
  const offeredIds = override.fontIds ?? certified.map((font) => font.id);
  const offered = new Set(offeredIds);
  const fontOptions = certified
    .filter((font) => offered.has(font.id))
    .map((font) => ({ value: font.id, label: font.label }));

  const defaultBodyFont = getFont(override.defaultBodyFontId ?? "");
  const defaultTitleFont = getFont(override.defaultTitleFontId ?? "");

  // Load preview fonts when accordion is open
  useEffect(() => {
    if (open) {
      if (defaultBodyFont) loadFont(defaultBodyFont.id);
      if (defaultTitleFont) loadFont(defaultTitleFont.id);
    }
  }, [defaultBodyFont, defaultTitleFont, open]);

  const [fontSearch, setFontSearch] = useState("");

  const toggleFont = (fontId: string) => {
    const next = offered.has(fontId)
      ? offeredIds.filter((id) => id !== fontId)
      : [...offeredIds, fontId];
    const patch: Partial<BookLanguageOverride> = { fontIds: next };
    if (override.defaultBodyFontId === fontId && !next.includes(fontId)) {
      patch.defaultBodyFontId = undefined;
    }
    if (override.defaultTitleFontId === fontId && !next.includes(fontId)) {
      patch.defaultTitleFontId = undefined;
    }
    onChange(patch);
  };

  const filteredCertified = useMemo(() => {
    const q = fontSearch.trim().toLowerCase();
    if (!q) return certified;
    return certified.filter(
      (f) =>
        f.label.toLowerCase().includes(q) ||
        CATEGORY_LABEL[f.category].toLowerCase().includes(q),
    );
  }, [certified, fontSearch]);

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl bg-white shadow-soft ring-1 transition",
        enabled ? "ring-ink-100" : "ring-ink-100 bg-ink-50/40 opacity-75",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
        >
          <span className="text-2xl select-none">{language.flag}</span>
          <div className="flex min-w-32 items-baseline gap-2">
            <span className="font-display text-xl font-bold tracking-tight text-ink-900">
              {language.endonym}
            </span>
            <span className="rounded bg-ink-100/80 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 font-semibold">
              {language.id}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-ink-800">
                {language.englishName}
              </span>
              <span className="text-xs text-ink-400">• {language.region}</span>
              {language.fontProfile === "extended-latin" && (
                <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 ring-1 ring-purple-200/60">
                  Extended Latin
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-ink-400 truncate">
              {language.tagline} · {offered.size} fonts offered
            </p>
          </div>

          <ChevronDown
            className={cn("size-4 text-ink-400 transition-transform duration-200", open && "rotate-180")}
          />
        </button>

        <div className="flex items-center gap-3 border-l border-ink-100 pl-3">
          <Toggle
            checked={enabled}
            onChange={(checked) => onChange({ enabled: checked })}
            label={`Offer ${language.englishName}`}
          />
        </div>
      </div>

      {open && (
        <div className="border-t border-ink-100 bg-linear-to-b from-ink-50/60 via-ink-50/20 to-white px-4 py-5 sm:px-6">
          {/* Top Row: Font Selectors + Live Typography Preview */}
          <div className="grid gap-5 lg:grid-cols-12">
            {/* Left Col: Default Font Settings */}
            <div className="space-y-4 lg:col-span-6">
              <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-100 space-y-3.5">
                <h4 className="flex items-center gap-2 font-display text-sm font-bold text-ink-900">
                  <Type className="size-4 text-brand-600" />
                  Default Font Pairings
                </h4>

                <Field
                  label="Default Body Font"
                  hint="Applied to story pages when generating a new design."
                >
                  <Select
                    value={override.defaultBodyFontId ?? ""}
                    onChange={(event) =>
                      onChange({ defaultBodyFontId: event.target.value || undefined })
                    }
                    options={[
                      { value: "", label: "Age-based standard default (Lora / Nunito)" },
                      ...fontOptions,
                    ]}
                  />
                </Field>

                <Field
                  label="Default Title Font"
                  hint="Suggested for front cover and prominent story headings."
                >
                  <Select
                    value={override.defaultTitleFontId ?? ""}
                    onChange={(event) =>
                      onChange({ defaultTitleFontId: event.target.value || undefined })
                    }
                    options={[
                      { value: "", label: "Standard title default" },
                      ...fontOptions,
                    ]}
                  />
                </Field>
              </div>

              {/* Prompt instruction snippet */}
              <div className="rounded-2xl bg-white p-4 ring-1 ring-ink-100">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                  Active AI Prompt Instruction
                </span>
                <p className="mt-1 text-xs leading-relaxed text-ink-700 italic">
                  &ldquo;{language.promptInstruction}&rdquo;
                </p>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-400">
                  <span>Target length calibration factor:</span>
                  <span className="font-mono font-semibold text-ink-700">
                    {language.wordCountFactor}×
                  </span>
                </div>
              </div>
            </div>

            {/* Right Col: Live Diacritics & Typography Preview Card */}
            <div className="space-y-4 lg:col-span-6">
              <div className="rounded-2xl bg-white p-4 ring-1 ring-brand-100 shadow-soft space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand-700">
                    <Sparkles className="size-3.5" />
                    Live Language Typography Preview
                  </h4>
                  <span className="font-mono text-[10px] text-ink-400">
                    {language.fontProfile}
                  </span>
                </div>

                {/* Sample Title Preview */}
                <div className="rounded-xl bg-ink-50/70 p-3 ring-1 ring-ink-100">
                  <span className="text-[10px] font-medium text-ink-400 uppercase">Cover Title ({defaultTitleFont?.label ?? "Default"})</span>
                  <p
                    style={{ fontFamily: defaultTitleFont ? fontStack(defaultTitleFont.family) : fontStack("Nunito") }}
                    className="mt-0.5 text-xl font-bold tracking-tight text-ink-900"
                  >
                    {language.storyGreeting}
                  </p>
                </div>

                {/* Sample Body Prose Preview */}
                <div className="rounded-xl bg-ink-50/70 p-3 ring-1 ring-ink-100">
                  <span className="text-[10px] font-medium text-ink-400 uppercase">Body Story Prose ({defaultBodyFont?.label ?? "Default"})</span>
                  <p
                    style={{ fontFamily: defaultBodyFont ? fontStack(defaultBodyFont.family) : fontStack("Lora") }}
                    className="mt-0.5 text-sm leading-relaxed text-ink-800"
                  >
                    {language.samplePhrase}
                  </p>
                </div>

                {/* Required Character Glyph Test Strip */}
                <div>
                  <span className="text-[10px] font-medium text-ink-400 uppercase">Certified Glyphs Coverage</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Array.from(new Set(language.requiredGlyphs)).map((glyph) => (
                      <span
                        key={glyph}
                        className="inline-flex size-6 items-center justify-center rounded bg-ink-100 font-serif text-xs font-semibold text-ink-800 ring-1 ring-ink-200/50"
                      >
                        {glyph}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Section: Font Offer Management Grid */}
          <div className="mt-6 border-t border-ink-100 pt-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="font-display text-sm font-bold text-ink-900">
                  Certified Fonts Offered in Design Editor
                </h4>
                <p className="text-xs text-ink-500">
                  {offered.size} of {certified.length} certified fonts enabled for {language.endonym}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative w-40">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-400" />
                  <input
                    type="text"
                    value={fontSearch}
                    onChange={(e) => setFontSearch(e.target.value)}
                    placeholder="Filter fonts…"
                    className="h-7 w-full rounded-lg border border-ink-200 bg-white pl-7 pr-2 text-xs text-ink-800 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => onChange({ fontIds: certified.map((font) => font.id) })}
                  className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-ink-600 ring-1 ring-ink-200 hover:ring-brand-300 transition"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ fontIds: [] })}
                  className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-ink-600 ring-1 ring-ink-200 hover:ring-brand-300 transition"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {FONT_CATEGORY_ORDER.map((category) => {
                const fonts = filteredCertified.filter((font) => font.category === category);
                if (fonts.length === 0) return null;
                return (
                  <div key={category}>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                      {CATEGORY_LABEL[category]} ({fonts.length})
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                      {fonts.map((font) => {
                        const selected = offered.has(font.id);
                        return (
                          <button
                            key={font.id}
                            type="button"
                            onClick={() => toggleFont(font.id)}
                            className={cn(
                              "flex items-center justify-between gap-1.5 rounded-xl px-3 py-2 text-left text-xs ring-1 transition",
                              selected
                                ? "bg-white font-semibold text-brand-800 ring-2 ring-brand-400 shadow-xs"
                                : "bg-ink-100/50 text-ink-500 ring-ink-200/60 hover:bg-white hover:text-ink-800",
                            )}
                          >
                            <span className="truncate">{font.label}</span>
                            <Check
                              className={cn(
                                "size-3.5 shrink-0 text-brand-600 transition",
                                !selected && "opacity-0",
                              )}
                              strokeWidth={3}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {enabled && offered.size === 0 && (
              <div className="mt-4 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                ⚠️ Select at least one font before saving this enabled language.
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
