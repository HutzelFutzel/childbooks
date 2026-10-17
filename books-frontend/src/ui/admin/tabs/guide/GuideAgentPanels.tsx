"use client";

/**
 * The Chat studio's skills, persona and answers, as dashboard panels.
 *
 * Every field reads its label and hint from {@link GUIDE_AGENT_META}, so the
 * dashboard always says what changes, where a parent would notice, and what to
 * watch out for. The code's floors are shown, not editable: a skill that always
 * confirms shows its confirmation locked on, and a person's age stays required.
 */
import { Fragment, useMemo, useRef, useState } from "react";
import { Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  GUIDE_AGENT_META,
  PERSONA_ADDRESS,
  PERSONA_HUMOR,
  PERSONA_REGISTER,
  STYLE_DETAIL,
  STYLE_LIMITS,
  TURN_LIMITS,
  createDefaultAnswerStyle,
  createDefaultGuideAgentConfig,
  createDefaultGuidePersona,
  normalizePalette,
  type AnswerStyle,
  type GuideAgentConfig,
  type GuideHelpArticleSetting,
  type GuidePersona,
  type PersonaAddress,
} from "../../../../core/config/guideAgent";
import { addressText, examplesText, personaText, styleText } from "../../../../core/guide/agent/compose";
import { DEFAULT_HELP_ARTICLES } from "../../../../core/guide/agent/help";
import { GUIDE_IDEA_IDS } from "../../../../core/guide/agent/ideas";
import { GUIDE_COMMAND_IDS, type GuideCommandId } from "../../../../core/guide/agent/ids";
import { GUIDE_COMMANDS } from "../../../../core/guide/agent/registry";
import { REQUIREMENTS } from "../../../../core/guide/agent/requirements";
import type { CommandArea } from "../../../../core/guide/agent/types";
import en from "../../../../../messages/en.json";
import { Button } from "../../../components/Button";
import { Input, Textarea } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { cn } from "../../../lib/cn";
import { ImpactNote, Section } from "../products/parts";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { GuideAvatar } from "../../../guide/chat/GuideAvatar";

type Change = (next: GuideAgentConfig) => void;

interface PanelProps {
  agent: GuideAgentConfig;
  onChange: Change;
  readOnly: boolean;
}

// --- Shared pieces ------------------------------------------------------------------

function meta(path: string) {
  return GUIDE_AGENT_META[path] ?? { label: path, effect: "", appearsIn: "" };
}

/** What changes, where a parent notices, an example and the catch — for one setting. */
function MetaHint({ path }: { path: string }) {
  const info = meta(path);
  return (
    <div className="space-y-1 text-[11px] leading-relaxed text-ink-500">
      {info.effect && <p>{info.effect}</p>}
      {info.appearsIn && (
        <p>
          <span className="font-medium text-ink-600">Shows up in:</span> {info.appearsIn}
        </p>
      )}
      {info.example && (
        <p>
          <span className="font-medium text-ink-600">Example:</span> {info.example}
        </p>
      )}
      {info.caution && <p className="font-medium text-amber-700">{info.caution}</p>}
    </div>
  );
}

function Setting({ path, children, className }: { path: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-sm font-medium text-ink-700">{meta(path).label}</label>
      {children}
      <MetaHint path={path} />
    </div>
  );
}

function ToggleSetting({
  path,
  checked,
  onChange,
  readOnly,
}: {
  path: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl bg-white px-4 py-3 ring-1 ring-ink-100">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-ink-800">{meta(path).label}</p>
        <MetaHint path={path} />
      </div>
      <Toggle checked={checked} disabled={readOnly} onChange={onChange} label={meta(path).label} />
    </div>
  );
}

function NumberSetting({
  path,
  value,
  range,
  step = 1,
  onChange,
  readOnly,
}: {
  path: string;
  value: number;
  range: { min: number; max: number };
  step?: number;
  onChange: (value: number) => void;
  readOnly: boolean;
}) {
  return (
    <Setting path={path}>
      <Input
        type="number"
        min={range.min}
        max={range.max}
        step={step}
        disabled={readOnly}
        value={value}
        onChange={(e) => {
          const parsed = Number.parseFloat(e.target.value);
          if (Number.isFinite(parsed)) onChange(Math.min(range.max, Math.max(range.min, parsed)));
        }}
      />
      <p className="text-[11px] text-ink-400">
        Allowed: {range.min}–{range.max}
      </p>
    </Setting>
  );
}

function ChoiceSetting<T extends string>({
  path,
  value,
  options,
  onChange,
  readOnly,
}: {
  path: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  readOnly: boolean;
}) {
  return (
    <Setting path={path}>
      <Select
        value={value}
        disabled={readOnly}
        options={options}
        onChange={(e) => onChange(e.target.value as T)}
      />
    </Setting>
  );
}

function ResetButton({ onClick, readOnly }: { onClick: () => void; readOnly: boolean }) {
  if (readOnly) return null;
  return (
    <Button variant="ghost" onClick={onClick}>
      <RotateCcw className="size-3.5" />
      Reset to defaults
    </Button>
  );
}

function listText(values: readonly string[]): string {
  return values.join(", ");
}

function parseList(text: string): string[] {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

// --- Skills -------------------------------------------------------------------------

const AREA_LABELS: Record<CommandArea, string> = {
  path: "How the book starts",
  book: "Book details",
  design: "Finished pages",
  pictures: "Page pictures",
  pages: "Pages in the book",
  story: "Story",
  people: "People",
  places: "Places and things",
  style: "Look",
  generation: "Making the book",
  account: "Account and Sparks",
  conversation: "Conversation",
};

/** When in the book's life a skill works: the parent's mental model, read from what it requires. */
type SkillStage = "after" | "before" | "any";

const STAGES: { id: SkillStage; title: string; hint: string }[] = [
  {
    id: "after",
    title: "After the pages are drawn",
    hint: "Changing the finished book: how the pages look, and the pictures. Everything here works on the book as it is now.",
  },
  {
    id: "before",
    title: "While the book is being set up",
    hint: "Story, people and look. These stop working once the pages are being drawn, because changing them would no longer match the pictures.",
  },
  { id: "any", title: "Any time", hint: "Help, going back, and showing parts of the book." },
];

function stageOf(id: GuideCommandId): SkillStage {
  const requires = GUIDE_COMMANDS[id].requires;
  if (requires.includes("pagesStarted")) return "after";
  if (requires.includes("notLocked")) return "before";
  return "any";
}

function skillName(id: GuideCommandId): string {
  const words = id.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function GuideSkillsPanel({ agent, onChange, readOnly }: PanelProps) {
  const defaults = createDefaultGuideAgentConfig();
  const [query, setQuery] = useState("");
  // One block per stage, and inside it one card per area: "what can a parent do to the finished book" in one place.
  const areas = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (id: GuideCommandId) => {
      if (!needle) return true;
      const def = GUIDE_COMMANDS[id];
      return [skillName(id), def.help, ...def.examples, AREA_LABELS[def.area]].some((text) => text.toLowerCase().includes(needle));
    };
    const out: { stage: SkillStage; area: CommandArea; ids: GuideCommandId[]; first: boolean }[] = [];
    for (const stage of STAGES) {
      const byArea = new Map<CommandArea, GuideCommandId[]>();
      for (const id of GUIDE_COMMAND_IDS) {
        if (stageOf(id) !== stage.id || !matches(id)) continue;
        const area = GUIDE_COMMANDS[id].area;
        byArea.set(area, [...(byArea.get(area) ?? []), id]);
      }
      [...byArea.entries()].forEach(([area, ids], index) => out.push({ stage: stage.id, area, ids, first: index === 0 }));
    }
    return out;
  }, [query]);
  const setSkill = (id: GuideCommandId, patch: Partial<GuideAgentConfig["skills"][GuideCommandId]>) =>
    onChange({ ...agent, skills: { ...agent.skills, [id]: { ...agent.skills[id], ...patch } } });
  const setTurn = (patch: Partial<GuideAgentConfig["turn"]>) => onChange({ ...agent, turn: { ...agent.turn, ...patch } });
  const off = GUIDE_COMMAND_IDS.filter((id) => !agent.skills[id]?.enabled).length;

  return (
    <div className="space-y-8">
      <Section
        title="Skills in the chat"
        hint="What a parent can ask the chat to do before the pages start. Each skill checks what it needs first and explains the missing step instead of failing."
      >
        <ToggleSetting path="enabled" checked={agent.enabled} onChange={(enabled) => onChange({ ...agent, enabled })} readOnly={readOnly} />
      </Section>

      <Section
        title="Per message"
        hint="How much one message may do, and how confirmations behave."
        action={
          <ResetButton readOnly={readOnly} onClick={() => onChange({ ...agent, turn: defaults.turn })} />
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <NumberSetting
            path="turn.maxCommands"
            value={agent.turn.maxCommands}
            range={TURN_LIMITS.maxCommands}
            onChange={(maxCommands) => setTurn({ maxCommands })}
            readOnly={readOnly}
          />
          <NumberSetting
            path="turn.commandFloor"
            value={agent.turn.commandFloor}
            range={TURN_LIMITS.commandFloor}
            step={0.05}
            onChange={(commandFloor) => setTurn({ commandFloor })}
            readOnly={readOnly}
          />
          <NumberSetting
            path="turn.confirmTtlMinutes"
            value={agent.turn.confirmTtlMinutes}
            range={TURN_LIMITS.confirmTtlMinutes}
            onChange={(confirmTtlMinutes) => setTurn({ confirmTtlMinutes })}
            readOnly={readOnly}
          />
          <NumberSetting
            path="turn.autoSpendSparks"
            value={agent.turn.autoSpendSparks}
            range={TURN_LIMITS.autoSpendSparks}
            onChange={(autoSpendSparks) => setTurn({ autoSpendSparks })}
            readOnly={readOnly}
          />
          <NumberSetting
            path="turn.pictureBatchMax"
            value={agent.turn.pictureBatchMax}
            range={TURN_LIMITS.pictureBatchMax}
            onChange={(pictureBatchMax) => setTurn({ pictureBatchMax })}
            readOnly={readOnly}
          />
          <NumberSetting
            path="turn.refreshBatchMax"
            value={agent.turn.refreshBatchMax}
            range={TURN_LIMITS.refreshBatchMax}
            onChange={(refreshBatchMax) => setTurn({ refreshBatchMax })}
            readOnly={readOnly}
          />
          <NumberSetting
            path="turn.extrasPagesMax"
            value={agent.turn.extrasPagesMax}
            range={TURN_LIMITS.extrasPagesMax}
            onChange={(extrasPagesMax) => setTurn({ extrasPagesMax })}
            readOnly={readOnly}
          />
          <div className="sm:pt-6">
            <ToggleSetting
              path="turn.typedYes"
              checked={agent.turn.typedYes}
              onChange={(typedYes) => setTurn({ typedYes })}
              readOnly={readOnly}
            />
          </div>
        </div>
        <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          As set: one message runs up to <strong>{agent.turn.maxCommands}</strong> skills, only ones the chat is at
          least <strong>{Math.round(agent.turn.commandFloor * 100)}%</strong> sure the parent asked for. Whatever the
          settings, one message starts at most one paid step, asks at most one question and shows at most one
          confirmation card, which stops working after <strong>{agent.turn.confirmTtlMinutes}</strong> minutes.{" "}
          {agent.turn.autoSpendSparks > 0 ? (
            <>
              Typed picture changes costing up to <strong>{agent.turn.autoSpendSparks}</strong> Sparks start at once.
            </>
          ) : (
            <>Typed picture changes always show their priced button.</>
          )}{" "}
          On the finished pages one message changes up to <strong>{agent.turn.pictureBatchMax}</strong> pictures, updates
          up to <strong>{agent.turn.refreshBatchMax}</strong> out-of-date pictures, and decorates or clears up to{" "}
          <strong>{agent.turn.extrasPagesMax}</strong> pages.
        </p>
      </Section>

      <Section title={meta("skills").label} hint={meta("skills").effect}>
        {meta("skills").caution && <ImpactNote>{meta("skills").caution}</ImpactNote>}
        {off > 0 && (
          <p className="text-xs text-ink-500">
            {off} of {GUIDE_COMMAND_IDS.length} skills are off.
          </p>
        )}
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a skill: “page color”, “umbrella”, “undo”…"
          aria-label="Find a skill"
        />
        {areas.length === 0 && <p className="text-sm text-ink-500">No skill matches “{query}”.</p>}
        <div className="space-y-5">
          {areas.map(({ stage, area, ids, first }) => (
            <Fragment key={`${stage}:${area}`}>
              {first && (
                <div className="pt-2">
                  <h3 className="text-sm font-semibold text-ink-900">{STAGES.find((x) => x.id === stage)!.title}</h3>
                  <p className="text-xs text-ink-500">{STAGES.find((x) => x.id === stage)!.hint}</p>
                </div>
              )}
            <div className="overflow-hidden rounded-xl bg-white ring-1 ring-ink-100">
              <div className="grid grid-cols-[1fr_5rem_7rem] gap-4 border-b border-ink-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                <span>{AREA_LABELS[area]}</span>
                <span>On</span>
                <span>Always confirm</span>
              </div>
              {ids.map((id, index) => {
                const def = GUIDE_COMMANDS[id];
                const setting = agent.skills[id] ?? { enabled: true, confirm: false };
                return (
                  <div
                    key={id}
                    className={cn(
                      "grid grid-cols-[1fr_5rem_7rem] items-start gap-4 px-4 py-3",
                      index > 0 && "border-t border-ink-100",
                      !setting.enabled && "bg-ink-50/60",
                    )}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-semibold text-ink-900">{skillName(id)}</p>
                        {def.paid && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            Uses Sparks, always a button
                          </span>
                        )}
                        {def.alwaysConfirm && (
                          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600">
                            Always confirms
                          </span>
                        )}
                        {def.impact && !def.alwaysConfirm && (
                          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600">
                            Confirms when it would remove something
                          </span>
                        )}
                        {stageOf(id) === "after" && !def.paid && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Free, nothing is redrawn
                          </span>
                        )}
                        {def.aimsAtPages && (
                          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-600">
                            Understands “page 18”
                          </span>
                        )}
                      </div>
                      <p className="text-xs leading-relaxed text-ink-600">{def.help}</p>
                      {def.examples[0] && (
                        <p className="text-[11px] text-ink-400">
                          Parents say: “{def.examples.slice(0, 2).join("”, “")}”
                        </p>
                      )}
                      {def.requires.length > 0 && (
                        <p className="text-[11px] text-ink-400">
                          Needs first: {def.requires.map((r) => REQUIREMENTS[r].label.toLowerCase()).join("; ")}
                        </p>
                      )}
                    </div>
                    <Toggle
                      checked={setting.enabled}
                      disabled={readOnly}
                      onChange={(enabled) => setSkill(id, { enabled })}
                      label={`${skillName(id)} on`}
                    />
                    <Toggle
                      checked={def.alwaysConfirm ? true : setting.confirm}
                      disabled={readOnly || def.alwaysConfirm || def.paid}
                      onChange={(confirm) => setSkill(id, { confirm })}
                      label={`${skillName(id)} always confirm`}
                    />
                  </div>
                );
              })}
            </div>
            </Fragment>
          ))}
        </div>
      </Section>

      <ColorNames agent={agent} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}

// --- Color names ---------------------------------------------------------------------

/** "sunset orange = #ff7a3d", one per line. */
function colorLines(colors: GuideAgentConfig["palette"]["colors"]): string {
  return colors.map((color) => `${color.name} = ${color.hex}`).join("\n");
}

function parseColorLines(text: string): GuideAgentConfig["palette"]["colors"] {
  return normalizePalette({
    colors: text
      .split("\n")
      .map((line) => line.split("=").map((part) => part.trim()))
      .filter((parts) => parts.length === 2)
      .map(([name, hex]) => ({ name, hex })),
  }).colors;
}

function ColorNames({ agent, onChange, readOnly }: PanelProps) {
  const palette = agent.palette;
  const [colors, setColors] = useState(() => colorLines(palette.colors));
  const [hidden, setHidden] = useState(() => listText(palette.hidden));
  const set = (patch: Partial<GuideAgentConfig["palette"]>) => onChange({ ...agent, palette: { ...palette, ...patch } });
  const parsed = parseColorLines(colors);
  const lines = colors.split("\n").filter((line) => line.trim()).length;
  return (
    <Section
      title="Color names"
      hint="The colors a parent can name for text, pages, shapes and bubbles. Hex codes always work."
      action={
        <ResetButton
          readOnly={readOnly}
          onClick={() => {
            setColors("");
            setHidden("");
            onChange({ ...agent, palette: createDefaultGuideAgentConfig().palette });
          }}
        />
      }
    >
      <Setting path="palette.colors">
        <Textarea
          rows={5}
          value={colors}
          disabled={readOnly}
          placeholder={"sunset orange = #ff7a3d\nsky = #7ec8e3"}
          onChange={(e) => {
            // Into the draft on every keystroke, not on blur: a Save pressed with the cursor still in
            // the box (Enter, a shortcut, a script) must not quietly leave the names out.
            setColors(e.target.value);
            set({ colors: parseColorLines(e.target.value) });
          }}
        />
        <p className="text-[11px] text-ink-400">
          One per line as <code>name = #rrggbb</code>. {parsed.length} saved
          {lines > parsed.length ? `; ${lines - parsed.length} line${lines - parsed.length === 1 ? " is" : "s are"} not valid and will be dropped` : ""}.
        </p>
        {parsed.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {parsed.map((color) => (
              <span key={color.name} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-ink-700 ring-1 ring-ink-100">
                <span className="size-3.5 rounded-full ring-1 ring-ink-200" style={{ backgroundColor: color.hex }} />
                {color.name}
              </span>
            ))}
          </div>
        )}
      </Setting>
      <Setting path="palette.hidden">
        <Input
          value={hidden}
          disabled={readOnly}
          placeholder="gold, lila"
          onChange={(e) => {
            setHidden(e.target.value);
            set({ hidden: normalizePalette({ hidden: parseList(e.target.value) }).hidden });
          }}
        />
        <p className="text-[11px] text-ink-400">Comma-separated built-in names, English or German.</p>
      </Setting>
    </Section>
  );
}

// --- People -------------------------------------------------------------------------

export function GuidePeoplePanel({ agent, onChange, readOnly }: PanelProps) {
  const people = agent.people;
  const set = (patch: Partial<GuideAgentConfig["people"]>) => onChange({ ...agent, people: { ...people, ...patch } });
  const optional = [
    { value: "once" as const, label: "Ask once (can be skipped)" },
    { value: "never" as const, label: "Never ask" },
  ];
  return (
    <Section
      title="After a person is added"
      hint="Follow-up questions after “Add a character named Christopher”. The age is required; the rest are optional and a parent can answer “skip”."
      action={
        <ResetButton readOnly={readOnly} onClick={() => onChange({ ...agent, people: createDefaultGuideAgentConfig().people })} />
      }
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <ChoiceSetting
          path="people.age.askWhen"
          value={people.age.askWhen}
          options={[
            { value: "now", label: "Right away" },
            { value: "beforePortraits", label: "Before their portrait" },
          ]}
          onChange={(askWhen) => set({ age: { askWhen } })}
          readOnly={readOnly}
        />
        <ChoiceSetting
          path="people.role.askWhen"
          value={people.role.askWhen}
          options={optional}
          onChange={(askWhen) => set({ role: { askWhen } })}
          readOnly={readOnly}
        />
        <ChoiceSetting
          path="people.look.askWhen"
          value={people.look.askWhen}
          options={optional}
          onChange={(askWhen) => set({ look: { askWhen } })}
          readOnly={readOnly}
        />
      </div>
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
        As set: after “Add Christopher”, the guide{" "}
        {people.age.askWhen === "now" ? "asks his age right away" : "asks his age just before his portrait"}
        {people.role.askWhen === "once" || people.look.askWhen === "once"
          ? `, then asks once about ${[
              people.role.askWhen === "once" ? "who he is in the story" : "",
              people.look.askWhen === "once" ? "how he looks" : "",
            ]
              .filter(Boolean)
              .join(" and ")}. “Skip” moves on and it doesn't ask again.`
          : ", and asks nothing else."}
      </p>
    </Section>
  );
}

// --- Persona and style ----------------------------------------------------------------

const HUMOR_LABELS: Record<(typeof PERSONA_HUMOR)[number], string> = { none: "None", light: "Light", playful: "Playful" };
const REGISTER_LABELS: Record<(typeof PERSONA_REGISTER)[number], string> = {
  casual: "Casual",
  neutral: "Neutral",
  formal: "Formal",
};
const ADDRESS_LABELS: Record<PersonaAddress, string> = {
  informal: "Informal (du, tu, tú)",
  formal: "Formal (Sie, vous, usted)",
};
const DETAIL_LABELS: Record<(typeof STYLE_DETAIL)[number], string> = {
  brief: "Brief",
  balanced: "Balanced",
  thorough: "Thorough",
};

function StyleEditor({
  kind,
  style,
  onChange,
  readOnly,
}: {
  kind: "lines" | "answers";
  style: AnswerStyle;
  onChange: (next: AnswerStyle) => void;
  readOnly: boolean;
}) {
  const p = `style.${kind}`;
  const set = (patch: Partial<AnswerStyle>) => onChange({ ...style, ...patch });
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <ChoiceSetting
        path={`${p}.detail`}
        value={style.detail}
        options={STYLE_DETAIL.map((value) => ({ value, label: DETAIL_LABELS[value] }))}
        onChange={(detail) => set({ detail })}
        readOnly={readOnly}
      />
      <NumberSetting
        path={`${p}.maxSentences`}
        value={style.maxSentences}
        range={STYLE_LIMITS.maxSentences}
        onChange={(maxSentences) => set({ maxSentences })}
        readOnly={readOnly}
      />
      <NumberSetting
        path={`${p}.maxWords`}
        value={style.maxWords}
        range={STYLE_LIMITS.maxWords}
        onChange={(maxWords) => set({ maxWords })}
        readOnly={readOnly}
      />
      <ChoiceSetting
        path={`${p}.directness`}
        value={style.directness}
        options={[
          { value: "answerFirst", label: "Answer first" },
          { value: "contextFirst", label: "Context first" },
        ]}
        onChange={(directness) => set({ directness })}
        readOnly={readOnly}
      />
      <ChoiceSetting
        path={`${p}.questionsPerMessage`}
        value={String(style.questionsPerMessage) as "1" | "2"}
        options={[
          { value: "1", label: "One" },
          { value: "2", label: "Two" },
        ]}
        onChange={(value) => set({ questionsPerMessage: value === "2" ? 2 : 1 })}
        readOnly={readOnly}
      />
      <ChoiceSetting
        path={`${p}.emoji`}
        value={style.emoji}
        options={[
          { value: "never", label: "Never" },
          { value: "rare", label: "Rarely" },
        ]}
        onChange={(emoji) => set({ emoji })}
        readOnly={readOnly}
      />
      <ChoiceSetting
        path={`${p}.exclamations`}
        value={style.exclamations}
        options={[
          { value: "avoid", label: "Avoid" },
          { value: "allowed", label: "Allowed" },
        ]}
        onChange={(exclamations) => set({ exclamations })}
        readOnly={readOnly}
      />
    </div>
  );
}

export function GuidePersonaPanel({ agent, onChange, readOnly }: PanelProps) {
  const persona = agent.persona;
  const set = (patch: Partial<GuidePersona>) => onChange({ ...agent, persona: { ...persona, ...patch } });
  const [overrideLang, setOverrideLang] = useState("");
  const [previewLocale, setPreviewLocale] = useState("de");
  const guideAvatar = useAppConfigStore((s) => s.branding.guideAvatar);
  const uploadAvatar = useAppConfigStore((s) => s.uploadBrandingAsset);
  const removeAvatar = useAppConfigStore((s) => s.removeBrandingAsset);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result);
          const comma = result.indexOf(",");
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await uploadAvatar("guideAvatar", base64, file.type || "image/png", persona.name.trim() || "Guide");
      toast.success("Guide profile picture updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload picture.");
    } finally {
      setUploadingAvatar(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onRemoveAvatar = async () => {
    setUploadingAvatar(true);
    try {
      await removeAvatar("guideAvatar");
      toast.success("Guide profile picture removed (using placeholder).");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove picture.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="space-y-8">
      <Section
        title="Who the guide is"
        hint="The character parents chat with in the studio, and the voice the composer writes from. It never changes what a message says — names, numbers and questions are checked after writing."
        action={
          <ResetButton readOnly={readOnly} onClick={() => onChange({ ...agent, persona: createDefaultGuidePersona() })} />
        }
      >
        <div className="flex flex-col gap-4 rounded-xl bg-white p-4 ring-1 ring-ink-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <GuideAvatar size="lg" url={guideAvatar?.imageUrl ?? null} name={persona.name.trim() || "Guide"} />
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-ink-900">
                  {persona.name.trim() || "Guide"}
                </p>
                {!persona.name.trim() && (
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-500">
                    Placeholder name
                  </span>
                )}
                {!guideAvatar?.imageUrl && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    Placeholder avatar
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-500">
                Shown beside the guide&apos;s messages and on the opening screen. Square PNG, WebP or SVG recommended.
              </p>
            </div>
          </div>
          {!readOnly && (
            <div className="flex shrink-0 items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/webp,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={(e) => void onPickAvatar(e.target.files?.[0])}
              />
              <Button
                variant="secondary"
                size="sm"
                loading={uploadingAvatar}
                leftIcon={<Upload className="size-3.5" />}
                onClick={() => fileRef.current?.click()}
              >
                {guideAvatar?.imageUrl ? "Replace photo" : "Upload photo"}
              </Button>
              {guideAvatar?.imageUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={uploadingAvatar}
                  leftIcon={<Trash2 className="size-3.5" />}
                  onClick={() => void onRemoveAvatar()}
                >
                  Use placeholder
                </Button>
              )}
            </div>
          )}
        </div>
        <ToggleSetting path="persona.enabled" checked={persona.enabled} onChange={(enabled) => set({ enabled })} readOnly={readOnly} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Setting path="persona.name">
            <Input
              value={persona.name}
              placeholder="Guide (default placeholder)"
              disabled={readOnly}
              maxLength={40}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Setting>
          <ChoiceSetting
            path="persona.selfReference"
            value={persona.selfReference}
            options={[
              { value: "never", label: "Never" },
              { value: "sometimes", label: "Sometimes" },
            ]}
            onChange={(selfReference) => set({ selfReference })}
            readOnly={readOnly}
          />
          <Setting path="persona.identity" className="sm:col-span-2">
            <Textarea rows={2} value={persona.identity} disabled={readOnly} maxLength={400} onChange={(e) => set({ identity: e.target.value })} />
          </Setting>
          <Setting path="persona.traits">
            <Input value={listText(persona.traits)} disabled={readOnly} onChange={(e) => set({ traits: parseList(e.target.value) })} />
          </Setting>
          <Setting path="persona.avoid">
            <Input value={listText(persona.avoid)} disabled={readOnly} onChange={(e) => set({ avoid: parseList(e.target.value) })} />
          </Setting>
          <ChoiceSetting
            path="persona.humor"
            value={persona.humor}
            options={PERSONA_HUMOR.map((value) => ({ value, label: HUMOR_LABELS[value] }))}
            onChange={(humor) => set({ humor })}
            readOnly={readOnly}
          />
          <ChoiceSetting
            path="persona.register"
            value={persona.register}
            options={PERSONA_REGISTER.map((value) => ({ value, label: REGISTER_LABELS[value] }))}
            onChange={(register) => set({ register })}
            readOnly={readOnly}
          />
          <ChoiceSetting
            path="persona.address"
            value={persona.address}
            options={PERSONA_ADDRESS.map((value) => ({ value, label: ADDRESS_LABELS[value] }))}
            onChange={(address) => set({ address })}
            readOnly={readOnly}
          />
          <Setting path="persona.addressOverrides">
            <div className="space-y-2">
              {Object.entries(persona.addressOverrides).map(([lang, address]) => (
                <div key={lang} className="flex items-center gap-2">
                  <span className="w-10 text-sm font-medium text-ink-700">{lang}</span>
                  <div className="flex-1">
                    <Select
                      value={address}
                      disabled={readOnly}
                      options={PERSONA_ADDRESS.map((value) => ({ value, label: ADDRESS_LABELS[value] }))}
                      onChange={(e) =>
                        set({ addressOverrides: { ...persona.addressOverrides, [lang]: e.target.value as PersonaAddress } })
                      }
                    />
                  </div>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${lang}`}
                      onClick={() => {
                        const next = { ...persona.addressOverrides };
                        delete next[lang];
                        set({ addressOverrides: next });
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <div className="flex items-center gap-2">
                  <Input
                    className="w-24"
                    placeholder="fr"
                    maxLength={2}
                    value={overrideLang}
                    onChange={(e) => setOverrideLang(e.target.value.toLowerCase().replace(/[^a-z]/g, ""))}
                  />
                  <Button
                    variant="ghost"
                    disabled={overrideLang.length !== 2 || overrideLang in persona.addressOverrides}
                    onClick={() => {
                      set({
                        addressOverrides: {
                          ...persona.addressOverrides,
                          [overrideLang]: persona.address === "informal" ? "formal" : "informal",
                        },
                      });
                      setOverrideLang("");
                    }}
                  >
                    <Plus className="size-3.5" />
                    Add exception
                  </Button>
                </div>
              )}
            </div>
          </Setting>
        </div>
        {persona.address === "formal" && (
          <ImpactNote>
            The product default is informal: the guide says “du”, not “Sie”, and talks like a friend. Formal makes every
            language with the distinction sound distant.
          </ImpactNote>
        )}
      </Section>

      <Section title={meta("persona.examples").label} hint={meta("persona.examples").effect}>
        <div className="space-y-2">
          {persona.examples.map((example, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
              <Input
                placeholder="Meaning, in plain English"
                value={example.meaning}
                disabled={readOnly}
                onChange={(e) =>
                  set({ examples: persona.examples.map((x, i) => (i === index ? { ...x, meaning: e.target.value } : x)) })
                }
              />
              <Input
                placeholder="How the guide says it"
                value={example.line}
                disabled={readOnly}
                onChange={(e) =>
                  set({ examples: persona.examples.map((x, i) => (i === index ? { ...x, line: e.target.value } : x)) })
                }
              />
              {!readOnly && (
                <Button
                  variant="ghost"
                  aria-label="Remove example"
                  onClick={() => set({ examples: persona.examples.filter((_, i) => i !== index) })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && persona.examples.length < 8 && (
            <Button
              variant="ghost"
              onClick={() =>
                set({
                  examples: [
                    ...persona.examples,
                    { meaning: "The portraits are ready.", line: "" },
                  ],
                })
              }
            >
              <Plus className="size-3.5" />
              Add example
            </Button>
          )}
        </div>
      </Section>

      <Section
        title="Guide messages"
        hint="Length and tone limits for everything the guide says in the chat. A message that breaks one is thrown away and the configured wording shows instead."
        action={
          <ResetButton
            readOnly={readOnly}
            onClick={() => onChange({ ...agent, style: { ...agent.style, lines: createDefaultAnswerStyle("lines") } })}
          />
        }
      >
        <StyleEditor
          kind="lines"
          style={agent.style.lines}
          onChange={(lines) => onChange({ ...agent, style: { ...agent.style, lines } })}
          readOnly={readOnly}
        />
      </Section>

      <Section
        title="Answers to questions"
        hint="Limits for answers to how-to questions like “What are Sparks?”. Answers may be a little longer than ordinary messages."
        action={
          <ResetButton
            readOnly={readOnly}
            onClick={() => onChange({ ...agent, style: { ...agent.style, answers: createDefaultAnswerStyle("answers") } })}
          />
        }
      >
        <StyleEditor
          kind="answers"
          style={agent.style.answers}
          onChange={(answers) => onChange({ ...agent, style: { ...agent.style, answers } })}
          readOnly={readOnly}
        />
      </Section>

      <Section
        title="What the composer is told"
        hint="A preview of the instructions built from the settings above (unsaved edits included). This is exactly what shapes the voice; facts and wording meanings are added per message."
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500">Preview for language</span>
          <Select
            className="h-9 w-40 text-xs"
            value={previewLocale}
            options={[
              { value: "en", label: "English" },
              { value: "de", label: "German" },
              { value: "fr", label: "French" },
              { value: "es", label: "Spanish" },
            ]}
            onChange={(e) => setPreviewLocale(e.target.value)}
          />
        </div>
        <pre className="whitespace-pre-wrap rounded-lg bg-ink-50 px-3 py-2.5 text-xs leading-relaxed text-ink-700">
          {[
            `Persona: ${personaText(persona)}`,
            `Address: ${addressText(persona, previewLocale)}`,
            `Messages: ${styleText(agent.style.lines)}`,
            `Answers: ${styleText(agent.style.answers)}`,
            persona.examples.length ? `Examples:\n${examplesText(persona)}` : "",
          ]
            .filter(Boolean)
            .join("\n\n")}
        </pre>
        {!persona.enabled && (
          <ImpactNote>The persona is off: none of this is used and the configured English wording shows as written.</ImpactNote>
        )}
      </Section>
    </div>
  );
}

// --- Help articles ----------------------------------------------------------------------

export function GuideHelpPanel({ agent, onChange, readOnly }: PanelProps) {
  const settings = agent.help.articles;
  const setArticles = (articles: GuideHelpArticleSetting[]) => onChange({ ...agent, help: { articles } });
  const upsert = (entry: GuideHelpArticleSetting) =>
    setArticles(settings.some((s) => s.id === entry.id) ? settings.map((s) => (s.id === entry.id ? entry : s)) : [...settings, entry]);
  const custom = settings.filter((s) => !DEFAULT_HELP_ARTICLES.some((a) => a.id === s.id));

  return (
    <Section
      title={meta("help.articles").label}
      hint={meta("help.articles").effect}
      action={<ResetButton readOnly={readOnly} onClick={() => setArticles([])} />}
    >
      {meta("help.articles").caution && <ImpactNote>{meta("help.articles").caution}</ImpactNote>}
      <p className="text-[11px] leading-relaxed text-ink-500">
        Shows up in: {meta("help.articles").appearsIn}. The guide also knows this book's state (who's in it, whether
        portraits are drawn, the story's length) and the skills that are on, so articles only need the general rules.
        Blank fields use the shipped text.
      </p>
      <div className="space-y-3">
        {DEFAULT_HELP_ARTICLES.map((article) => {
          const edit = settings.find((s) => s.id === article.id);
          const entry: GuideHelpArticleSetting = edit ?? { id: article.id, title: "", body: "", enabled: true };
          return (
            <div key={article.id} className={cn("space-y-2 rounded-xl bg-white p-4 ring-1 ring-ink-100", !entry.enabled && "opacity-60")}>
              <div className="flex items-center justify-between gap-3">
                <Input
                  className="h-9 font-medium"
                  placeholder={article.title}
                  value={entry.title}
                  disabled={readOnly}
                  onChange={(e) => upsert({ ...entry, title: e.target.value })}
                />
                <Toggle
                  checked={entry.enabled}
                  disabled={readOnly}
                  onChange={(enabled) => upsert({ ...entry, enabled })}
                  label={`Use “${article.title}”`}
                />
              </div>
              <Textarea
                rows={3}
                placeholder={article.body}
                value={entry.body}
                disabled={readOnly}
                onChange={(e) => upsert({ ...entry, body: e.target.value })}
              />
            </div>
          );
        })}
        {custom.map((entry) => (
          <div key={entry.id} className={cn("space-y-2 rounded-xl bg-white p-4 ring-1 ring-brand-100", !entry.enabled && "opacity-60")}>
            <div className="flex items-center justify-between gap-3">
              <Input
                className="h-9 font-medium"
                placeholder="Title"
                value={entry.title}
                disabled={readOnly}
                onChange={(e) => upsert({ ...entry, title: e.target.value })}
              />
              <Toggle checked={entry.enabled} disabled={readOnly} onChange={(enabled) => upsert({ ...entry, enabled })} label="Use this article" />
              {!readOnly && (
                <Button variant="ghost" aria-label="Delete article" onClick={() => setArticles(settings.filter((s) => s.id !== entry.id))}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
            <Textarea
              rows={3}
              placeholder="What the guide should know. Plain, casual American English; no prices."
              value={entry.body}
              disabled={readOnly}
              onChange={(e) => upsert({ ...entry, body: e.target.value })}
            />
            {(!entry.title.trim() || !entry.body.trim()) && (
              <p className="text-[11px] text-amber-700">An article needs a title and a body before the guide uses it.</p>
            )}
          </div>
        ))}
        {!readOnly && (
          <Button
            variant="ghost"
            onClick={() => upsert({ id: `custom-${Date.now().toString(36)}`, title: "", body: "", enabled: true })}
          >
            <Plus className="size-3.5" />
            Add article
          </Button>
        )}
      </div>
    </Section>
  );
}

// --- Language and composer -----------------------------------------------------------------

export function GuideLanguagePanel({ agent, onChange, readOnly }: PanelProps) {
  const defaults = createDefaultGuideAgentConfig();
  return (
    <div className="space-y-8">
      <Section
        title="Writing messages"
        hint="How guide messages are phrased and how questions are answered."
        action={
          <ResetButton
            readOnly={readOnly}
            onClick={() => onChange({ ...agent, composer: defaults.composer, answers: defaults.answers })}
          />
        }
      >
        <div className="space-y-3">
          <ToggleSetting
            path="composer.enabled"
            checked={agent.composer.enabled}
            onChange={(enabled) => onChange({ ...agent, composer: { ...agent.composer, enabled } })}
            readOnly={readOnly}
          />
          <ToggleSetting
            path="answers.enabled"
            checked={agent.answers.enabled}
            onChange={(enabled) => onChange({ ...agent, answers: { enabled } })}
            readOnly={readOnly}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <NumberSetting
            path="composer.budgetMs"
            value={agent.composer.budgetMs}
            range={TURN_LIMITS.budgetMs}
            step={100}
            onChange={(budgetMs) => onChange({ ...agent, composer: { ...agent.composer, budgetMs } })}
            readOnly={readOnly}
          />
        </div>
        <p className="text-[11px] text-ink-500">
          The composer and answer models, and their temperature and length, are set per task under Configuration →
          Models (“Guide persona composer”, “Guide help answers”).
        </p>
      </Section>

      <Section
        title="Language"
        hint="The chat language follows the parent; the book's language only changes when they ask for it."
        action={<ResetButton readOnly={readOnly} onClick={() => onChange({ ...agent, language: defaults.language })} />}
      >
        <ToggleSetting
          path="language.followMessage"
          checked={agent.language.followMessage}
          onChange={(followMessage) => onChange({ ...agent, language: { ...agent.language, followMessage } })}
          readOnly={readOnly}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <NumberSetting
            path="language.minConfidence"
            value={agent.language.minConfidence}
            range={TURN_LIMITS.minConfidence}
            step={0.05}
            onChange={(minConfidence) => onChange({ ...agent, language: { ...agent.language, minConfidence } })}
            readOnly={readOnly}
          />
          <NumberSetting
            path="language.minWords"
            value={agent.language.minWords}
            range={TURN_LIMITS.minWords}
            onChange={(minWords) => onChange({ ...agent, language: { ...agent.language, minWords } })}
            readOnly={readOnly}
          />
        </div>
        <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          As set:{" "}
          {agent.language.followMessage ? (
            <>
              a message of at least <strong>{agent.language.minWords}</strong> words in another language switches the
              chat once the detector is <strong>{Math.round(agent.language.minConfidence * 100)}%</strong> sure. Buttons
              stay in the browser's language.
            </>
          ) : (
            <>the chat stays in the language it started in. Buttons stay in the browser's language.</>
          )}
        </p>
      </Section>
    </div>
  );
}

// --- Suggestion chips -------------------------------------------------------------------------

const IDEA_TEXT = en.guide.ideas as Record<string, string>;

export function GuideIdeasPanel({ agent, onChange, readOnly }: PanelProps) {
  const ideas = agent.ideas;
  const set = (patch: Partial<GuideAgentConfig["ideas"]>) => onChange({ ...agent, ideas: { ...ideas, ...patch } });
  return (
    <Section
      title="Suggestion chips"
      hint="Each skill declares its own suggestions, shown on the tab its area belongs to. They only show while the skill is on and ready for this book, so a chip never leads to “that needs something first”. Turning a skill off removes its suggestions."
      action={<ResetButton readOnly={readOnly} onClick={() => onChange({ ...agent, ideas: createDefaultGuideAgentConfig().ideas })} />}
    >
      <div className="space-y-3">
        <ToggleSetting path="ideas.enabled" checked={ideas.enabled} onChange={(enabled) => set({ enabled })} readOnly={readOnly} />
        <ToggleSetting
          path="ideas.inPlaceholder"
          checked={ideas.inPlaceholder}
          onChange={(inPlaceholder) => set({ inPlaceholder })}
          readOnly={readOnly}
        />
        <ToggleSetting
          path="ideas.questionExamples"
          checked={ideas.questionExamples}
          onChange={(questionExamples) => set({ questionExamples })}
          readOnly={readOnly}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <NumberSetting path="ideas.max" value={ideas.max} range={TURN_LIMITS.ideasMax} onChange={(max) => set({ max })} readOnly={readOnly} />
      </div>
      <Setting path="ideas.disabled">
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-ink-100">
          {GUIDE_IDEA_IDS.map((id, index) => (
            <div key={id} className={cn("flex items-center justify-between gap-3 px-4 py-2.5", index > 0 && "border-t border-ink-100")}>
              <span className="text-sm text-ink-700">
                {(IDEA_TEXT[id] ?? id).replace("{name}", "Maya")}
              </span>
              <Toggle
                checked={!ideas.disabled.includes(id)}
                disabled={readOnly}
                onChange={(on) => set({ disabled: on ? ideas.disabled.filter((x) => x !== id) : [...ideas.disabled, id] })}
                label={`Show “${id}”`}
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-400">The chip text is translated in the app's message files (guide.ideas).</p>
      </Setting>
    </Section>
  );
}
