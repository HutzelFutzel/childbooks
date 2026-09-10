"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  CHANNEL_LABELS,
  EDITORIAL_DIMENSIONS,
  GUARDRAIL_SECTIONS,
  MANDATORY_AVOID,
  type AudienceDensity,
  type AudienceProfile,
  type AudienceStructure,
  type OverlayChannel,
} from "../../../core/config/audienceCatalog";
import {
  audienceProfiles,
  inspectAudienceConfig,
  monthRangeLabel,
  type AudienceConfig,
  type AudienceProfileOverride,
} from "../../../core/config/audience";
import { READING_MODES, type ReadingModeId } from "../../../core/config/readingModes";
import { resolveAudienceOverlays } from "../../../core/prompts/audience";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { Section, TabIntro } from "./products/parts";
import { cn } from "../../lib/cn";

type PaneId = "basics" | "guidance" | "rubric" | "pacing" | "safety" | "preview";

const PANES: { id: PaneId; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "guidance", label: "Guidance" },
  { id: "rubric", label: "Reading level" },
  { id: "pacing", label: "Length & pacing" },
  { id: "safety", label: "Safety" },
  { id: "preview", label: "Preview" },
];

/** Where a piece of guidance ends up, in the words an editor would use. */
function ChannelChips({ channels }: { channels: OverlayChannel[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {channels.map((c) => (
        <span
          key={c}
          className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500"
        >
          {CHANNEL_LABELS[c]}
        </span>
      ))}
    </span>
  );
}

function newProfileId(existing: Set<string>, seed: string): string {
  const base =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "band";
  if (!existing.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    if (!existing.has(`${base}-${i}`)) return `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------

function BasicsPane({
  profile,
  siblings,
  patch,
}: {
  profile: AudienceProfile;
  siblings: AudienceProfile[];
  patch: (p: Partial<AudienceProfile>) => void;
}) {
  return (
    <>
      <Section title="Identity" hint="What this band is called wherever a reader or an admin sees it.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" hint="Shown in the age picker and in every prompt.">
            <Input value={profile.label} onChange={(e) => patch({ label: e.target.value })} />
          </Field>
          <Field label="Caption" hint="Two words of publishing context, e.g. “Board books”.">
            <Input value={profile.caption} onChange={(e) => patch({ caption: e.target.value })} />
          </Field>
        </div>
        <Field label="Description" hint="One line under the caption in the age picker.">
          <Textarea
            rows={2}
            value={profile.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
      </Section>

      <Section
        title="Age range"
        hint="In months, so bands under two years can be split. Used by the age shortcut in the setup wizard."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="From (months)">
            <Input
              type="number"
              min={0}
              value={profile.minMonths}
              onChange={(e) => patch({ minMonths: Number(e.target.value) })}
            />
          </Field>
          <Field label="To (months)">
            <Input
              type="number"
              min={0}
              value={profile.maxMonths}
              onChange={(e) => patch({ maxMonths: Number(e.target.value) })}
            />
          </Field>
          <Field label="Sort position" hint="Lowest first in the picker.">
            <Input
              type="number"
              min={0}
              value={profile.order}
              onChange={(e) => patch({ order: Number(e.target.value) })}
            />
          </Field>
        </div>
        <p className="text-[11px] text-ink-400">Reads as {monthRangeLabel(profile)}.</p>
      </Section>

      <Section
        title="Reading modes"
        hint="Ask the customer how the book will be read, and give each answer its own wording. Leave all three off for bands that are always read aloud by an adult."
      >
        <div className="space-y-2">
          {READING_MODES.map((mode) => {
            const on = profile.readingModes.includes(mode.id);
            return (
              <label
                key={mode.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 ring-1 ring-inset ring-ink-100"
              >
                <span className="text-sm text-ink-700">{mode.label}</span>
                <Toggle
                  checked={on}
                  label={mode.label}
                  onChange={(next) =>
                    patch({
                      readingModes: next
                        ? [...profile.readingModes, mode.id]
                        : profile.readingModes.filter((m) => m !== mode.id),
                    })
                  }
                />
              </label>
            );
          })}
        </div>
      </Section>

      <ModesPane profile={profile} patch={patch} />

      <Section
        title="Characters"
        hint="Who the story is about, which is not the same as who reads it."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Hero — youngest">
            <Input
              type="number"
              min={0}
              value={profile.protagonist.minAge}
              onChange={(e) =>
                patch({
                  protagonist: { ...profile.protagonist, minAge: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Hero — oldest">
            <Input
              type="number"
              min={0}
              value={profile.protagonist.maxAge}
              onChange={(e) =>
                patch({
                  protagonist: { ...profile.protagonist, maxAge: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field
            label="Undated character"
            hint="Years. Used to size anyone the story never gives an age."
          >
            <Input
              type="number"
              min={0}
              value={profile.defaultCharacterAgeYears}
              onChange={(e) => patch({ defaultCharacterAgeYears: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field
          label="Hero sentence"
          hint="Sent with every draft. {{min}} and {{max}} are replaced with the ages above."
        >
          <Textarea
            rows={2}
            value={profile.protagonist.guidance}
            onChange={(e) =>
              patch({ protagonist: { ...profile.protagonist, guidance: e.target.value } })
            }
            className="font-mono text-xs leading-relaxed"
          />
        </Field>
      </Section>

      <Section
        title="Advanced"
        hint="Inheritance and renames. Most bands need neither."
      >
        <Field
          label="Start from another band"
          hint="Anything left blank here is taken from that band, so a variant only states what differs."
        >
          <Select
            value={profile.extendsId ?? ""}
            onChange={(e) => patch({ extendsId: e.target.value || undefined })}
            options={[
              { value: "", label: "Nothing — this band stands alone" },
              ...siblings
                .filter((p) => p.id !== profile.id)
                .map((p) => ({ value: p.id, label: p.label })),
            ]}
          />
        </Field>
        <Field
          label="Also answers to"
          hint="Comma-separated old ids. Books made before a rename keep resolving here instead of falling back."
        >
          <Input
            value={profile.aliases.join(", ")}
            onChange={(e) =>
              patch({
                aliases: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="0-2, toddler"
          />
        </Field>
        <p className="text-[11px] text-ink-400">
          Stored id: <code className="rounded bg-ink-100 px-1 py-0.5">{profile.id}</code> — fixed,
          because every book that already chose this band refers to it.
        </p>
      </Section>
    </>
  );
}

/** Per-reading-mode wording: what the customer sees, and what the writer is told. */
function ModesPane({
  profile,
  patch,
}: {
  profile: AudienceProfile;
  patch: (p: Partial<AudienceProfile>) => void;
}) {
  const keys: (ReadingModeId | "default")[] =
    profile.readingModes.length > 0 ? profile.readingModes : ["default"];

  const setMode = (key: string, field: "humanGuidance" | "storyGuidance", value: string) => {
    const prev = profile.modes[key as keyof typeof profile.modes] ?? {
      humanGuidance: "",
      storyGuidance: "",
    };
    patch({ modes: { ...profile.modes, [key]: { ...prev, [field]: value } } });
  };

  return (
    <Section
      title="Wording"
      hint={
        profile.readingModes.length > 0
          ? "One set per reading mode above."
          : "Shown in the age picker, and added to the top of every writing prompt."
      }
    >
      <div className="space-y-3">
        {keys.map((key) => {
          const mode = profile.modes[key as keyof typeof profile.modes];
          const title =
            key === "default" ? null : READING_MODES.find((m) => m.id === key)?.label ?? key;
          return (
            <div key={key} className="space-y-2">
              {title && (
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {title}
                </div>
              )}
              <Field label="Shown to the customer">
                <Textarea
                  rows={2}
                  value={mode?.humanGuidance ?? ""}
                  onChange={(e) => setMode(key, "humanGuidance", e.target.value)}
                  placeholder="Short sentences, playful rhythm, lots of imagery."
                />
              </Field>
              <Field
                label="Extra note for the writer"
                hint="Optional. Free-form, and added on top of the guidance sections."
              >
                <Textarea
                  rows={2}
                  value={mode?.storyGuidance ?? ""}
                  onChange={(e) => setMode(key, "storyGuidance", e.target.value)}
                  className="font-mono text-xs leading-relaxed"
                />
              </Field>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function GuidancePane({
  profile,
  patch,
}: {
  profile: AudienceProfile;
  patch: (p: Partial<AudienceProfile>) => void;
}) {
  return (
    <>
      <p className="px-1 text-xs leading-relaxed text-ink-500">
        Each section is sent only to the steps listed beside it, so a page-turn rule never reaches
        the picture model and a composition rule never reaches the writer. Leave a section blank to
        send nothing.
      </p>
      {GUARDRAIL_SECTIONS.map((def) => (
        <Section
          key={def.id}
          title={def.label}
          hint={def.hint}
          action={<ChannelChips channels={def.channels} />}
        >
          <Textarea
            rows={5}
            value={profile.sections[def.id] ?? ""}
            onChange={(e) => patch({ sections: { ...profile.sections, [def.id]: e.target.value } })}
            className="font-mono text-xs leading-relaxed"
            aria-label={def.label}
          />
        </Section>
      ))}
    </>
  );
}

function RubricPane({
  profile,
  patch,
}: {
  profile: AudienceProfile;
  patch: (p: Partial<AudienceProfile>) => void;
}) {
  const evaluated = new Set(profile.evaluatedDimensionIds);

  const toggleEvaluated = (id: string, on: boolean) =>
    patch({
      evaluatedDimensionIds: on
        ? [...profile.evaluatedDimensionIds, id]
        : profile.evaluatedDimensionIds.filter((d) => d !== id),
    });

  return (
    <>
      <p className="px-1 text-xs leading-relaxed text-ink-500">
        How a book for this age reads. The level and its note go into the writing prompts; the rows
        you check are also what the reading-level check scores a manuscript against.
      </p>
      <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-ink-100">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-ink-50/60 text-left text-[11px] uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2 font-semibold">Quality</th>
              <th className="w-44 px-3 py-2 font-semibold">Level</th>
              <th className="px-3 py-2 font-semibold">Note for the model</th>
              <th className="w-20 px-3 py-2 text-center font-semibold">Check</th>
            </tr>
          </thead>
          <tbody>
            {EDITORIAL_DIMENSIONS.map((def) => {
              const value = profile.dimensions[def.id];
              return (
                <tr key={def.id} className="border-t border-ink-100 align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink-800">{def.label}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-ink-400">
                      {def.hint}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Select
                      className="h-9 text-xs"
                      aria-label={`${def.label} level`}
                      value={value ? String(value.level) : ""}
                      onChange={(e) =>
                        patch({
                          dimensions: {
                            ...profile.dimensions,
                            [def.id]: {
                              guidance: value?.guidance ?? "",
                              level: Number(e.target.value),
                            },
                          },
                        })
                      }
                      options={[
                        { value: "", label: "Not set", disabled: true },
                        ...def.levels.map((label, i) => ({ value: String(i), label })),
                      ]}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <Input
                      className="h-9 text-xs"
                      aria-label={`${def.label} note`}
                      placeholder="Optional — one line of detail"
                      value={value?.guidance ?? ""}
                      onChange={(e) =>
                        patch({
                          dimensions: {
                            ...profile.dimensions,
                            [def.id]: {
                              level: value?.level ?? 0,
                              guidance: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <Toggle
                      checked={evaluated.has(def.id)}
                      label={`Score ${def.label}`}
                      onChange={(on) => toggleEvaluated(def.id, on)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PacingPane({
  profile,
  patch,
}: {
  profile: AudienceProfile;
  patch: (p: Partial<AudienceProfile>) => void;
}) {
  const { structure, density } = profile;
  return (
    <>
      <Section
        title="Whole story"
        hint="Checked after every draft. A miss triggers exactly one repair retry, then the closer attempt wins."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Min words">
            <Input
              type="number"
              min={1}
              value={structure.minWords}
              onChange={(e) => patch({ structure: { ...structure, minWords: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Max words">
            <Input
              type="number"
              min={1}
              value={structure.maxWords}
              onChange={(e) => patch({ structure: { ...structure, maxWords: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Story beats">
            <Input
              type="number"
              min={1}
              value={structure.beats}
              onChange={(e) => patch({ structure: { ...structure, beats: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Longest sentence" hint="Words. 0 turns the limit off.">
            <Input
              type="number"
              min={0}
              value={structure.maxSentenceWords}
              onChange={(e) =>
                patch({ structure: { ...structure, maxSentenceWords: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
        <label className="flex items-start justify-between gap-3 rounded-lg bg-white/70 px-3 py-2.5 ring-1 ring-inset ring-ink-100">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-ink-700">Needs a plot</span>
            <span className="block text-[11px] leading-relaxed text-ink-400">
              Off lets this band be a naming, counting or routine book. Leaving it on for the very
              youngest ages is what produces a three-act story pasted onto a board book.
            </span>
          </span>
          <Toggle
            checked={structure.plotRequired}
            label="Needs a plot"
            onChange={(plotRequired) => patch({ structure: { ...structure, plotRequired } })}
          />
        </label>
      </Section>

      <Section
        title="Per page"
        hint="Applied when the story is split into pages — the only step where “one short sentence per page” can actually be held to."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Words — typical">
            <Input
              type="number"
              min={0}
              value={density.targetWordsPerPage}
              onChange={(e) =>
                patch({ density: { ...density, targetWordsPerPage: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Words — never over" hint="0 turns the check off.">
            <Input
              type="number"
              min={0}
              value={density.maxWordsPerPage}
              onChange={(e) =>
                patch({ density: { ...density, maxWordsPerPage: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Sentences — typical">
            <Input
              type="number"
              min={0}
              value={density.targetSentencesPerPage}
              onChange={(e) =>
                patch({ density: { ...density, targetSentencesPerPage: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Characters per picture" hint="How many stay readable in one scene.">
            <Input
              type="number"
              min={1}
              value={density.maxFocalCharactersPerScene}
              onChange={(e) =>
                patch({
                  density: { ...density, maxFocalCharactersPerScene: Number(e.target.value) },
                })
              }
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Pages — fewest">
            <Input
              type="number"
              min={1}
              value={density.minPages}
              onChange={(e) => patch({ density: { ...density, minPages: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Pages — most">
            <Input
              type="number"
              min={1}
              value={density.maxPages}
              onChange={(e) => patch({ density: { ...density, maxPages: Number(e.target.value) } })}
            />
          </Field>
        </div>
        <PageBudgetHint structure={structure} density={density} />
      </Section>
    </>
  );
}

/**
 * The page count these numbers actually imply, next to the one that was typed.
 *
 * Story length and words-per-page together already decide how long a book is;
 * the page range is a third number that can silently contradict them. Showing
 * the arithmetic means the contradiction is visible while it's being made,
 * rather than surfacing later as books that come out nearly empty.
 */
function PageBudgetHint({
  structure,
  density,
}: {
  structure: AudienceStructure;
  density: AudienceDensity;
}) {
  if (density.targetWordsPerPage <= 0 || structure.maxWords <= 0) return null;
  const low = Math.ceil(structure.minWords / density.targetWordsPerPage);
  const high = Math.ceil(structure.maxWords / density.targetWordsPerPage);
  const agrees = high >= density.minPages && low <= density.maxPages;
  return (
    <p className="text-[11px] leading-relaxed text-ink-400">
      {structure.minWords}–{structure.maxWords} words at ~{density.targetWordsPerPage} per page
      works out to <span className="font-medium text-ink-600">{low}–{high} pages</span>.
      {!agrees && (
        <span className="text-amber-700">
          {" "}
          That doesn&rsquo;t overlap the {density.minPages}–{density.maxPages} above, so one of the
          two will always be missed.
        </span>
      )}
    </p>
  );
}

function SafetyPane({
  profile,
  patch,
}: {
  profile: AudienceProfile;
  patch: (p: Partial<AudienceProfile>) => void;
}) {
  return (
    <>
      <Section
        title="Always excluded"
        hint="Part of every prompt in the product and not editable here — a children's-book generator should not have a field that can delete these."
      >
        <ul className="space-y-1 text-xs leading-relaxed text-ink-500">
          {MANDATORY_AVOID.map((entry) => (
            <li key={entry} className="flex gap-2">
              <span className="text-ink-300">•</span>
              {entry}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Also excluded for this age"
        hint="Added to the list above. One per line."
      >
        <Textarea
          rows={5}
          value={profile.safety.avoid.join("\n")}
          onChange={(e) =>
            patch({
              safety: {
                ...profile.safety,
                avoid: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            })
          }
          className="font-mono text-xs leading-relaxed"
          aria-label="Also excluded for this age"
        />
      </Section>

      <Section
        title="Closing note"
        hint="One sentence about how tension has to resolve at this age."
      >
        <Textarea
          rows={2}
          value={profile.safety.note}
          onChange={(e) => patch({ safety: { ...profile.safety, note: e.target.value } })}
          className="font-mono text-xs leading-relaxed"
          aria-label="Closing note"
        />
      </Section>
    </>
  );
}

function PreviewPane({ profile, config }: { profile: AudienceProfile; config: AudienceConfig }) {
  const [mode, setMode] = useState<string>(profile.readingModes[0] ?? "");
  const overlays = useMemo(
    () => resolveAudienceOverlays(profile.id, mode || null, config),
    [profile.id, mode, config],
  );

  const blocks: { label: string; body: string }[] = [
    { label: "Story writing", body: overlays.story },
    { label: "Page plan", body: overlays.screenplay },
    { label: "Page pacing", body: overlays.density },
    { label: "Page pictures", body: overlays.illustration },
    { label: "Character sheets", body: overlays.characterArt },
    { label: "Reading-level check", body: overlays.evaluation },
    { label: "Never include", body: overlays.safetyList },
  ];

  return (
    <>
      <p className="px-1 text-xs leading-relaxed text-ink-500">
        Exactly what each step is sent for this band, compiled from everything above. Unsaved edits
        are included.
      </p>
      {profile.readingModes.length > 0 && (
        <Field label="Reading mode">
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={profile.readingModes.map((m) => ({
              value: m,
              label: READING_MODES.find((r) => r.id === m)?.label ?? m,
            }))}
          />
        </Field>
      )}
      {blocks.map((b) => (
        <Section key={b.label} title={b.label}>
          {b.body.trim() ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-[11px] leading-relaxed text-ink-700 ring-1 ring-inset ring-ink-100">
              {b.body}
            </pre>
          ) : (
            <p className="text-[11px] text-ink-400">
              Nothing is sent to this step for this band.
            </p>
          )}
        </Section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

/**
 * Age bands and everything editorial that follows from them.
 *
 * One document, one compiler: the guidance written here is the guidance the
 * models get, and the Preview pane renders the identical string. Bands are data
 * rather than code, so adding "0–12 months" is an action here.
 */
export function AudienceTab() {
  const stored = useAppConfigStore((s) => s.audience);
  const legacyWriting = useAppConfigStore((s) => s.ageWriting);
  const legacyCraft = useAppConfigStore((s) => s.storyCraft);
  const save = useAppConfigStore((s) => s.saveAudience);

  const [draft, setDraft] = useState<AudienceConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pane, setPane] = useState<PaneId>("basics");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  // The legacy documents are layered in so a deployment that customised them
  // sees its own wording here rather than the shipped defaults.
  const source = useMemo(
    () => ({ audience: draft, ageWriting: legacyWriting, storyCraft: legacyCraft }),
    [draft, legacyWriting, legacyCraft],
  );
  const profiles = useMemo(() => audienceProfiles(source), [source]);
  const issues = useMemo(() => inspectAudienceConfig(source), [source]);

  const profile = profiles.find((p) => p.id === selectedId) ?? profiles[0];
  const profileIssues = issues.filter((i) => i.profileId === profile?.id);
  const hasOverride = draft.profiles.some((p) => p.id === profile?.id);

  const patch = (p: Partial<AudienceProfile>) => {
    if (!profile) return;
    setDraft((d) => {
      // Store the fully-resolved band. An admin editing one section should not
      // silently detach the other thirteen from what they were reading.
      const merged = { ...profile, ...p } as AudienceProfileOverride;
      const rest = d.profiles.filter((x) => x.id !== profile.id);
      return { ...d, profiles: [...rest, merged] };
    });
    setDirty(true);
  };

  const resetBand = () => {
    if (!profile) return;
    setDraft((d) => ({ ...d, profiles: d.profiles.filter((p) => p.id !== profile.id) }));
    setDirty(true);
  };

  const addBand = (from?: AudienceProfile) => {
    const ids = new Set(profiles.map((p) => p.id));
    const id = newProfileId(ids, from ? `${from.id}-copy` : "new-band");
    const base: AudienceProfileOverride = from
      ? ({ ...from, id, label: `${from.label} (copy)`, aliases: [], enabled: false } as AudienceProfileOverride)
      : {
          id,
          label: "New age band",
          caption: "",
          description: "",
          minMonths: 0,
          maxMonths: 12,
          order: 1000,
          enabled: false,
          aliases: [],
        };
    setDraft((d) => ({ ...d, profiles: [...d.profiles, base] }));
    setSelectedId(id);
    setPane("basics");
    setDirty(true);
  };

  const deleteBand = () => {
    if (!profile) return;
    setDraft((d) => ({ ...d, profiles: d.profiles.filter((p) => p.id !== profile.id) }));
    setSelectedId(null);
    setDirty(true);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Age bands saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save age bands.");
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return null;

  const shipped = profiles.filter((p) => !isAdminOnly(p, draft));
  const custom = profiles.filter((p) => isAdminOnly(p, draft));

  return (
    <div className="space-y-4">
      <TabIntro elsewhere="Themes, devices and settings a reader picks from live in Story craft. The wording around this guidance lives in Prompts.">
        Who each book is for, and every editorial rule that follows. One band holds the writing
        guidance, the reading-level rubric, the length and page pacing, and the safety list — and
        each piece is sent only to the steps it belongs to. Add a band here rather than in code.
      </TabIntro>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {hasOverride && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw className="size-3.5" />}
            onClick={resetBand}
          >
            {isAdminOnly(profile, draft) ? "Discard changes" : "Reset to built-in"}
          </Button>
        )}
        {isAdminOnly(profile, draft) && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 className="size-3.5" />}
            onClick={deleteBand}
          >
            Delete band
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Copy className="size-3.5" />}
          onClick={() => addBand(profile)}
        >
          Duplicate
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Plus className="size-3.5" />}
          onClick={() => addBand()}
        >
          Add band
        </Button>
        <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
          Save changes
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <nav className="space-y-1" aria-label="Age bands">
          <BandList
            profiles={shipped}
            selectedId={profile.id}
            draft={draft}
            onSelect={setSelectedId}
          />
          {custom.length > 0 && (
            <>
              <div className="px-2 pt-3 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                Added by you
              </div>
              <BandList
                profiles={custom}
                selectedId={profile.id}
                draft={draft}
                onSelect={setSelectedId}
              />
            </>
          )}
        </nav>

        <div className="min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-lg bg-ink-50/50 px-3 py-2.5 ring-1 ring-inset ring-ink-100">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink-800">{profile.label}</div>
              <div className="mt-0.5 text-[11px] text-ink-400">
                {monthRangeLabel(profile)}
                {profile.extendsId && ` · starts from ${profile.extendsId}`}
                {!hasOverride && " · using the built-in defaults"}
              </div>
            </div>
            <label className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] font-medium text-ink-500">
                {profile.enabled ? "Offered" : "Hidden"}
              </span>
              <Toggle
                checked={profile.enabled}
                label="Offered to customers"
                onChange={(enabled) => patch({ enabled })}
              />
            </label>
          </div>

          {!profile.enabled && (
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
              Hidden from the age picker. Books that already use this band keep resolving it
              exactly as configured — that is how a band is retired without breaking them.
            </p>
          )}

          {profileIssues.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              {profileIssues.map((issue, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-amber-800">
                  {issue.message}
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-1 overflow-x-auto border-b border-ink-100" role="tablist">
            {PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={pane === p.id}
                onClick={() => setPane(p.id)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                  pane === p.id
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-ink-500 hover:text-ink-700",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {pane === "basics" && (
              <BasicsPane profile={profile} siblings={profiles} patch={patch} />
            )}
            {pane === "guidance" && <GuidancePane profile={profile} patch={patch} />}
            {pane === "rubric" && <RubricPane profile={profile} patch={patch} />}
            {pane === "pacing" && <PacingPane profile={profile} patch={patch} />}
            {pane === "safety" && <SafetyPane profile={profile} patch={patch} />}
            {pane === "preview" && <PreviewPane profile={profile} config={draft} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** True for a band that exists only because an admin created it. */
function isAdminOnly(profile: AudienceProfile, draft: AudienceConfig): boolean {
  return (
    draft.profiles.some((p) => p.id === profile.id) &&
    !SHIPPED_IDS.has(profile.id)
  );
}

const SHIPPED_IDS = new Set(["0-2", "3-5", "6-8", "9-12", "0-12m", "13-24m"]);

function BandList({
  profiles,
  selectedId,
  draft,
  onSelect,
}: {
  profiles: AudienceProfile[];
  selectedId: string;
  draft: AudienceConfig;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      {profiles.map((p) => {
        const active = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-current={active}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
              active ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "hover:bg-ink-50",
            )}
          >
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-sm font-medium",
                  active ? "text-brand-800" : "text-ink-700",
                  !p.enabled && "text-ink-400",
                )}
              >
                {p.label}
              </span>
              <span className="block truncate text-[11px] text-ink-400">
                {p.enabled ? p.caption || monthRangeLabel(p) : "Hidden"}
              </span>
            </span>
            {draft.profiles.some((x) => x.id === p.id) && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-brand-500"
                title="Customised"
                aria-label="Customised"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
