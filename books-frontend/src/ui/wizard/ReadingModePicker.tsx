import {
  READING_MODES,
  type ReadingModeId,
} from "../../core/config/ageWritingCatalog";
import type { AgeWritingConfig } from "../../core/config/ageWriting";
import { resolveAgeHumanGuidance } from "../../core/prompts/age";
import { ChoiceHint, SubChoice } from "./ChoiceSet";

/** Segmented control + one-line preview for 6–8 / 9–12 reading modes. */
export function ReadingModePicker({
  ageRangeId,
  value,
  onChange,
  ageWriting,
}: {
  ageRangeId: string;
  value: ReadingModeId;
  onChange: (mode: ReadingModeId) => void;
  ageWriting: AgeWritingConfig;
}) {
  const human = resolveAgeHumanGuidance(ageRangeId, value, ageWriting);

  return (
    <div className="space-y-3">
      <SubChoice
        label="How will they read?"
        value={value}
        onChange={(id) => onChange(id as ReadingModeId)}
        options={READING_MODES.map((mode) => ({
          id: mode.id,
          label: mode.shortLabel,
        }))}
      />
      <ChoiceHint>{human}</ChoiceHint>
    </div>
  );
}
