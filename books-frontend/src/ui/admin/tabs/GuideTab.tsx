"use client";

/**
 * Configuration → Creative defaults → Guided studio.
 *
 * Each decision on its own panel:
 *
 * - **Rollout**: who gets the Chat studio. A release decision with a blast
 *   radius, so each mode is described by its effect on customers, and `off`
 *   also revokes an admin's own opt-in.
 * - **Facts**: what the Chat must know before it writes the story, and what it
 *   does when the reader never said it.
 * - **Wording**: what the guide says and what its controls are called, with a
 *   live preview of each line.
 * - **Confidence**: how sure the interpreter has to be before it writes a fact.
 * - **Skills, People, Persona & style, Help articles, Language & composer,
 *   Suggestions**: what the chat can do and how it sounds
 *   (`core/config/guideAgent.ts`); every field shows its effect from
 *   `GUIDE_AGENT_META`.
 *
 * The step flow's question playlist is kept on a fifth panel until the step
 * flow is deleted.
 *
 * What is NOT here: the models and prompts (Configuration → Models, Prompts)
 * and the price of a portrait (Sparks), so each kind of setting has one home.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  createDefaultGuideExtraction,
  describeGuideRollout,
  GUIDE_ROLLOUT_MODES,
  type GuideConfig,
  type GuideExtractionConfig,
  type GuideRolloutMode,
} from "../../../core/config/guide";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { useReadOnly } from "../../components/ReadOnlyContext";
import { cn } from "../../lib/cn";
import {
  GuideHelpPanel,
  GuideIdeasPanel,
  GuideLanguagePanel,
  GuidePeoplePanel,
  GuidePersonaPanel,
  GuideSkillsPanel,
} from "./guide/GuideAgentPanels";
import { GuideFactsPanel } from "./guide/GuideFactsPanel";
import { GuideStoryPanel } from "./guide/GuideStoryPanel";
import { GuideStepFlowPanel } from "./guide/GuideStepFlowPanel";
import { GuideWordingPanel } from "./guide/GuideWordingPanel";
import { Section, TabIntro } from "./products/parts";

/**
 * How each mode is described to whoever is about to pick it. Phrased as the
 * effect on customers, because "adminOnly" and "percentage" are names for the
 * mechanism and the question being answered is who ends up in the new studio.
 */
const MODE_COPY: Record<GuideRolloutMode, { label: string; detail: string }> = {
  off: {
    label: "Off",
    detail: "Nobody, including admins. Overrides an admin's own opt-in — the switch to reach for if the Chat is misbehaving.",
  },
  adminOnly: {
    label: "Admins only",
    detail: "Every customer stays on Steps. Admins switch per session with the toggle in the studio.",
  },
  percentage: {
    label: "A share of customers",
    detail: "A sticky slice of customers, picked by book so nobody switches flow mid-book. Admins still choose for themselves.",
  },
  on: {
    label: "Everyone",
    detail: "Every customer gets the Chat studio unless they explicitly ask for Steps.",
  },
};

/** A 0–1 confidence as the percentage an admin is actually thinking in. */
function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * The extraction knobs, described by what going wrong looks like.
 *
 * Each detail line names the failure rather than the mechanism, because the
 * mechanism ("confidence floor") is the part that is already in the label and the
 * failure is the part nobody can guess. All five were constants in the pipeline
 * until now, so the shipped numbers are the ones that were never measured — this
 * page exists so the next set can be.
 */
const EXTRACTION_FIELDS: {
  key: string;
  label: string;
  detail: string;
  min: number;
  max: number;
  step: number;
  read: (config: GuideExtractionConfig) => number;
  write: (config: GuideExtractionConfig, value: number) => GuideExtractionConfig;
}[] = [
  {
    key: "floor",
    label: "Ignore facts less sure than",
    detail:
      "Below this, a fact is not written at all. Raise it and the guide asks more questions; lower it and it starts acting on things the parent only implied.",
    min: 0,
    max: 0.9,
    step: 0.05,
    read: (c) => c.thresholds.floor,
    write: (c, floor) => ({ ...c, thresholds: { ...c.thresholds, floor } }),
  },
  {
    key: "readBack",
    label: "Say it back when less sure than",
    detail:
      "The guide names the value out loud so a mishearing is corrected in the next breath rather than found after the pictures are drawn. Costs a clause in the reply.",
    min: 0,
    max: 1,
    step: 0.05,
    read: (c) => c.thresholds.readBack,
    write: (c, readBack) => ({ ...c, thresholds: { ...c.thresholds, readBack } }),
  },
  {
    key: "overwrite",
    label: "Ask before changing, unless surer than",
    detail:
      "Only applies to facts already decided. Filling an empty answer wrongly is cheap; overwriting a name the cast sheets were drawn from is not, so this should sit high.",
    min: 0,
    max: 1,
    step: 0.05,
    read: (c) => c.thresholds.overwrite,
    write: (c, overwrite) => ({ ...c, thresholds: { ...c.thresholds, overwrite } }),
  },
  {
    key: "repairAttempts",
    label: "Second attempts when the book refuses a fact",
    detail:
      "Most failures are a shape the validator won't take, not a misunderstanding — showing the model the objection usually fixes it. Each attempt costs a round trip the parent waits through. 0 disables.",
    min: 0,
    max: 3,
    step: 1,
    read: (c) => c.repairAttempts,
    write: (c, repairAttempts) => ({ ...c, repairAttempts }),
  },
  {
    key: "temperature",
    label: "Interpreter temperature",
    detail:
      "Leave at 0 unless you are measuring something. This step is reading, not writing; variety here means the same sentence is read differently on different days.",
    min: 0,
    max: 1,
    step: 0.1,
    read: (c) => c.temperature,
    write: (c, temperature) => ({ ...c, temperature }),
  },
  {
    key: "maxMessageChars",
    label: "Longest message the guide will read",
    detail:
      "Must stay above 40,000 if parents are invited to paste their own story — that is what the story slot accepts, and a shorter cap rejects the message before it is read.",
    min: 500,
    max: 50_000,
    step: 500,
    read: (c) => c.maxMessageChars,
    write: (c, maxMessageChars) => ({ ...c, maxMessageChars }),
  },
];

const PANELS = [
  { id: "rollout", label: "Rollout" },
  { id: "story", label: "Story options" },
  { id: "skills", label: "Skills" },
  { id: "people", label: "People" },
  { id: "persona", label: "Persona & style" },
  { id: "help", label: "Help articles" },
  { id: "language", label: "Language & composer" },
  { id: "ideas", label: "Suggestions" },
  { id: "facts", label: "Facts" },
  { id: "wording", label: "Wording" },
  { id: "confidence", label: "Confidence" },
  { id: "steps", label: "Step flow" },
] as const;

type PanelId = (typeof PANELS)[number]["id"];

export function GuideTab() {
  const stored = useAppConfigStore((s) => s.guide);
  const save = useAppConfigStore((s) => s.saveGuide);
  const readOnly = useReadOnly();

  const [draft, setDraft] = useState<GuideConfig>(stored);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<PanelId>("rollout");

  // Follow the live document while the admin has no unsaved edits, so a change
  // made in another tab or by another owner shows up here instead of being
  // silently overwritten by a stale draft on the next save.
  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const edit = (patch: Partial<GuideConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
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

  return (
    <div className="space-y-5">
      <TabIntro />
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 bg-canvas/90 px-1 py-2 backdrop-blur">
        <nav className="flex gap-1 overflow-x-auto rounded-full bg-ink-100/70 p-1 [scrollbar-width:none]" role="tablist">
          {PANELS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={panel === item.id}
              onClick={() => setPanel(item.id)}
              className={cn(
                "relative shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                panel === item.id ? "text-ink-900" : "text-ink-500 hover:text-ink-800",
              )}
            >
              {panel === item.id && (
                <motion.span
                  layoutId="guide-admin-panel"
                  className="absolute inset-0 rounded-full bg-white shadow-soft"
                  transition={{ duration: 0.2 }}
                />
              )}
              <span className="relative">{item.label}</span>
            </button>
          ))}
        </nav>
        {!readOnly && (
          <div className="flex items-center gap-2">
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
          </div>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={panel}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16 }}
        >
          {panel === "rollout" && (
            <RolloutPanel
              rollout={draft.rollout}
              onChange={(rollout) => edit({ rollout })}
              readOnly={readOnly}
            />
          )}
          {panel === "story" && (
            <GuideStoryPanel brief={draft.brief} onChange={(brief) => edit({ brief })} readOnly={readOnly} />
          )}
          {panel === "skills" && (
            <GuideSkillsPanel agent={draft.agent} onChange={(agent) => edit({ agent })} readOnly={readOnly} />
          )}
          {panel === "people" && (
            <GuidePeoplePanel agent={draft.agent} onChange={(agent) => edit({ agent })} readOnly={readOnly} />
          )}
          {panel === "persona" && (
            <GuidePersonaPanel agent={draft.agent} onChange={(agent) => edit({ agent })} readOnly={readOnly} />
          )}
          {panel === "help" && (
            <GuideHelpPanel agent={draft.agent} onChange={(agent) => edit({ agent })} readOnly={readOnly} />
          )}
          {panel === "language" && (
            <GuideLanguagePanel agent={draft.agent} onChange={(agent) => edit({ agent })} readOnly={readOnly} />
          )}
          {panel === "ideas" && (
            <GuideIdeasPanel agent={draft.agent} onChange={(agent) => edit({ agent })} readOnly={readOnly} />
          )}
          {panel === "facts" && (
            <Section
              title="What the Chat needs before the story"
              hint="Required facts are asked for until they are known. The rest are asked once, in the first question, or derived."
            >
              <GuideFactsPanel facts={draft.facts} onChange={(facts) => edit({ facts })} readOnly={readOnly} />
            </Section>
          )}
          {panel === "wording" && (
            <Section
              title="What the guide says"
              hint="Blank uses the shipped wording. In other chat languages the guide phrases the meaning written here and keeps names exactly as typed."
            >
              <GuideWordingPanel wording={draft.wording} onChange={(wording) => edit({ wording })} readOnly={readOnly} />
            </Section>
          )}
          {panel === "confidence" && (
            <ConfidencePanel
              extraction={draft.extraction}
              onChange={(extraction) => edit({ extraction })}
              readOnly={readOnly}
            />
          )}
          {panel === "steps" && (
            <Section
              title="Step flow questions"
              hint="Only the step-based guide reads this. The Chat studio asks from the Facts panel."
            >
              <GuideStepFlowPanel
                playlist={draft.playlist}
                onChange={(playlist) => edit({ playlist })}
                readOnly={readOnly}
              />
            </Section>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function RolloutPanel({
  rollout,
  onChange,
  readOnly,
}: {
  rollout: GuideConfig["rollout"];
  onChange: (rollout: GuideConfig["rollout"]) => void;
  readOnly: boolean;
}) {
  return (
    <Section title="Who gets the Chat studio" hint={describeGuideRollout(rollout)}>
      <div className="grid gap-2 sm:grid-cols-2">
        {GUIDE_ROLLOUT_MODES.map((mode) => {
          const active = rollout.mode === mode;
          const copy = MODE_COPY[mode];
          const off = mode === "off";
          return (
            <button
              key={mode}
              type="button"
              disabled={readOnly}
              onClick={() => onChange({ ...rollout, mode })}
              className={cn(
                "rounded-xl2 px-4 py-3.5 text-left ring-1 ring-inset transition",
                active
                  ? off
                    ? "bg-amber-50 ring-amber-300"
                    : "bg-white shadow-soft ring-ink-900"
                  : "bg-white ring-ink-100 hover:ring-ink-300",
                readOnly && "cursor-default",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-3.5 shrink-0 rounded-full ring-1 ring-inset transition",
                    active ? (off ? "bg-amber-500 ring-amber-500" : "bg-ink-900 ring-ink-900") : "bg-white ring-ink-300",
                  )}
                />
                <span className="text-sm font-semibold text-ink-900">{copy.label}</span>
              </div>
              <p className="mt-1 pl-5.5 text-xs leading-relaxed text-ink-500">{copy.detail}</p>
            </button>
          );
        })}
      </div>

      {rollout.mode === "percentage" && (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr] sm:items-start">
          <Field label="Share of customers">
            <Input
              type="number"
              min={0}
              max={100}
              value={rollout.percent}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                onChange({ ...rollout, percent: Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0 });
              }}
            />
          </Field>
          <p className="text-[11px] leading-relaxed text-ink-400 sm:pt-8">
            Each book is assigned a bucket from its own id, so a reader keeps the same flow on every visit and
            raising this number only ever adds books. Lowering it does not pull a book out of the Chat studio
            either, so a ramp is only reversible with <strong>Off</strong>.
          </p>
        </div>
      )}
    </Section>
  );
}

function ConfidencePanel({
  extraction,
  onChange,
  readOnly,
}: {
  extraction: GuideExtractionConfig;
  onChange: (next: GuideExtractionConfig) => void;
  readOnly: boolean;
}) {
  const isDefault = JSON.stringify(extraction) === JSON.stringify(createDefaultGuideExtraction());
  return (
    <Section
      title="How the chat reads what a parent types"
      hint="The interpreter turns a sentence into facts about the book. These settings decide how sure it has to be before acting, and how hard it tries when the book refuses what it proposed."
      action={
        !readOnly && !isDefault ? (
          <Button variant="ghost" onClick={() => onChange(createDefaultGuideExtraction())}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {EXTRACTION_FIELDS.map((field) => (
          <Field key={field.key} label={field.label}>
            <Input
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              disabled={readOnly}
              value={field.read(extraction)}
              onChange={(e) => {
                const parsed = Number.parseFloat(e.target.value);
                onChange(
                  field.write(
                    extraction,
                    Number.isFinite(parsed)
                      ? Math.min(field.max, Math.max(field.min, parsed))
                      : field.read(createDefaultGuideExtraction()),
                  ),
                );
              }}
            />
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{field.detail}</p>
          </Field>
        ))}
      </div>
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
        As set: the guide ignores anything it is less than <strong>{percent(extraction.thresholds.floor)}</strong>{" "}
        sure of, says a fact back when it is under <strong>{percent(extraction.thresholds.readBack)}</strong> sure,
        and asks before <em>changing</em> something already decided unless it is at least{" "}
        <strong>{percent(extraction.thresholds.overwrite)}</strong> sure.
        {extraction.thresholds.overwrite < extraction.thresholds.readBack && (
          <span className="font-semibold text-amber-700">
            {" "}
            That ordering is unusual: it will change settled facts more readily than it mentions new ones.
          </span>
        )}
      </p>
    </Section>
  );
}
