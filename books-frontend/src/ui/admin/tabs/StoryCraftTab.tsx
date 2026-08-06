"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GripVertical, Plus, RotateCcw, Trash2 } from "lucide-react";
import { AGE_RANGES } from "../../../core/config/options";
import type { AgeBandId } from "../../../core/config/ageWritingCatalog";
import {
  defaultStoryCraft,
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
import { Field, Input, Textarea } from "../../components/Input";
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

function RulesEditor({
  craft,
  onChange,
}: {
  craft: AgeBandStoryCraft;
  onChange: (patch: Partial<AgeBandStoryCraft>) => void;
}) {
  const { structure, protagonist, safety } = craft;
  return (
    <>
      <Section
        title="Structure"
        hint="Checked after every draft. A miss triggers exactly one repair retry, then the closer attempt wins."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Min words">
            <Input
              type="number"
              min={10}
              value={structure.minWords}
              onChange={(e) =>
                onChange({ structure: { ...structure, minWords: Number(e.target.value) } })
              }
              className="h-9 text-sm"
            />
          </Field>
          <Field label="Max words">
            <Input
              type="number"
              min={10}
              value={structure.maxWords}
              onChange={(e) =>
                onChange({ structure: { ...structure, maxWords: Number(e.target.value) } })
              }
              className="h-9 text-sm"
            />
          </Field>
          <Field label="Story beats">
            <Input
              type="number"
              min={1}
              value={structure.beats}
              onChange={(e) =>
                onChange({ structure: { ...structure, beats: Number(e.target.value) } })
              }
              className="h-9 text-sm"
            />
          </Field>
          <Field label="Max sentence" hint="words; 0 = no limit">
            <Input
              type="number"
              min={0}
              value={structure.maxSentenceWords}
              onChange={(e) =>
                onChange({
                  structure: { ...structure, maxSentenceWords: Number(e.target.value) },
                })
              }
              className="h-9 text-sm"
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Hero's age"
        hint="Children identify upward, so the hero is usually a little older than the reader."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Youngest">
            <Input
              type="number"
              min={0}
              value={protagonist.minAge}
              onChange={(e) =>
                onChange({ protagonist: { ...protagonist, minAge: Number(e.target.value) } })
              }
              className="h-9 text-sm"
            />
          </Field>
          <Field label="Oldest">
            <Input
              type="number"
              min={0}
              value={protagonist.maxAge}
              onChange={(e) =>
                onChange({ protagonist: { ...protagonist, maxAge: Number(e.target.value) } })
              }
              className="h-9 text-sm"
            />
          </Field>
        </div>
        <Field label="Prompt sentence" hint="{{min}} and {{max}} are replaced with the ages above.">
          <Textarea
            rows={2}
            value={protagonist.guidance}
            onChange={(e) =>
              onChange({ protagonist: { ...protagonist, guidance: e.target.value } })
            }
            className="font-mono text-xs leading-relaxed"
          />
        </Field>
      </Section>

      <Section title="Safety" hint="Injected into every draft prompt for this band as a hard 'never include' list.">
        <Field label="Never include" hint="One per line.">
          <Textarea
            rows={5}
            value={safety.avoid.join("\n")}
            onChange={(e) =>
              onChange({
                safety: {
                  ...safety,
                  avoid: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                },
              })
            }
            className="font-mono text-xs leading-relaxed"
          />
        </Field>
        <Field label="Closing note">
          <Textarea
            rows={2}
            value={safety.note}
            onChange={(e) => onChange({ safety: { ...safety, note: e.target.value } })}
            className="font-mono text-xs leading-relaxed"
          />
        </Field>
      </Section>
    </>
  );
}

/**
 * Per-age-band story catalogs and rules. Curated lists (themes, devices,
 * settings) are stored as the exact list you leave here; the rule blocks merge
 * onto the shipped defaults, so an untouched band always tracks code.
 */
export function StoryCraftTab() {
  const stored = useAppConfigStore((s) => s.storyCraft);
  const save = useAppConfigStore((s) => s.saveStoryCraft);

  const [draft, setDraft] = useState<StoryCraftConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bandId, setBandId] = useState<AgeBandId>(AGE_RANGES[0].id as AgeBandId);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const effective = useMemo(() => resolveStoryCraft(bandId, draft), [bandId, draft]);
  const hasOverride = Boolean(stored.bands[bandId]);

  const patchBand = (patch: Partial<AgeBandStoryCraft>) => {
    setDraft((d) => {
      // Persist the fully-resolved band: an admin editing one list shouldn't
      // silently detach the others from what they were looking at.
      const merged: AgeBandStoryCraftOverride = { ...resolveStoryCraft(bandId, d), ...patch };
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

  return (
    <div className="space-y-4">
      <TabIntro elsewhere="Reading level and per-reading-mode wording live in Age writing. The prompt wording itself lives in Prompts.">
        What readers can choose from when writing a story, and the rules every draft is held to —
        per age band. Themes and devices appear as chips in the Story step; the structure, hero age
        and safety rules go into the prompt and are checked against the draft that comes back.
      </TabIntro>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {AGE_RANGES.map((age) => (
            <button
              key={age.id}
              type="button"
              onClick={() => setBandId(age.id as AgeBandId)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                bandId === age.id
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-white text-ink-600 ring-1 ring-inset ring-ink-100 hover:bg-ink-50",
                stored.bands[age.id as AgeBandId] && bandId !== age.id && "text-brand-700",
              )}
            >
              {age.label}
              {stored.bands[age.id as AgeBandId] && <span className="ml-1 opacity-60">•</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {(hasOverride || draft.bands[bandId]) && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw className="size-3.5" />}
              onClick={resetBand}
            >
              Reset band to defaults
            </Button>
          )}
          <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
            Save changes
          </Button>
        </div>
      </div>

      <p className="px-1 text-[11px] text-ink-400">
        {counts}
        {draft.bands[bandId] ? (
          <>
            {" "}
            · pinned to what you see here, so it won&apos;t pick up future built-in updates until
            you reset the band
          </>
        ) : (
          " · using the built-in defaults"
        )}
      </p>

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
                [key]: options.map((o) =>
                  o.id.startsWith("new-") && o.label.trim()
                    ? { ...o, id: slugify(o.label) }
                    : o,
                ),
              } as Partial<AgeBandStoryCraft>)
            }
          />
        ))}

        <RulesEditor craft={effective} onChange={patchBand} />
      </div>

      <details className="rounded-lg ring-1 ring-inset ring-ink-100">
        <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Built-in defaults for {AGE_RANGES.find((a) => a.id === bandId)?.label}
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
            <span className="font-semibold text-ink-700">Length:</span>{" "}
            {defaults.structure.minWords}–{defaults.structure.maxWords} words over{" "}
            {defaults.structure.beats} beats; hero {defaults.protagonist.minAge}–
            {defaults.protagonist.maxAge}.
          </p>
        </div>
      </details>
    </div>
  );
}
