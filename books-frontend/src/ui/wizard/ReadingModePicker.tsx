import { READING_MODES, readingModeLabel, type ReadingModeId } from "../../core/config/ageWritingCatalog";
import type { AgeWritingConfig } from "../../core/config/ageWriting";
import { resolveAgeHumanGuidance } from "../../core/prompts/age";
import { Tabs } from "../components/Tabs";

/** Segmented control + preview for 6–8 / 9–12 reading modes. */
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
      <Tabs
        fullWidth
        items={READING_MODES.map((m) => ({ id: m.id, label: m.shortLabel }))}
        value={value}
        onChange={(id) => onChange(id as ReadingModeId)}
      />
      <div
        key={value}
        className="rounded-2xl border border-brand-200/80 bg-brand-50/50 p-4 transition-colors"
      >
        <p className="text-xs font-semibold text-brand-800">{readingModeLabel(value)}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{human}</p>
      </div>
    </div>
  );
}
