"use client";

/**
 * @legacy guide-v2 L5
 *
 * The step flow's question playlist: order, titles, opening wording and
 * skippability of the components the old guided chat walked through. The Chat
 * studio asks from fact policies instead (see the Facts panel), so this panel
 * is only read by the step-based guide and goes when it does.
 */
import { useMemo } from "react";
import { ArrowDown, ArrowUp, RotateCcw, TriangleAlert } from "lucide-react";
import {
  createDefaultGuidePlaylist,
  lintGuidePlaylist,
  normalizeGuidePlaylist,
  resolveGuidePlaylist,
  type GuidePlaylist,
  type GuidePlaylistEntry,
} from "../../../../core/guide/playlist";
import {
  componentTakesAnswers,
  GUIDE_COMPONENTS,
  type GuideComponentId,
} from "../../../../core/guide/components";
import { Button } from "../../../components/Button";
import { Input, Textarea } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { Section } from "../products/parts";

/** The three states of a playlist entry's skippability, including "inherit". */
const SKIP_OPTIONS = [
  { value: "inherit", label: "Catalog default" },
  { value: "required", label: "Required" },
  { value: "optional", label: "Optional" },
];

export function GuideStepFlowPanel({
  playlist,
  onChange,
  readOnly,
}: {
  playlist: GuidePlaylist;
  onChange: (next: GuidePlaylist) => void;
  readOnly: boolean;
}) {
  const entries = playlist.entries;

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
    const normalized = normalizeGuidePlaylist(playlist);
    return { problems: lintGuidePlaylist(normalized), resolved: resolveGuidePlaylist(normalized) };
  }, [playlist]);

  const setEntries = (next: GuidePlaylistEntry[]) => {
    onChange({ ...playlist, entries: next });
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

  const setAsk = (id: GuideComponentId, value: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    const next = { ...entry };
    if (value.trim()) next.ask = value;
    else delete next.ask;
    setEntries(entries.map((e) => (e.id === id ? next : e)));
  };

  const playlistIsDefault = JSON.stringify(playlist) === JSON.stringify(createDefaultGuidePlaylist());

  return (
    <div className="space-y-6">
      <Section
        title="What the guide asks, and in what order"
        hint="Drag-free reordering: move a question up or down, retitle it, word its opening yourself, make it optional, or switch it off entirely. Questions that depend on another are moved below it when you save."
        action={
          !readOnly && !playlistIsDefault ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw className="size-3.5" />}
              onClick={() => onChange(createDefaultGuidePlaylist())}
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
                    {componentTakesAnswers(component) && (
                      <div className="space-y-1 sm:col-span-2">
                        <Textarea
                          value={entry.ask ?? ""}
                          placeholder="Opening question — leave blank for the guide's own wording"
                          maxLength={400}
                          rows={2}
                          onChange={(e) => setAsk(entry.id, e.target.value)}
                          className="text-xs"
                        />
                        <p className="text-[10px] leading-relaxed text-ink-400">
                          Asked only the first time, while this is still empty. After that the
                          guide names exactly what it&rsquo;s still missing, so it can ask for one
                          child&rsquo;s age rather than repeating the question.
                        </p>
                      </div>
                    )}
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
