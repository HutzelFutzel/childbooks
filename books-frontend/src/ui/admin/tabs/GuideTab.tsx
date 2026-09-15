"use client";

/**
 * Configuration → Creative defaults → Guided studio.
 *
 * Two decisions live here, and they are different kinds of decision.
 *
 * **Who gets the new flow** is a release decision with a blast radius: `on` moves
 * every customer onto a studio the wizard has been carrying for years, and a
 * mistake is not visible in this tab — it is visible in support mail. So the mode
 * picker states the consequence in customer terms rather than naming the mode,
 * and `off` is presented as what it is: the switch that also revokes an admin's
 * own opt-in, which is the one thing to reach for when something is wrong.
 *
 * **Which questions the guide asks** is editorial, and deliberately hard to get
 * badly wrong. The catalog in code owns what a component means, when it counts as
 * finished and what it depends on; this tab only reorders, retitles, and switches
 * off. `normalizeGuidePlaylist` repairs whatever is saved, so the failure mode of
 * a careless edit is an odd order, not a book the pipeline refuses to make. The
 * lint warnings below are shown for the mistakes normalization cannot fix by
 * itself — turning off something another component needs — and they do not block
 * saving, because a playlist you cannot save is a state the dashboard cannot get
 * out of.
 *
 * What is NOT here: the model that reads the reader's answers, and the prompt it
 * runs. Those are one row in Configuration → Models (the `guideInterpret` slot)
 * and one entry in Prompts, and moving them here would mean two places to look
 * for the same kind of setting.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, RotateCcw, TriangleAlert } from "lucide-react";
import {
  createDefaultGuideConfig,
  describeGuideRollout,
  GUIDE_ROLLOUT_MODES,
  type GuideConfig,
  type GuideRolloutMode,
} from "../../../core/config/guide";
import {
  createDefaultGuidePlaylist,
  lintGuidePlaylist,
  normalizeGuidePlaylist,
  resolveGuidePlaylist,
  type GuidePlaylistEntry,
} from "../../../core/guide/playlist";
import { GUIDE_COMPONENTS, type GuideComponentId } from "../../../core/guide/components";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { useReadOnly } from "../../components/ReadOnlyContext";
import { Select } from "../../components/Select";
import { Toggle } from "../../components/Toggle";
import { Section, TabIntro } from "./products/parts";

/**
 * How each mode is described to whoever is about to pick it. Phrased as the
 * effect on customers, because "adminOnly" and "percentage" are names for the
 * mechanism and the question being answered is who ends up in the new studio.
 */
const MODE_COPY: Record<GuideRolloutMode, { label: string; detail: string }> = {
  off: {
    label: "Off",
    detail: "Nobody, including admins. Overrides an admin's own opt-in — the switch to reach for if the guided flow is misbehaving.",
  },
  adminOnly: {
    label: "Admins only",
    detail: "Every customer stays on the wizard. Admins choose per session with the toggle in the studio.",
  },
  percentage: {
    label: "A share of customers",
    detail: "A sticky slice of customers, picked by book so nobody switches flow mid-book. Admins still choose for themselves.",
  },
  on: {
    label: "Everyone",
    detail: "Every customer gets the guided studio unless they explicitly ask for the wizard.",
  },
};

/** The three states of a playlist entry's skippability, including "inherit". */
const SKIP_OPTIONS = [
  { value: "inherit", label: "Catalog default" },
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
];

export function GuideTab() {
  const stored = useAppConfigStore((s) => s.guide);
  const save = useAppConfigStore((s) => s.saveGuide);
  const readOnly = useReadOnly();

  const [draft, setDraft] = useState<GuideConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Follow the live document while the admin has no unsaved edits, so a change
  // made in another tab or by another owner shows up here instead of being
  // silently overwritten by a stale draft on the next save.
  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const entries = draft.playlist.entries;

  /**
   * The warnings, and the order the guide will actually run.
   *
   * Both are computed from the NORMALIZED draft rather than the raw one, because
   * that is what the server will store: normalization repairs a dependency
   * violation by moving the entry down, so linting the raw draft would report a
   * problem that saving fixes on its own. The lint that survives normalization is
   * the lint worth showing.
   */
  const { problems, resolved } = useMemo(() => {
    const normalized = normalizeGuidePlaylist(draft.playlist);
    return { problems: lintGuidePlaylist(normalized), resolved: resolveGuidePlaylist(normalized) };
  }, [draft.playlist]);

  const setRollout = (patch: Partial<GuideConfig["rollout"]>) => {
    setDraft((d) => ({ ...d, rollout: { ...d.rollout, ...patch } }));
    setDirty(true);
  };

  const setEntries = (next: GuidePlaylistEntry[]) => {
    setDraft((d) => ({ ...d, playlist: { ...d.playlist, entries: next } }));
    setDirty(true);
  };

  const patchEntry = (id: GuideComponentId, patch: Partial<GuidePlaylistEntry>) => {
    setEntries(entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    const [lifted] = next.splice(index, 1);
    next.splice(target, 0, lifted!);
    setEntries(next);
  };

  const setSkippable = (id: GuideComponentId, choice: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const next = { ...entry };
    // Absent means "whatever the catalog says", which is a third state rather
    // than a default value — so clearing it has to delete the key, not write the
    // catalog's current answer into the document. Writing it would freeze this
    // component's skippability at today's value and silently ignore a later
    // change in code.
    if (choice === "inherit") delete next.skippable;
    else next.skippable = choice === "optional";
    setEntries(entries.map((e) => (e.id === id ? next : e)));
  };

  const setTitle = (id: GuideComponentId, value: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const next = { ...entry };
    if (value.trim()) next.title = value;
    else delete next.title;
    setEntries(entries.map((e) => (e.id === id ? next : e)));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await save(draft);
      setDirty(false);
      toast.success("Guided studio settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const onResetPlaylist = () => {
    setDraft((d) => ({ ...d, playlist: createDefaultGuidePlaylist() }));
    setDirty(true);
  };

  const shipped = createDefaultGuideConfig();
  const playlistIsDefault =
    JSON.stringify(draft.playlist) === JSON.stringify(shipped.playlist);

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            The model that reads what a reader types is the <strong>Guide turn
            interpretation</strong> step in Models &amp; pricing; its wording is{" "}
            <strong>guideInterpret/turn</strong> in Prompts. What each question means,
            and what it depends on, is fixed in code — this tab decides who sees the
            flow and in what order it asks.
          </>
        }
      >
        The guided studio is the chat-led alternative to the step-by-step wizard: it
        asks for the story, the cast and the art in conversation, and shows the book
        beside it. Rollout changes take effect on the reader&apos;s next page load.
      </TabIntro>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {!readOnly && (
          <>
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(stored);
                  setDirty(false);
                }}
              >
                Discard
              </Button>
            )}
            <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
              Save changes
            </Button>
          </>
        )}
      </div>

      <Section
        title="Who gets the guided studio"
        hint={describeGuideRollout(draft.rollout)}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {GUIDE_ROLLOUT_MODES.map((mode) => {
            const active = draft.rollout.mode === mode;
            const copy = MODE_COPY[mode];
            return (
              <button
                key={mode}
                type="button"
                disabled={readOnly}
                onClick={() => setRollout({ mode })}
                className={[
                  "rounded-xl2 px-3.5 py-3 text-left ring-1 ring-inset transition",
                  active
                    ? "bg-brand-50 ring-brand-300"
                    : "bg-white ring-ink-100 hover:ring-ink-200",
                  readOnly && "cursor-default",
                  mode === "off" && active && "bg-amber-50 ring-amber-300",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "size-3.5 shrink-0 rounded-full ring-1 ring-inset",
                      active ? "bg-brand-600 ring-brand-600" : "bg-white ring-ink-300",
                      mode === "off" && active && "bg-amber-500 ring-amber-500",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  <span className="text-sm font-semibold text-ink-800">{copy.label}</span>
                </div>
                <p className="mt-1 pl-5.5 text-[11px] leading-relaxed text-ink-500">
                  {copy.detail}
                </p>
              </button>
            );
          })}
        </div>

        {draft.rollout.mode === "percentage" && (
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr] sm:items-start">
            <Field label="Share of customers">
              <Input
                type="number"
                min={0}
                max={100}
                value={draft.rollout.percent}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  setRollout({
                    percent: Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0,
                  });
                }}
              />
            </Field>
            <p className="text-[11px] leading-relaxed text-ink-400 sm:pt-8">
              Each book is assigned a bucket from its own id, so a reader keeps the same
              flow on every visit and raising this number only ever adds books — it never
              moves a half-finished one back to the wizard. Lowering it does not pull a
              book out of the guided studio either, so a ramp is only reversible with{" "}
              <strong>Off</strong>.
            </p>
          </div>
        )}
      </Section>

      <Section
        title="What the guide asks, and in what order"
        hint="Drag-free reordering: move a question up or down, retitle it, make it optional, or switch it off entirely. Questions that depend on another are moved below it when you save."
        action={
          !readOnly && !playlistIsDefault ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw className="size-3.5" />}
              onClick={onResetPlaylist}
            >
              Reset order
            </Button>
          ) : undefined
        }
      >
        {problems.length > 0 && (
          <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2.5 ring-1 ring-inset ring-amber-200">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              <TriangleAlert className="size-3.5" />
              Worth a look before saving
            </div>
            {problems.map((problem) => (
              <p key={problem} className="text-[11px] leading-relaxed text-amber-800">
                {problem}
              </p>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          {entries.map((entry, index) => {
            const component = GUIDE_COMPONENTS[entry.id];
            const skipChoice =
              entry.skippable === undefined
                ? "inherit"
                : entry.skippable
                  ? "optional"
                  : "required";
            return (
              <div
                key={entry.id}
                className={[
                  "rounded-lg bg-white px-3 py-2.5 ring-1 ring-inset transition",
                  entry.enabled ? "ring-ink-100" : "bg-ink-50/60 ring-ink-100",
                ].join(" ")}
              >
                <div className="flex items-start gap-2.5">
                  {!readOnly && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label={`Move ${component.title} earlier`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        className="rounded p-0.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${component.title} later`}
                        disabled={index === entries.length - 1}
                        onClick={() => move(index, 1)}
                        className="rounded p-0.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-ink-800">
                        {entry.title ?? component.title}
                      </span>
                      {entry.title && (
                        <span className="text-[10px] text-ink-400">
                          renamed from &ldquo;{component.title}&rdquo;
                        </span>
                      )}
                      {component.terminal && (
                        <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500">
                          ends the flow
                        </span>
                      )}
                      {component.effect && (
                        <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-600">
                          generates
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed text-ink-500">{component.purpose}</p>
                    {component.requires.length > 0 && (
                      <p className="text-[10px] text-ink-400">
                        Needs{" "}
                        {component.requires
                          .map((required) => GUIDE_COMPONENTS[required].title)
                          .join(", ")}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Toggle
                      checked={entry.enabled}
                      onChange={(enabled) => patchEntry(entry.id, { enabled })}
                      label={`${component.title} enabled`}
                    />
                  </div>
                </div>

                {entry.enabled && (
                  <div className="mt-2 grid gap-2 border-t border-ink-100 pt-2 sm:grid-cols-[1fr_11rem]">
                    <Input
                      value={entry.title ?? ""}
                      placeholder={component.title}
                      onChange={(e) => setTitle(entry.id, e.target.value)}
                      className="h-9 text-xs"
                    />
                    <Select
                      options={SKIP_OPTIONS.map((option) =>
                        option.value === "inherit"
                          ? {
                              ...option,
                              label: `Catalog default (${component.skippable ? "optional" : "required"})`,
                            }
                          : option,
                      )}
                      value={skipChoice}
                      onChange={(e) => setSkippable(entry.id, e.target.value)}
                      className="h-9 text-xs"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="The flow this produces"
        hint="What a reader will be asked, in order, once these changes are saved. Disabled questions are gone; their facts keep whatever value the book already has."
      >
        {resolved.length === 0 ? (
          <p className="text-[11px] text-ink-400">
            Every question is switched off, so the guide has nothing to ask.
          </p>
        ) : (
          <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {resolved.map((component, index) => (
              <li key={component.id} className="flex items-center gap-1.5">
                {index > 0 && <span className="text-ink-300">→</span>}
                <span className="rounded-full bg-white px-2 py-1 font-medium text-ink-600 ring-1 ring-inset ring-ink-100">
                  {component.title}
                  {component.skippable && <span className="text-ink-400"> (optional)</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
