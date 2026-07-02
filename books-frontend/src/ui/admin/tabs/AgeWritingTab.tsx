"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, RotateCcw } from "lucide-react";
import { AGE_RANGES } from "../../../core/config/options";
import {
  READING_MODES,
  ageBandHasReadingModes,
  type AgeBandId,
  type AgeBandWriting,
  type GuidancePair,
  type ReadingModeId,
} from "../../../core/config/ageWritingCatalog";
import {
  resolveAgeBandWriting,
  type AgeWritingConfig,
} from "../../../core/config/ageWriting";
import {
  resolveAgeHumanGuidance,
  resolveAgeLlmGuidance,
} from "../../../core/prompts/age";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Textarea } from "../../components/Input";
import { Section } from "./products/parts";

function GuidanceFields({
  label,
  pair,
  defaults,
  onChange,
}: {
  label: string;
  pair: GuidancePair;
  defaults: GuidancePair;
  onChange: (patch: Partial<GuidancePair>) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label={`${label} · Human guidance`} hint="Shown in the setup wizard when this option is selected.">
        <Textarea
          rows={3}
          value={pair.humanGuidance}
          placeholder={defaults.humanGuidance}
          onChange={(e) => onChange({ humanGuidance: e.target.value })}
          className="text-sm leading-relaxed"
        />
      </Field>
      <Field label={`${label} · LLM guidance`} hint="Injected into screenplay and story-analysis prompts.">
        <Textarea
          rows={5}
          value={pair.llmGuidance}
          placeholder={defaults.llmGuidance}
          onChange={(e) => onChange({ llmGuidance: e.target.value })}
          className="font-mono text-xs leading-relaxed"
        />
      </Field>
    </div>
  );
}

function BandEditor({
  ageId,
  draft,
  stored,
  onChange,
  onReset,
}: {
  ageId: AgeBandId;
  draft: AgeWritingConfig;
  stored: AgeWritingConfig;
  onChange: (band: AgeBandWriting | undefined) => void;
  onReset: () => void;
}) {
  const age = AGE_RANGES.find((a) => a.id === ageId)!;
  const defaults = resolveAgeBandWriting(ageId, null);
  const effective = resolveAgeBandWriting(ageId, draft);
  const hasOverride = Boolean(stored.bands[ageId]);
  const hasModes = ageBandHasReadingModes(ageId);

  const setGuidance = (patch: Partial<GuidancePair>) => {
    const current = draft.bands[ageId] ?? {};
    onChange({
      ...current,
      guidance: {
        humanGuidance: patch.humanGuidance ?? current.guidance?.humanGuidance ?? effective.guidance?.humanGuidance ?? "",
        llmGuidance: patch.llmGuidance ?? current.guidance?.llmGuidance ?? effective.guidance?.llmGuidance ?? "",
      },
    });
  };

  const setMode = (modeId: ReadingModeId, patch: Partial<GuidancePair>) => {
    const current = draft.bands[ageId] ?? {};
    const prev = current.readingModes?.[modeId] ?? effective.readingModes?.[modeId] ?? defaults.readingModes?.[modeId];
    onChange({
      ...current,
      readingModes: {
        ...current.readingModes,
        [modeId]: {
          humanGuidance: patch.humanGuidance ?? prev?.humanGuidance ?? "",
          llmGuidance: patch.llmGuidance ?? prev?.llmGuidance ?? "",
        },
      },
    });
  };

  return (
    <Section
      title={age.label}
      hint={age.description}
      action={
        hasOverride ? (
          <Button variant="ghost" size="sm" leftIcon={<RotateCcw className="size-3.5" />} onClick={onReset}>
            Reset band
          </Button>
        ) : undefined
      }
    >
      {!hasModes && effective.guidance && (
        <GuidanceFields
          label="Default"
          pair={effective.guidance}
          defaults={defaults.guidance!}
          onChange={setGuidance}
        />
      )}

      {hasModes && (
        <div className="space-y-4">
          {READING_MODES.map((mode) => {
            const pair = effective.readingModes?.[mode.id] ?? defaults.readingModes?.[mode.id]!;
            const modeDefaults = defaults.readingModes?.[mode.id]!;
            return (
              <div key={mode.id} className="rounded-lg bg-white/70 p-3 ring-1 ring-inset ring-ink-100">
                <p className="mb-3 text-xs font-semibold text-ink-700">{mode.label}</p>
                <GuidanceFields
                  label={mode.label}
                  pair={pair}
                  defaults={modeDefaults}
                  onChange={(patch) => setMode(mode.id, patch)}
                />
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export function AgeWritingTab() {
  const stored = useAppConfigStore((s) => s.ageWriting);
  const save = useAppConfigStore((s) => s.saveAgeWriting);

  const [draft, setDraft] = useState<AgeWritingConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Age writing settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const preview = useMemo(
    () =>
      AGE_RANGES.map((age) => ({
        id: age.id,
        llm: resolveAgeLlmGuidance(age.id, "read-aloud", draft),
        human: resolveAgeHumanGuidance(age.id, "read-aloud", draft),
      })),
    [draft],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Human guidance appears in the story setup wizard; LLM guidance is injected when
          generating screenplays and analyzing stories. Ages 6–8 and 9–12 include three
          reading modes. Empty fields fall back to built-in defaults until you save
          overrides here.
        </p>
        <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
          Save changes
        </Button>
      </div>

      <div className="space-y-3">
        {AGE_RANGES.map((age) => (
          <BandEditor
            key={age.id}
            ageId={age.id as AgeBandId}
            draft={draft}
            stored={stored}
            onChange={(band) => {
              setDraft((d) => {
                const bands = { ...d.bands };
                if (band) bands[age.id as AgeBandId] = band;
                else delete bands[age.id as AgeBandId];
                return { ...d, bands };
              });
              setDirty(true);
            }}
            onReset={() => {
              setDraft((d) => {
                const bands = { ...d.bands };
                delete bands[age.id as AgeBandId];
                return { ...d, bands };
              });
              setDirty(true);
            }}
          />
        ))}
      </div>

      <details className="rounded-lg ring-1 ring-inset ring-ink-100">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          <ChevronDown className="size-3.5" />
          Resolved preview (read-aloud mode for 6+)
        </summary>
        <div className="space-y-2 border-t border-ink-100 p-3 text-[11px] text-ink-500">
          {preview.map((p) => (
            <div key={p.id}>
              <span className="font-semibold text-ink-700">{p.id}:</span> {p.llm.slice(0, 100)}…
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
