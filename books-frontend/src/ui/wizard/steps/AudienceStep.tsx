"use client";

import { motion } from "framer-motion";
import { AGE_RANGES } from "../../../core/config/options";
import {
  ageBandHasReadingModes,
  type ReadingModeId,
} from "../../../core/config/ageWritingCatalog";
import { ageBandLabel } from "../../../core/config/storyCraftCatalog";
import { resolveAgeHumanGuidance } from "../../../core/prompts/age";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { fadeRise } from "../../lib/motion";
import { ChoiceGrid, ChoiceHint, ChoiceTile, StepNote } from "../ChoiceSet";
import { ReadingModePicker } from "../ReadingModePicker";
import type { StepProps } from "./types";

/** Publishing-floor labels — one beat of context, not a mood line. */
const AGE_CAPTION: Record<string, string> = {
  "0-2": "First books",
  "3-5": "Picture books",
  "6-8": "Early readers",
  "9-12": "Chapter books",
};

export function AudienceStep({ config, update }: StepProps) {
  const ageWriting = useAppConfigStore((s) => s.ageWriting);

  const showReadingModes = ageBandHasReadingModes(config.ageRangeId);
  const readingMode = (config.readingModeId ?? "read-aloud") as ReadingModeId;

  const hasStory = config.storyText.trim().length > 0;
  const originAge = config.storyBrief?.generatedForAge ?? (hasStory ? "0-2" : undefined);
  const ageChanged = hasStory && Boolean(originAge) && originAge !== config.ageRangeId;

  const guidance = resolveAgeHumanGuidance(
    config.ageRangeId,
    showReadingModes ? readingMode : null,
    ageWriting,
  );

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

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show" className="space-y-5">
      {hasStory && ageChanged && (
        <StepNote>
          Originally written for {ageBandLabel(originAge!)}. You can adapt it in the Story
          step.
        </StepNote>
      )}

      <ChoiceGrid aria-label="Reader age" columns={2}>
        {AGE_RANGES.map((age) => (
          <ChoiceTile
            key={age.id}
            selected={config.ageRangeId === age.id}
            onSelect={() => selectAge(age.id)}
            title={age.label}
            caption={AGE_CAPTION[age.id]}
            size="lg"
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
    </motion.div>
  );
}
