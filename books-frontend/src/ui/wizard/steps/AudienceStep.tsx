import { AGE_RANGES } from "../../../core/config/options";
import {
  ageBandHasReadingModes,
  defaultAgeCardDescription,
  type ReadingModeId,
} from "../../../core/config/ageWritingCatalog";
import { resolveAgeHumanGuidance } from "../../../core/prompts/age";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { OptionCard } from "../../components/OptionCard";
import { ReadingModePicker } from "../ReadingModePicker";
import type { StepProps } from "./types";

/**
 * "Who is it for?" — age range plus the reading-mode sub-question that only
 * applies to the older bands. Physical size & format now live in the Design
 * step (they don't affect anchors, screenplay pacing, or this question), so
 * this step stays focused on reading level.
 */
export function AudienceStep({ config, update }: StepProps) {
  const ageWriting = useAppConfigStore((s) => s.ageWriting);

  const showReadingModes = ageBandHasReadingModes(config.ageRangeId);
  const readingMode = (config.readingModeId ?? "read-aloud") as ReadingModeId;

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
    <div className="space-y-7">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {AGE_RANGES.map((age) => (
          <OptionCard
            key={age.id}
            selected={config.ageRangeId === age.id}
            onSelect={() => selectAge(age.id)}
            title={age.label}
            description={
              ageBandHasReadingModes(age.id) && config.ageRangeId === age.id
                ? resolveAgeHumanGuidance(age.id, readingMode, ageWriting)
                : resolveAgeHumanGuidance(age.id, null, ageWriting) || defaultAgeCardDescription(age)
            }
          />
        ))}
      </div>

      {showReadingModes && (
        <section>
          <h3 className="text-sm font-semibold text-ink-700">How will it be read?</h3>
          <p className="mt-1 text-xs text-ink-500">
            Toggle between use cases to see how wording and pacing change.
          </p>
          <div className="mt-3">
            <ReadingModePicker
              ageRangeId={config.ageRangeId}
              value={readingMode}
              onChange={(mode) => update({ readingModeId: mode })}
              ageWriting={ageWriting}
            />
          </div>
        </section>
      )}
    </div>
  );
}
