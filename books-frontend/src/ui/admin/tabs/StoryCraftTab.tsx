"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GripVertical, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { AgeBandId } from "../../../core/config/ageWritingCatalog";
import { audienceProfiles } from "../../../core/config/audience";
import {
  defaultStoryCraft,
  hasDefaultStoryCraft,
  type AgeBandStoryCraft,
  type StoryOption,
} from "../../../core/config/storyCraftCatalog";
import {
  resolveStoryCraft,
  type AgeBandStoryCraftOverride,
  type StoryCraftConfig,
} from "../../../core/config/storyCraft";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { Section, TabIntro } from "./products/parts";
import { cn } from "../../lib/cn";

type ListKey = "themes" | "devices" | "settings";

const LIST_META: Record<ListKey, { title: string; hint: string }> = {
  themes: {
    title: "Themes",
    hint: "What a story can be about. Shown as chips in the Story step for this age band.",
  },
  devices: {
    title: "Stylistic devices",
    hint: "How a story is told — rhyme, a refrain, cliffhangers. Offered in every AI mode.",
  },
  settings: {
    title: "Settings",
    hint: "Where a story happens. Offered in the co-write mode.",
  },
};

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || `option-${Date.now().toString(36)}`
  );
}

function stabilizeNewOptionIds(options: StoryOption[]): StoryOption[] {
  const used = new Set<string>();
  return options.map((option) => {
    let id = option.id.startsWith("new-") && option.label.trim()
      ? slugify(option.label)
      : option.id;
    if (used.has(id) && option.id.startsWith("new-")) {
      const base = id;
      let suffix = 2;
      while (used.has(`${base}-${suffix}`)) suffix += 1;
      id = `${base}-${suffix}`;
    }
    used.add(id);
    return id === option.id ? option : { ...option, id };
  });
}

function pruneBlankOptions(config: StoryCraftConfig): StoryCraftConfig {
  const bands: StoryCraftConfig["bands"] = {};
  for (const [id, band] of Object.entries(config.bands)) {
    if (!band) continue;
    const cleaned = { ...band };
    for (const key of Object.keys(LIST_META) as ListKey[]) {
      if (cleaned[key]) cleaned[key] = cleaned[key]!.filter((o) => o.label.trim().length > 0);
    }
    bands[id as AgeBandId] = cleaned;
  }
  return { ...config, bands };
}

function OptionRow({
  option,
  onChange,
  onRemove,
}: {
  option: StoryOption;
  onChange: (patch: Partial<StoryOption>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-white/70 p-2.5 ring-1 ring-inset ring-ink-100">
      <div className="flex items-center gap-2">
        <GripVertical className="size-3.5 shrink-0 text-ink-300" aria-hidden />
        <Input
          value={option.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Chip label, e.g. A bedtime adventure"
          className="h-9 flex-1 text-sm"
          aria-label="Label"
        />
        <code className="hidden shrink-0 rounded bg-ink-100 px-1.5 py-1 text-[10px] text-ink-500 sm:block">
          {option.id}
        </code>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${option.label || "option"}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-400 transition hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <Input
        value={option.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="One line shown under the chip when it's picked"
        className="h-9 text-sm"
        aria-label="Description"
      />
      <Textarea
        rows={2}
        value={option.llmGuidance}
        onChange={(e) => onChange({ llmGuidance: e.target.value })}
        placeholder="What the model is told when this is chosen"
        className="font-mono text-xs leading-relaxed"
        aria-label="LLM guidance"
      />
    </div>
  );
}

function OptionListEditor({
  listKey,
  options,
  onChange,
}: {
  listKey: ListKey;
  options: StoryOption[];
  onChange: (options: StoryOption[]) => void;
}) {
  const meta = LIST_META[listKey];
  return (
    <Section title={`${meta.title} (${options.length})`} hint={meta.hint}>
      <div className="space-y-2">
        {options.map((option, i) => (
          <OptionRow
            key={option.id}
            option={option}
            onChange={(patch) =>
              onChange(options.map((o, j) => (i === j ? { ...o, ...patch } : o)))
            }
            onRemove={() => onChange(options.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<Plus className="size-3.5" />}
        onClick={() =>
          onChange([
            ...options,
            { id: `new-${Date.now().toString(36)}`, label: "", description: "", llmGuidance: "" },
          ])
        }
      >
        Add {meta.title.toLowerCase().replace(/s$/, "")}
      </Button>
    </Section>
  );
}

/**
 * Per-age-band story catalogs: what a reader can pick from in the Story step.
 *
 * Only the LISTS live here. Length, hero age, pacing and the safety list are
 * editorial guardrails and live with the age band, next to the rubric and the
 * page pacing they have to agree with — see the Age bands tab. Anything already
 * stored here under those headings is still honoured, underneath that editor.
 */
export function StoryCraftTab({
  embeddedBandId,
  embeddedBandLabel,
}: {
  embeddedBandId?: string;
  embeddedBandLabel?: string;
} = {}) {
  const stored = useAppConfigStore((s) => s.storyCraft);
  const audience = useAppConfigStore((s) => s.audience);
  const ageWriting = useAppConfigStore((s) => s.ageWriting);
  const save = useAppConfigStore((s) => s.saveStoryCraft);

  const [draft, setDraft] = useState<StoryCraftConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Story Craft is editable before a band is offered to customers. Do not use
  // enabledAudienceProfiles here: newly-created bands start hidden by design.
  const bands = useMemo(
    () => audienceProfiles({ audience, ageWriting }),
    [audience, ageWriting],
  );
  const [selectedBandId, setSelectedBandId] = useState<AgeBandId>(bands[0]?.id ?? "3-5");
  const bandId = (embeddedBandId ?? selectedBandId) as AgeBandId;
  const [copyFromId, setCopyFromId] = useState("");

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  useEffect(() => {
    if (embeddedBandId) return;
    if (bands.some((band) => band.id === bandId)) return;
    setSelectedBandId(bands[0]?.id ?? "3-5");
  }, [bandId, bands, embeddedBandId]);

  useEffect(() => {
    const firstOther = bands.find((band) => band.id !== bandId)?.id ?? "";
    setCopyFromId(firstOther);
  }, [bandId, bands]);

  const effective = useMemo(() => resolveStoryCraft(bandId, draft), [bandId, draft]);
  const hasOverride = Boolean(stored.bands[bandId]);
  const hasShippedDefault = hasDefaultStoryCraft(bandId);
  const isUnconfigured = !hasShippedDefault && !draft.bands[bandId];

  const patchBand = (patch: Partial<Pick<AgeBandStoryCraft, ListKey>>) => {
    setDraft((d) => {
      // Pin all three lists to what the admin sees, but do not copy structure,
      // protagonist or safety back into Story Craft: those rules now belong to
      // the Audience profile. Preserve old rule overrides until migration has
      // folded them into Audience.
      const resolved = resolveStoryCraft(bandId, d);
      const merged: AgeBandStoryCraftOverride = {
        ...(d.bands[bandId] ?? {}),
        themes: patch.themes ?? resolved.themes,
        devices: patch.devices ?? resolved.devices,
        settings: patch.settings ?? resolved.settings,
      };
      return { ...d, bands: { ...d.bands, [bandId]: merged } };
    });
    setDirty(true);
  };

  const resetBand = () => {
    setDraft((d) => {
      const bands = { ...d.bands };
      delete bands[bandId];
      return { ...d, bands };
    });
    setDirty(true);
  };

  const copyFromBand = () => {
    if (!copyFromId || copyFromId === bandId) return;
    const source = resolveStoryCraft(copyFromId, draft);
    patchBand({
      themes: source.themes.map((option) => ({ ...option })),
      devices: source.devices.map((option) => ({ ...option })),
      settings: source.settings.map((option) => ({ ...option })),
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      // Half-added rows are the normal way out of "Add theme" — drop them here
      // rather than failing the whole save on a schema error nobody can read.
      await save(pruneBlankOptions(draft));
      setDirty(false);
      toast.success("Story craft saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save story craft.");
    } finally {
      setSaving(false);
    }
  };

  const defaults = defaultStoryCraft(bandId);
  const counts = `${effective.themes.length} themes · ${effective.devices.length} devices · ${effective.settings.length} settings`;
  const bandLabel =
    embeddedBandLabel ?? bands.find((band) => band.id === bandId)?.label ?? bandId;
  const saveActions = (
    <div className="flex items-center gap-2">
      {(hasOverride || draft.bands[bandId]) && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RotateCcw className="size-3.5" />}
          onClick={resetBand}
        >
          {hasShippedDefault ? "Reset band to defaults" : "Clear band choices"}
        </Button>
      )}
      <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
        {embeddedBandId ? "Save Story Craft" : "Save changes"}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {!embeddedBandId && (
        <>
          <TabIntro elsewhere="Story length, hero age, page pacing and the safety list live in Age bands. The prompt wording itself lives in Prompts.">
            What a reader can choose from when writing a story, per age band. Themes and settings
            appear as chips in the Story step; the guidance under each one is what the writer is
            told when it is picked. Hidden bands stay editable here, so their choices can be ready
            before launch.
          </TabIntro>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {bands.map((age) => (
                <button
                  key={age.id}
                  type="button"
                  onClick={() => setSelectedBandId(age.id as AgeBandId)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    bandId === age.id
                      ? "bg-brand-600 text-white shadow-sm"
                      : "bg-white text-ink-600 ring-1 ring-inset ring-ink-100 hover:bg-ink-50",
                    stored.bands[age.id as AgeBandId] && bandId !== age.id && "text-brand-700",
                  )}
                >
                  {age.label}
                  <span className="ml-1 opacity-60">{age.enabled ? "on" : "hidden"}</span>
                  {stored.bands[age.id as AgeBandId] && (
                    <span className="ml-1 opacity-60">•</span>
                  )}
                </button>
              ))}
            </div>
            {saveActions}
          </div>
        </>
      )}

      {embeddedBandId && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-800">Creative choices for {bandLabel}</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
              Themes, storytelling devices and settings offered when an author creates a story.
            </p>
          </div>
          {saveActions}
        </div>
      )}

      <p className="px-1 text-[11px] text-ink-400">
        {counts}
        {draft.bands[bandId] ? (
          <>
            {" "}
            · pinned to what you see here, so it won&apos;t pick up future built-in updates until
            you reset the band
          </>
        ) : (
          hasShippedDefault ? " · using the built-in defaults" : " · no curated choices configured"
        )}
      </p>

      {isUnconfigured && (
        <div className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-800">
          This age band has no Story Craft choices yet. Add choices below or copy a nearby band. It
          will not silently use another age band&apos;s catalog.
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg bg-ink-50/60 p-3 ring-1 ring-inset ring-ink-100 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Start from another band
          </span>
          <Select
            value={copyFromId}
            onChange={(event) => setCopyFromId(event.target.value)}
            options={[
              { value: "", label: "Choose a band", disabled: true },
              ...bands
                .filter((band) => band.id !== bandId)
                .map((band) => ({
                  value: band.id,
                  label: `${band.label}${band.enabled ? "" : " (hidden)"}`,
                })),
            ]}
            className="h-9"
          />
        </label>
        <Button
          variant="secondary"
          size="sm"
          disabled={!copyFromId}
          onClick={copyFromBand}
        >
          Copy all choices
        </Button>
      </div>

      <div className="space-y-3">
        {(Object.keys(LIST_META) as ListKey[]).map((key) => (
          <OptionListEditor
            key={key}
            listKey={key}
            options={effective[key]}
            onChange={(options) =>
              patchBand({
                // Give a freshly-added option a readable id derived from its
                // label, so saved briefs stay legible in Firestore.
                [key]: stabilizeNewOptionIds(options),
              } as Partial<Pick<AgeBandStoryCraft, ListKey>>)
            }
          />
        ))}

      </div>

      <details className="rounded-lg ring-1 ring-inset ring-ink-100">
        <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          {hasShippedDefault ? "Built-in defaults" : "Unconfigured baseline"} for {bandLabel}
        </summary>
        <div className="space-y-1 border-t border-ink-100 p-3 text-[11px] leading-relaxed text-ink-500">
          <p>
            <span className="font-semibold text-ink-700">Themes:</span>{" "}
            {defaults.themes.map((t) => t.label).join(", ")}
          </p>
          <p>
            <span className="font-semibold text-ink-700">Devices:</span>{" "}
            {defaults.devices.map((d) => d.label).join(", ")}
          </p>
          <p>
            <span className="font-semibold text-ink-700">Settings:</span>{" "}
            {defaults.settings.map((t) => t.label).join(", ")}
          </p>
        </div>
      </details>
    </div>
  );
}
