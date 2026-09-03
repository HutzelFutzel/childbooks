"use client";

import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { AGE_RANGES } from "../../../core/config/options";
import {
  detectDefaultBookLanguage,
  enabledBookLanguages,
  getBookLanguage,
  type BookLanguageDefinition,
  type BookLanguageId,
} from "../../../core/config/bookLanguages";
import {
  ageBandHasReadingModes,
  type ReadingModeId,
} from "../../../core/config/ageWritingCatalog";
import { ageBandLabel } from "../../../core/config/storyCraftCatalog";
import { resolveStoryCraft } from "../../../core/config/storyCraft";
import { resolveAgeHumanGuidance } from "../../../core/prompts/age";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { resolveShipCountry, useShipCountryStore } from "../../../state/shipCountryStore";
import { fadeRise } from "../../lib/motion";
import {
  ChoiceGrid,
  ChoiceHint,
  ChoiceSection,
  ChoiceTile,
  StepNote,
  SubChoice,
} from "../ChoiceSet";
import { ReadingModePicker } from "../ReadingModePicker";
import { AgeFitCheck } from "../../studio/story/AgeFitCheck";
import type { StepProps } from "./types";

/** Publishing-floor labels — one beat of context, not a mood line. */
const AGE_CAPTION: Record<string, string> = {
  "0-2": "First books",
  "3-5": "Picture books",
  "6-8": "Early readers",
  "9-12": "Chapter books",
};

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

function groupLanguages(choices: BookLanguageDefinition[]): LanguageGroup[] {
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
}

export function ReaderStep({ config, update }: StepProps) {
  const policy = useAppConfigStore((state) => state.bookLanguages);
  const ageWriting = useAppConfigStore((s) => s.ageWriting);
  const storyCraft = useAppConfigStore((s) => s.storyCraft);
  const craft = useMemo(
    () => resolveStoryCraft(config.ageRangeId, storyCraft),
    [config.ageRangeId, storyCraft],
  );

  const current = getBookLanguage(config.contentLocale);
  const enabled = enabledBookLanguages(policy);
  const choices = enabled.some((language) => language.id === current.id)
    ? enabled
    : [current, ...enabled];

  const hasStory = config.storyText.trim().length > 0;
  const currentLocale: BookLanguageId =
    (config.contentLocale as BookLanguageId) ?? "en-US";
  const knownOriginLocale =
    config.storyBrief?.generatedForLocale as BookLanguageId | undefined;
  const originLocale = knownOriginLocale ?? currentLocale;
  const languageChanged =
    hasStory && Boolean(knownOriginLocale) && originLocale !== currentLocale;

  const originAge = config.storyBrief?.generatedForAge;
  const ageChanged = hasStory && Boolean(originAge) && originAge !== config.ageRangeId;

  const showReadingModes = ageBandHasReadingModes(config.ageRangeId);
  const readingMode = (config.readingModeId ?? "read-aloud") as ReadingModeId;
  const guidance = resolveAgeHumanGuidance(
    config.ageRangeId,
    showReadingModes ? readingMode : null,
    ageWriting,
  );

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

  const groups = useMemo(() => groupLanguages(choices), [choices]);
  const activeGroup = groups.find((g) => g.variants.some((v) => v.id === current.id));
  const hasVariants = (activeGroup?.variants.length ?? 0) > 1;

  const handleSelectGroup = (group: LanguageGroup) => {
    if (group.variants.some((v) => v.id === current.id)) return;
    update({ contentLocale: preferredVariant(group).id });
  };

  const selectAge = (ageId: string) => {
    if (ageBandHasReadingModes(ageId)) {
      update({
        ageRangeId: ageId,
        readingModeId: config.readingModeId ?? "read-aloud",
      });
    } else {
      update({ ageRangeId: ageId, readingModeId: null });
    }
  };

  const adaptNote = adaptCopy({
    languageChanged,
    ageChanged,
    originLocale,
    originAge,
  });

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show" className="space-y-6">
      {adaptNote && <StepNote>{adaptNote}</StepNote>}

      <div className="grid items-start gap-8 md:grid-cols-2">
        <ChoiceSection label="Age">
          <ChoiceGrid aria-label="Reader age" columns={2}>
            {AGE_RANGES.map((age) => (
              <ChoiceTile
                key={age.id}
                selected={config.ageRangeId === age.id}
                onSelect={() => selectAge(age.id)}
                title={age.label}
                caption={AGE_CAPTION[age.id]}
              />
            ))}
          </ChoiceGrid>
          {showReadingModes ? (
            <motion.div
              key={config.ageRangeId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <ReadingModePicker
                ageRangeId={config.ageRangeId}
                value={readingMode}
                onChange={(mode) => update({ readingModeId: mode })}
                ageWriting={ageWriting}
              />
            </motion.div>
          ) : (
            <ChoiceHint>{guidance}</ChoiceHint>
          )}
        </ChoiceSection>

        <ChoiceSection label="Language">
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
        </ChoiceSection>
      </div>

      {hasStory && (
        <section className="border-t border-ink-100 pt-5">
          <h3 className="mb-2 text-sm font-semibold text-ink-800">Story & reader fit</h3>
          <AgeFitCheck
            storyText={config.storyText}
            ageRangeId={config.ageRangeId}
            craft={craft}
          />
        </section>
      )}
    </motion.div>
  );
}

function adaptCopy({
  languageChanged,
  ageChanged,
  originLocale,
  originAge,
}: {
  languageChanged: boolean;
  ageChanged: boolean;
  originLocale: BookLanguageId;
  originAge: string | undefined;
}): string | null {
  if (languageChanged && ageChanged && originAge) {
    return `This story was written in ${getBookLanguage(originLocale).endonym} for ${ageBandLabel(originAge)}. You can adapt it in the Story step.`;
  }
  if (languageChanged) {
    return `This story was written in ${getBookLanguage(originLocale).endonym}. You can translate it in the Story step.`;
  }
  if (ageChanged && originAge) {
    return `Originally written for ${ageBandLabel(originAge)}. You can adapt it in the Story step.`;
  }
  return null;
}
