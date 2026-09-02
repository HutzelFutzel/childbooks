"use client";

import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
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
import { fadeRise } from "../../lib/motion";
import { ChoiceGrid, ChoiceTile, StepNote, SubChoice } from "../ChoiceSet";
import type { StepProps } from "./types";

interface LanguageGroup {
  key: string;
  endonym: string;
  englishLabel: string | null;
  variants: BookLanguageDefinition[];
}

function preferredVariant(group: LanguageGroup): BookLanguageDefinition {
  return (
    group.variants.find((v) => v.id === `${group.key}-${group.key.toUpperCase()}`) ??
    group.variants[0]!
  );
}

export function LanguageStep({ config, update }: StepProps) {
  const policy = useAppConfigStore((state) => state.bookLanguages);
  const current = getBookLanguage(config.contentLocale);
  const enabled = enabledBookLanguages(policy);
  const choices = enabled.some((language) => language.id === current.id)
    ? enabled
    : [current, ...enabled];

  const hasStory = config.storyText.trim().length > 0;
  const originLocale: BookLanguageId =
    (config.storyBrief?.generatedForLocale as BookLanguageId) ?? "en-US";
  const currentLocale: BookLanguageId =
    (config.contentLocale as BookLanguageId) ?? "en-US";
  const languageChanged = hasStory && originLocale !== currentLocale;

  const geoCountry = useShipCountryStore((s) => s.detected);
  useEffect(() => {
    useShipCountryStore.getState().hydrate();
    void useShipCountryStore.getState().detect();
  }, []);

  useEffect(() => {
    if (!config.contentLocale) {
      if (hasStory) {
        update({ contentLocale: "en-US" }, { skipHistory: true });
      } else {
        const countryHint = resolveShipCountry(useShipCountryStore.getState());
        const detected = detectDefaultBookLanguage(policy, countryHint);
        update({ contentLocale: detected }, { skipHistory: true });
      }
    }
  }, [config.contentLocale, geoCountry, hasStory, policy, update]);

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
          variants: [lang],
        });
      } else {
        existing.variants.push(lang);
      }
    }

    return Array.from(map.values());
  }, [choices]);

  const activeGroup = groups.find((g) => g.variants.some((v) => v.id === current.id));
  const hasVariants = (activeGroup?.variants.length ?? 0) > 1;

  const handleSelectGroup = (group: LanguageGroup) => {
    if (group.variants.some((v) => v.id === current.id)) return;
    update({ contentLocale: preferredVariant(group).id });
  };

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show" className="space-y-5">
      {hasStory && languageChanged && (
        <StepNote>
          This story was written in {getBookLanguage(originLocale).endonym}. You can
          translate it in the Story step.
        </StepNote>
      )}

      <ChoiceGrid aria-label="Story language" columns={3}>
        {groups.map((group) => (
          <ChoiceTile
            key={group.key}
            selected={activeGroup?.key === group.key}
            onSelect={() => handleSelectGroup(group)}
            title={group.endonym}
            caption={group.englishLabel ?? undefined}
          />
        ))}
      </ChoiceGrid>

      {activeGroup && hasVariants && (
        <motion.div
          key={activeGroup.key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <SubChoice
            label={`Which ${activeGroup.englishLabel ?? activeGroup.endonym}?`}
            value={current.id}
            onChange={(id) => update({ contentLocale: id as BookLanguageId })}
            options={activeGroup.variants.map((variant) => ({
              id: variant.id,
              label: variant.region,
              leading: variant.flag,
            }))}
          />
        </motion.div>
      )}

      {choices.length === 1 && BOOK_LANGUAGES.length > 1 && (
        <p className="text-xs text-ink-400">
          More languages can be enabled by an administrator in Settings.
        </p>
      )}
    </motion.div>
  );
}
