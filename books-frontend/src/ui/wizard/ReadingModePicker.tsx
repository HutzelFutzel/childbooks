import { READING_MODES, type ReadingModeId } from "../../core/config/readingModes";
import type { AudienceProfile } from "../../core/config/audienceCatalog";
import { resolveModeGuidance } from "../../core/config/audience";
import { ChoiceHint, SubChoice } from "./ChoiceSet";

/**
 * Segmented control plus a one-line preview, for bands that ask how the book
 * will be read. Which modes appear comes from the band, not from a hardcoded
 * pair of ids.
 */
export function ReadingModePicker({
  profile,
  value,
  onChange,
}: {
  profile: AudienceProfile;
  value: ReadingModeId;
  onChange: (mode: ReadingModeId) => void;
}) {
  const options = READING_MODES.filter((m) => profile.readingModes.includes(m.id));
  if (options.length === 0) return null;

  return (
    <div className="space-y-3">
      <SubChoice
        label="How will they read?"
        value={value}
        onChange={(id) => onChange(id as ReadingModeId)}
        options={options.map((mode) => ({ id: mode.id, label: mode.shortLabel }))}
      />
      <ChoiceHint>{resolveModeGuidance(profile, value).humanGuidance}</ChoiceHint>
    </div>
  );
}
