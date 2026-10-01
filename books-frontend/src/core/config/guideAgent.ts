/**
 * The Chat studio's skill system, persona and answer style, as admin config.
 *
 * Stored inside the guide document (`appConfig/guide` → `agent`). Code owns the
 * contracts — which skills exist, what each one requires, what it would destroy
 * — and this owns the values: which skills are on, how the guide sounds, how
 * long it talks, when it asks for optional details. Every field has an
 * {@link AdminFieldMeta} entry, so the dashboard can say what changes when it
 * changes, and `guide-agent-invariants.ts` fails when one is missing.
 *
 * Admin values can only tighten the code's floors: a skill can be switched off
 * or made to confirm, never made to skip a confirmation the code requires; a
 * person's age stays required whatever is saved here.
 */
import { z } from "zod";
import { GUIDE_COMMAND_IDS, type GuideCommandId } from "../guide/agent/ids";

// --- Persona ------------------------------------------------------------------

export const PERSONA_HUMOR = ["none", "light", "playful"] as const;
export const PERSONA_REGISTER = ["casual", "neutral", "formal"] as const;
export const PERSONA_ADDRESS = ["informal", "formal"] as const;
export type PersonaHumor = (typeof PERSONA_HUMOR)[number];
export type PersonaRegister = (typeof PERSONA_REGISTER)[number];
export type PersonaAddress = (typeof PERSONA_ADDRESS)[number];

export interface GuidePersonaExample {
  /** What the line means, in plain English. */
  meaning: string;
  /** How this persona would say it. */
  line: string;
}

export interface GuidePersona {
  /** Off: the configured wording is shown as written, in English, with no model call. */
  enabled: boolean;
  /** The guide's name. Empty: the guide never introduces itself by name. */
  name: string;
  /** Who the guide is, in one or two sentences. */
  identity: string;
  traits: string[];
  humor: PersonaHumor;
  register: PersonaRegister;
  /** du/tu/tú versus Sie/vous/usted, for every language that has the distinction. */
  address: PersonaAddress;
  /** Per-language exceptions to {@link address}, keyed by language code ("de", "fr"). */
  addressOverrides: Record<string, PersonaAddress>;
  /** Whether the guide may mention its own name or nature. */
  selfReference: "never" | "sometimes";
  /** Words, topics or habits the guide never uses. */
  avoid: string[];
  examples: GuidePersonaExample[];
}

// --- Answer style ---------------------------------------------------------------

export const STYLE_DETAIL = ["brief", "balanced", "thorough"] as const;
export type StyleDetail = (typeof STYLE_DETAIL)[number];

export interface AnswerStyle {
  detail: StyleDetail;
  maxSentences: number;
  maxWords: number;
  directness: "answerFirst" | "contextFirst";
  questionsPerMessage: 1 | 2;
  emoji: "never" | "rare";
  exclamations: "avoid" | "allowed";
}

export const STYLE_LIMITS = {
  maxSentences: { min: 1, max: 8 },
  maxWords: { min: 8, max: 200 },
} as const;

// --- Skills, people, turn ---------------------------------------------------------

export interface GuideSkillSetting {
  enabled: boolean;
  /** Always confirm before running, even when the code would not ask. */
  confirm: boolean;
}

export type OptionalAskWhen = "once" | "never";
export type AgeAskWhen = "now" | "beforePortraits";

export interface GuidePeoplePolicy {
  age: { askWhen: AgeAskWhen };
  role: { askWhen: OptionalAskWhen };
  look: { askWhen: OptionalAskWhen };
}

export interface GuideTurnPolicy {
  /** Most skills one message may run. */
  maxCommands: number;
  /** A skill call less sure than this is not run. */
  commandFloor: number;
  /** A confirmation card stops working after this many minutes. */
  confirmTtlMinutes: number;
  /** Typing "yes" confirms the one open, reversible confirmation. */
  typedYes: boolean;
  /**
   * A picture the reader asked for in words (a redraw, a named portrait) starts
   * at once when its price is at most this many Sparks and the balance covers
   * it; anything dearer shows the priced button. 0: always show the button.
   */
  autoSpendSparks: number;
}

export interface GuideHelpArticleSetting {
  id: string;
  title: string;
  body: string;
  enabled: boolean;
}

export interface GuideAgentConfig {
  /** Master switch for skills. Off: the chat only collects facts, as before. */
  enabled: boolean;
  turn: GuideTurnPolicy;
  skills: Record<GuideCommandId, GuideSkillSetting>;
  people: GuidePeoplePolicy;
  persona: GuidePersona;
  style: { lines: AnswerStyle; answers: AnswerStyle };
  composer: { enabled: boolean; budgetMs: number };
  answers: { enabled: boolean };
  language: { followMessage: boolean; minConfidence: number; minWords: number };
  /** Admin edits to shipped help articles, and admin-added articles. */
  help: { articles: GuideHelpArticleSetting[] };
  ideas: { enabled: boolean; max: number; inPlaceholder: boolean; disabled: string[] };
}

export const TURN_LIMITS = {
  maxCommands: { min: 1, max: 6 },
  commandFloor: { min: 0.3, max: 0.95 },
  confirmTtlMinutes: { min: 1, max: 60 },
  autoSpendSparks: { min: 0, max: 200 },
  budgetMs: { min: 400, max: 6000 },
  minConfidence: { min: 0.5, max: 0.99 },
  minWords: { min: 1, max: 12 },
  ideasMax: { min: 1, max: 4 },
} as const;

export function createDefaultAnswerStyle(kind: "lines" | "answers"): AnswerStyle {
  return kind === "lines"
    ? {
        detail: "brief",
        maxSentences: 2,
        maxWords: 32,
        directness: "answerFirst",
        questionsPerMessage: 1,
        emoji: "never",
        exclamations: "avoid",
      }
    : {
        detail: "balanced",
        maxSentences: 4,
        maxWords: 90,
        directness: "answerFirst",
        questionsPerMessage: 1,
        emoji: "never",
        exclamations: "avoid",
      };
}

export function createDefaultGuidePersona(): GuidePersona {
  return {
    enabled: true,
    name: "",
    identity: "A friendly helper who makes picture books together with families.",
    traits: ["friendly", "warm", "casual"],
    humor: "light",
    register: "casual",
    address: "informal",
    addressOverrides: {},
    selfReference: "never",
    avoid: [],
    examples: [],
  };
}

export function createDefaultGuideAgentConfig(): GuideAgentConfig {
  const skills = Object.fromEntries(
    GUIDE_COMMAND_IDS.map((id) => [id, { enabled: true, confirm: false }]),
  ) as Record<GuideCommandId, GuideSkillSetting>;
  return {
    enabled: true,
    turn: { maxCommands: 4, commandFloor: 0.6, confirmTtlMinutes: 10, typedYes: true, autoSpendSparks: 10 },
    skills,
    people: { age: { askWhen: "now" }, role: { askWhen: "once" }, look: { askWhen: "never" } },
    persona: createDefaultGuidePersona(),
    style: { lines: createDefaultAnswerStyle("lines"), answers: createDefaultAnswerStyle("answers") },
    composer: { enabled: true, budgetMs: 1500 },
    answers: { enabled: true },
    language: { followMessage: true, minConfidence: 0.8, minWords: 3 },
    help: { articles: [] },
    ideas: { enabled: true, max: 3, inPlaceholder: true, disabled: [] },
  };
}

// --- Normalization ----------------------------------------------------------------

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function num(value: unknown, range: { min: number; max: number }, fallback: number, integer = true): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(range.max, Math.max(range.min, value));
  return integer ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, max: number, fallback: string): string {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function list(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, maxChars)).filter(Boolean))].slice(0, maxItems);
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeAnswerStyle(input: unknown, kind: "lines" | "answers"): AnswerStyle {
  const def = createDefaultAnswerStyle(kind);
  const raw = obj(input);
  return {
    detail: pick(raw.detail, STYLE_DETAIL, def.detail),
    maxSentences: num(raw.maxSentences, STYLE_LIMITS.maxSentences, def.maxSentences),
    maxWords: num(raw.maxWords, STYLE_LIMITS.maxWords, def.maxWords),
    directness: pick(raw.directness, ["answerFirst", "contextFirst"] as const, def.directness),
    questionsPerMessage: raw.questionsPerMessage === 2 ? 2 : raw.questionsPerMessage === 1 ? 1 : def.questionsPerMessage,
    emoji: pick(raw.emoji, ["never", "rare"] as const, def.emoji),
    exclamations: pick(raw.exclamations, ["avoid", "allowed"] as const, def.exclamations),
  };
}

export function normalizeGuidePersona(input: unknown): GuidePersona {
  const def = createDefaultGuidePersona();
  const raw = obj(input);
  const overrides: Record<string, PersonaAddress> = {};
  for (const [lang, value] of Object.entries(obj(raw.addressOverrides))) {
    if (/^[a-z]{2,3}$/.test(lang) && PERSONA_ADDRESS.includes(value as PersonaAddress)) {
      overrides[lang] = value as PersonaAddress;
    }
  }
  const examples = Array.isArray(raw.examples)
    ? raw.examples
        .map((entry) => obj(entry))
        .map((entry) => ({ meaning: text(entry.meaning, 200, ""), line: text(entry.line, 240, "") }))
        .filter((entry) => entry.meaning && entry.line)
        .slice(0, 8)
    : [];
  return {
    enabled: bool(raw.enabled, def.enabled),
    name: text(raw.name, 40, def.name),
    identity: text(raw.identity, 400, def.identity) || def.identity,
    traits: Array.isArray(raw.traits) ? list(raw.traits, 8, 30) : def.traits,
    humor: pick(raw.humor, PERSONA_HUMOR, def.humor),
    register: pick(raw.register, PERSONA_REGISTER, def.register),
    address: pick(raw.address, PERSONA_ADDRESS, def.address),
    addressOverrides: overrides,
    selfReference: pick(raw.selfReference, ["never", "sometimes"] as const, def.selfReference),
    avoid: list(raw.avoid, 20, 60),
    examples,
  };
}

export function normalizeGuideAgentConfig(input: unknown): GuideAgentConfig {
  const def = createDefaultGuideAgentConfig();
  const raw = obj(input);
  const turn = obj(raw.turn);
  const skillsRaw = obj(raw.skills);
  const skills = { ...def.skills };
  for (const id of GUIDE_COMMAND_IDS) {
    const entry = obj(skillsRaw[id]);
    skills[id] = { enabled: bool(entry.enabled, true), confirm: bool(entry.confirm, false) };
  }
  const people = obj(raw.people);
  const style = obj(raw.style);
  const composer = obj(raw.composer);
  const answers = obj(raw.answers);
  const language = obj(raw.language);
  const help = obj(raw.help);
  const ideas = obj(raw.ideas);
  const articles = Array.isArray(help.articles)
    ? help.articles
        .map((entry) => obj(entry))
        .map((entry) => ({
          id: text(entry.id, 60, "").toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          title: text(entry.title, 120, ""),
          body: text(entry.body, 2000, ""),
          enabled: bool(entry.enabled, true),
        }))
        .filter((entry) => entry.id && (entry.title || entry.body || !entry.enabled))
        .slice(0, 40)
    : [];
  return {
    enabled: bool(raw.enabled, def.enabled),
    turn: {
      maxCommands: num(turn.maxCommands, TURN_LIMITS.maxCommands, def.turn.maxCommands),
      commandFloor: num(turn.commandFloor, TURN_LIMITS.commandFloor, def.turn.commandFloor, false),
      confirmTtlMinutes: num(turn.confirmTtlMinutes, TURN_LIMITS.confirmTtlMinutes, def.turn.confirmTtlMinutes),
      typedYes: bool(turn.typedYes, def.turn.typedYes),
      autoSpendSparks: num(turn.autoSpendSparks, TURN_LIMITS.autoSpendSparks, def.turn.autoSpendSparks),
    },
    skills,
    people: {
      age: { askWhen: pick(obj(people.age).askWhen, ["now", "beforePortraits"] as const, def.people.age.askWhen) },
      role: { askWhen: pick(obj(people.role).askWhen, ["once", "never"] as const, def.people.role.askWhen) },
      look: { askWhen: pick(obj(people.look).askWhen, ["once", "never"] as const, def.people.look.askWhen) },
    },
    persona: normalizeGuidePersona(raw.persona),
    style: {
      lines: normalizeAnswerStyle(style.lines, "lines"),
      answers: normalizeAnswerStyle(style.answers, "answers"),
    },
    composer: {
      enabled: bool(composer.enabled, def.composer.enabled),
      budgetMs: num(composer.budgetMs, TURN_LIMITS.budgetMs, def.composer.budgetMs),
    },
    answers: { enabled: bool(answers.enabled, def.answers.enabled) },
    language: {
      followMessage: bool(language.followMessage, def.language.followMessage),
      minConfidence: num(language.minConfidence, TURN_LIMITS.minConfidence, def.language.minConfidence, false),
      minWords: num(language.minWords, TURN_LIMITS.minWords, def.language.minWords),
    },
    help: { articles },
    ideas: {
      enabled: bool(ideas.enabled, def.ideas.enabled),
      max: num(ideas.max, TURN_LIMITS.ideasMax, def.ideas.max),
      inPlaceholder: bool(ideas.inPlaceholder, def.ideas.inPlaceholder),
      disabled: list(ideas.disabled, 100, 60),
    },
  };
}

/** Loose on the way in (the normalizer repairs values), strict about being an object. */
export const guideAgentConfigSchema = z
  .object({})
  .passthrough()
  .transform((value) => normalizeGuideAgentConfig(value));

/** The address a language uses: the override for it, else the persona default. */
export function personaAddressFor(persona: GuidePersona, locale: string): PersonaAddress {
  const lang = locale.slice(0, 2).toLowerCase();
  return persona.addressOverrides[lang] ?? persona.address;
}

// --- Admin hints --------------------------------------------------------------------

/**
 * What the dashboard says about one setting. `effect` answers "what changes
 * when I change this", which is the question an admin actually has.
 */
export interface AdminFieldMeta {
  label: string;
  effect: string;
  /** Where a reader would notice the change. */
  appearsIn: string;
  example?: string;
  caution?: string;
}

const STYLE_META = (kind: "lines" | "answers"): Record<string, AdminFieldMeta> => {
  const where = kind === "lines" ? "Every guide message in the chat" : "Answers to how-to questions";
  const prefix = `style.${kind}`;
  return {
    [`${prefix}.detail`]: {
      label: "How much detail",
      effect: "Brief says only what matters now; balanced adds the reason; thorough adds context and a next step.",
      appearsIn: where,
    },
    [`${prefix}.maxSentences`]: {
      label: "Most sentences",
      effect: "A hard cap the validator enforces. A longer message falls back to the configured wording.",
      appearsIn: where,
      caution: kind === "lines" ? "Above 3 the chat starts to feel like reading, not talking." : undefined,
    },
    [`${prefix}.maxWords`]: {
      label: "Most words",
      effect: "A second hard cap, for languages with long sentences. Checked after writing.",
      appearsIn: where,
    },
    [`${prefix}.directness`]: {
      label: "Order",
      effect: "Answer first says the result, then why. Context first sets the scene, then the result.",
      appearsIn: where,
    },
    [`${prefix}.questionsPerMessage`]: {
      label: "Questions per message",
      effect: "How many questions one message may ask. Two lets the guide ask for an age and a detail together.",
      appearsIn: where,
    },
    [`${prefix}.emoji`]: {
      label: "Emoji",
      effect: "Never removes every emoji. Rare allows one now and then, never in warnings or confirmations.",
      appearsIn: where,
    },
    [`${prefix}.exclamations`]: {
      label: "Exclamation marks",
      effect: "Avoid keeps the tone calm. Allowed lets the persona sound more excited.",
      appearsIn: where,
    },
  };
};

export const GUIDE_AGENT_META: Record<string, AdminFieldMeta> = {
  enabled: {
    label: "Skills in the chat",
    effect: "On: parents can ask the chat to change the book (rename, add a person, redraw, change the look…). Off: the chat only collects the facts for the story, as before.",
    appearsIn: "Chat studio, every message",
    caution: "The kill switch if skills misbehave. Facts and the story keep working.",
  },
  "turn.maxCommands": {
    label: "Most skills per message",
    effect: "A message asking for more does the first ones and asks for the rest one at a time.",
    appearsIn: "Messages with several requests",
    example: "\"Maya is 5, rename the book to Moonlight and add Leo\" runs three skills.",
  },
  "turn.commandFloor": {
    label: "Ignore skill calls less sure than",
    effect: "Raise it and the guide asks more often instead of acting; lower it and it acts on things the parent only hinted at.",
    appearsIn: "Every message that asks for a change",
    caution: "Below 0.5 the chat starts doing things nobody asked for.",
  },
  "turn.confirmTtlMinutes": {
    label: "Confirmation expires after (minutes)",
    effect: "A confirmation card older than this does nothing when tapped; the parent asks again. Protects against confirming a change after the book moved on.",
    appearsIn: "Confirmation cards (remove a person, replace the story…)",
  },
  "turn.autoSpendSparks": {
    label: "Start typed picture changes up to (Sparks)",
    effect: "When a parent types a picture change (\"make Dad's hair blue\", \"draw Amanda\") and the price is at most this, the picture starts at once and the chat says it started. Dearer than this, or not enough Sparks, shows the priced button instead. 0 always shows the button.",
    appearsIn: "Redraws and named portraits asked for in the chat",
    caution: "The earlier picture always stays in the history, so a redraw can be undone for free. Drawing the whole book is never started this way.",
  },
  "turn.typedYes": {
    label: "Typing \"yes\" confirms",
    effect: "On: answering \"yes\" to one open confirmation runs it. Irreversible actions always need the button.",
    appearsIn: "Confirmation cards",
  },
  skills: {
    label: "Skills",
    effect: "Off hides the skill: the chat explains it can't do that here and suggests the book pane. Always confirm adds a confirmation card before it runs.",
    appearsIn: "Chat studio",
    caution: "You can make a skill stricter, never looser: confirmations the code requires stay.",
  },
  "people.age.askWhen": {
    label: "When to ask what a new character needs",
    effect: "A person's age, or what kind of animal, toy or creature a character is. Right away asks as soon as they're added. Before portraits waits until their portrait is next. It is always required because portraits need it.",
    appearsIn: "After \"Add a character Christopher\"",
    example: "\"Sure—how old is Christopher?\"",
  },
  "people.role.askWhen": {
    label: "Ask who a new person is",
    effect: "Once asks one optional follow-up (\"who is he in the story?\") that the parent can skip. Never skips the question.",
    appearsIn: "After adding a person",
  },
  "people.look.askWhen": {
    label: "Ask how a new person looks",
    effect: "The character card asks where a look comes from, before any portrait. This no longer adds a separate chat question.",
    appearsIn: "The character card, before portraits",
  },
  "persona.enabled": {
    label: "Persona composer",
    effect: "On: every guide message is written in the persona and the parent's language. Off: the configured English wording is shown as written.",
    appearsIn: "Every guide message",
  },
  "persona.name": {
    label: "Name",
    effect: "The name the guide uses when it introduces itself. Empty: it never introduces itself by name.",
    appearsIn: "Only when self reference is allowed",
    example: "Hugo",
  },
  "persona.identity": {
    label: "Who the guide is",
    effect: "One or two sentences the composer writes from. Shapes word choice and warmth, never facts.",
    appearsIn: "Every guide message",
    example: "Hugo, a kind hedgehog who loves bedtime stories.",
  },
  "persona.traits": {
    label: "Traits",
    effect: "Adjectives the composer aims for. Three or four work best.",
    appearsIn: "Every guide message",
    example: "friendly, warm, casual",
  },
  "persona.humor": {
    label: "Humor",
    effect: "None keeps it plain. Light allows a small wink. Playful allows jokes. Never used in errors, payments or confirmations.",
    appearsIn: "Ordinary guide messages",
  },
  "persona.register": {
    label: "Register",
    effect: "How casual the wording is, independent of du/Sie.",
    appearsIn: "Every guide message",
  },
  "persona.address": {
    label: "Address",
    effect: "Informal uses du, tu, tú, jij in every language with the distinction. Formal uses Sie, vous, usted, u. The validator rejects the other form.",
    appearsIn: "Every guide message in languages with formal and informal \"you\"",
    caution: "Informal is the product default.",
  },
  "persona.addressOverrides": {
    label: "Per-language address",
    effect: "An exception for one language, keyed by its code (de, fr, es…).",
    appearsIn: "Guide messages in that language",
  },
  "persona.selfReference": {
    label: "Self reference",
    effect: "Never: the guide doesn't talk about itself. Sometimes: it may use its name or nature now and then.",
    appearsIn: "Ordinary guide messages",
  },
  "persona.avoid": {
    label: "Never say",
    effect: "Words or habits the composer must avoid. A message containing one is rejected and falls back.",
    appearsIn: "Every guide message",
    example: "awesome, super, amazing",
  },
  "persona.examples": {
    label: "Example lines",
    effect: "A few meaning → line pairs showing how the persona talks. The strongest way to set the voice.",
    appearsIn: "Every guide message",
  },
  ...STYLE_META("lines"),
  ...STYLE_META("answers"),
  "composer.enabled": {
    label: "Write messages with the composer",
    effect: "On: one fast model call phrases each message in the persona and language. Off: configured wording, English only.",
    appearsIn: "Every guide message",
  },
  "composer.budgetMs": {
    label: "Composer time budget (ms)",
    effect: "If the phrased message is not back in time, the configured wording shows instead. Lower is snappier; higher gives the composer more chances.",
    appearsIn: "Every guide message",
  },
  "answers.enabled": {
    label: "Answer how-to questions",
    effect: "On: questions like \"What are Sparks?\" are answered from the help articles and the book. Off: the guide says it can't answer.",
    appearsIn: "Questions in the chat",
  },
  "language.followMessage": {
    label: "Reply in the message's language",
    effect: "On: the guide answers in the language each message is written in. The book's language only changes when the parent asks.",
    appearsIn: "Every guide message",
  },
  "language.minConfidence": {
    label: "Switch language when surer than",
    effect: "How sure the detector must be before the chat switches language. Higher avoids flipping on names or loanwords.",
    appearsIn: "Language switches",
  },
  "language.minWords": {
    label: "Shortest message that switches language",
    effect: "\"ok\" or a name alone never switches. Messages shorter than this keep the current chat language.",
    appearsIn: "Language switches",
  },
  "help.articles": {
    label: "Help articles",
    effect: "What the guide knows when it answers questions. Edit a shipped article or add your own. Disabled articles are never used.",
    appearsIn: "Answers to how-to questions",
    caution: "Never put prices here; the guide reads prices from the app.",
  },
  "ideas.enabled": {
    label: "Suggestion chips",
    effect: "Short example requests under the composer, based on what the book can do next, led by the open tab (on Story: shorter, simpler, warmer, age check). Tapping one fills the composer, or runs it when the result is only advice or reviewed before anything changes.",
    appearsIn: "Idle composer",
  },
  "ideas.max": {
    label: "Most chips shown",
    effect: "How many suggestions show at once.",
    appearsIn: "Idle composer",
  },
  "ideas.inPlaceholder": {
    label: "Suggestion in the placeholder",
    effect: "When the guide isn't asking anything, the empty composer shows one suggestion as its placeholder.",
    appearsIn: "Idle composer",
  },
  "ideas.disabled": {
    label: "Hidden suggestions",
    effect: "Suggestion ids that never show.",
    appearsIn: "Idle composer",
  },
};

/** Paths whose value is edited as one unit (a table, list or map). */
const META_LEAF_CONTAINERS = new Set([
  "skills",
  "persona.traits",
  "persona.addressOverrides",
  "persona.avoid",
  "persona.examples",
  "help.articles",
  "ideas.disabled",
]);

/** Every setting path an admin can change. The invariant checks each has meta. */
export function guideAgentSettingPaths(config: GuideAgentConfig = createDefaultGuideAgentConfig()): string[] {
  const out: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (path && META_LEAF_CONTAINERS.has(path)) {
      out.push(path);
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
      return;
    }
    out.push(path);
  };
  walk(config, "");
  return out;
}

export function isSkillEnabled(config: GuideAgentConfig, id: GuideCommandId): boolean {
  return config.enabled && config.skills[id]?.enabled !== false;
}
