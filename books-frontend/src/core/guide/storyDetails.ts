/**
 * Story details: what a parent can tell the guide about the story before it is
 * written — a bedtime story, an occasion, a mood, rhyme, things to leave out.
 *
 * One definition per detail says where its value lives on the brief, which
 * choices it offers (the age band's catalog or a fixed list), what the draft
 * prompt is told and what the guide asks. Everything else is generated from
 * this list: the interpreter's shape for the `storyIdea` slot, the Chat's story
 * card, the admin panel and the invariants. Adding a detail is one entry here,
 * its labels under `guide.brief` in `messages/*.json`, and a default policy in
 * `briefPolicy.ts`.
 *
 * Details Steps already had (theme, setting, devices, occasion, when, must
 * include) keep their own brief fields, so a book moves between the two studios
 * without losing them. The rest live in `brief.details`.
 */
import { z } from "zod";
import type { AgeBandStoryCraft, StoryOption } from "../config/storyCraftCatalog";
import type { StoryBrief, StoryDetailValue } from "../types";

export const STORY_DETAIL_IDS = [
  "about",
  "bedtime",
  "moment",
  "place",
  "mood",
  "telling",
  "include",
  "interests",
  "avoid",
  "lesson",
  "ending",
  "time",
  "learning",
  "voice",
  "length",
] as const;
export type StoryDetailId = (typeof STORY_DETAIL_IDS)[number];

export function isStoryDetailId(value: unknown): value is StoryDetailId {
  return typeof value === "string" && (STORY_DETAIL_IDS as readonly string[]).includes(value);
}

/**
 * - `toggle`: yes or not said.
 * - `choice`: one option, or the parent's own words.
 * - `multi`: up to `maxIds` options, plus own words.
 * - `text`: the parent's own words only.
 */
export type StoryDetailKind = "toggle" | "choice" | "multi" | "text";

export const STORY_DETAIL_GROUPS = [
  { id: "moment", label: "The moment" },
  { id: "plot", label: "What happens" },
  { id: "feel", label: "How it feels" },
  { id: "craft", label: "How it's written" },
  { id: "limits", label: "Limits" },
] as const;
export type StoryDetailGroup = (typeof STORY_DETAIL_GROUPS)[number]["id"];

export interface DetailOption {
  id: string;
  /** English label; the UI reads `guide.brief.options.<detail>.<id>` first. */
  label: string;
  /** What the draft prompt is told when this option is chosen. */
  guidance: string;
}

type Craft = Pick<AgeBandStoryCraft, "themes" | "devices" | "settings">;

export interface StoryDetailDef {
  id: StoryDetailId;
  group: StoryDetailGroup;
  kind: StoryDetailKind;
  /** English name, for the admin panel, the interpreter and receipts. */
  label: string;
  /** What changes in the story, for the admin panel. */
  effect: string;
  /** What the guide asks when this detail is set to Ask. `{names}` is the first child. */
  question: string;
  /** The parent's own words are accepted next to the choices. */
  ownWords: boolean;
  /** Most choices at once. */
  maxIds: number;
  /** The choices, from the book's age band or a fixed list. */
  options: (craft: Craft) => DetailOption[];
  /** Kept in `brief.details` rather than a brief field of its own. */
  inDetails: boolean;
  read: (brief: StoryBrief) => StoryDetailValue | null;
  /** Store a complete value; null clears it. */
  write: (brief: StoryBrief, value: StoryDetailValue | null) => StoryBrief;
  /** The draft prompt's line for this detail, from its resolved guidance. */
  prompt: (guidance: string) => string;
}

const opt = (id: string, label: string, guidance: string): DetailOption => ({ id, label, guidance });

const fromCatalog = (list: readonly StoryOption[]): DetailOption[] =>
  list.map((option) => ({ id: option.id, label: option.label, guidance: option.llmGuidance }));

/** A value with nothing empty in it, or null when nothing is left. */
export function cleanDetailValue(value: StoryDetailValue | null | undefined): StoryDetailValue | null {
  if (!value || typeof value !== "object") return null;
  const ids = Array.isArray(value.ids)
    ? [...new Set(value.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))]
    : [];
  const text = typeof value.text === "string" ? value.text.trim() : "";
  const out: StoryDetailValue = {};
  if (ids.length > 0) out.ids = ids;
  if (text) out.text = text;
  if (value.on === true) out.on = true;
  return Object.keys(out).length > 0 ? out : null;
}

function withoutKey<T extends object, K extends keyof T>(value: T, key: K): T {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function inDetails(id: StoryDetailId): Pick<StoryDetailDef, "inDetails" | "read" | "write"> {
  return {
    inDetails: true,
    read: (brief) => cleanDetailValue(brief.details?.[id]),
    write: (brief, value) => {
      const details = { ...(brief.details ?? {}) };
      const clean = cleanDetailValue(value);
      if (clean) details[id] = clean;
      else delete details[id];
      return Object.keys(details).length > 0 ? { ...brief, details } : withoutKey(brief, "details");
    },
  };
}

/** A detail stored as one prose field of the brief. */
function inProse(field: "occasion" | "when" | "mustInclude"): Pick<StoryDetailDef, "inDetails" | "read" | "write"> {
  return {
    inDetails: false,
    read: (brief) => cleanDetailValue({ text: brief[field] }),
    write: (brief, value) => {
      const text = cleanDetailValue(value)?.text;
      return text ? { ...brief, [field]: text } : withoutKey(brief, field);
    },
  };
}

const MOMENTS = [
  opt("birthday", "Birthday", "a birthday"),
  opt("holiday", "A holiday", "a holiday celebration with the family"),
  opt("firstDay", "First day at daycare or school", "the first day at daycare or school"),
  opt("sibling", "A new baby sibling", "a new baby brother or sister arriving"),
  opt("moving", "Moving house", "moving to a new home"),
  opt("doctor", "Doctor or dentist visit", "a visit to the doctor or the dentist"),
  opt("potty", "Potty training", "learning to use the potty"),
  opt("grandparents", "Visiting grandparents", "a visit to or from the grandparents"),
  opt("missing", "Missing someone", "missing someone who is far away"),
];

const MOODS = [
  opt("calm", "Calm and soothing", "Keep it calm and soothing: gentle events, soft sounds, nothing sudden."),
  opt("funny", "Funny and silly", "Make it funny and silly: playful surprises and moments a child laughs out loud at."),
  opt("adventurous", "Adventurous", "Make it an adventure: a real journey with excitement, always safe in the end."),
  opt("magical", "Magical", "Fill it with magic and wonder: one enchanting thing that makes the ordinary glow."),
  opt("cozy", "Warm and cozy", "Make it warm and cozy: closeness, comfort and a feeling of being loved."),
];

const LESSONS = [
  opt("sharing", "Sharing", "sharing and taking turns"),
  opt("brave", "Being brave", "being brave when something feels big"),
  opt("kind", "Being kind", "being kind to others"),
  opt("tryAgain", "Trying again", "trying again when something is hard"),
  opt("feelings", "Big feelings", "noticing and naming big feelings"),
  opt("yourself", "Being yourself", "being yourself, and that different is good"),
  opt("sorry", "Saying sorry", "saying sorry and making up"),
];

const ENDINGS = [
  opt("asleep", "Falling asleep", "The hero falls asleep at the end, safe and content."),
  opt("hug", "A big hug", "It ends with a big, warm hug."),
  opt("party", "A celebration", "It ends with a happy celebration."),
  opt("home", "Coming home", "It ends with coming home, where everyone is waiting."),
  opt("surprise", "A happy surprise", "It ends with a happy surprise."),
];

const LEARNING = [
  opt("counting", "Counting", "counting, one number per scene"),
  opt("colors", "Colors", "naming colors"),
  opt("shapes", "Shapes", "spotting shapes"),
  opt("letters", "Letters and first words", "letters and first words"),
  opt("animals", "Animals and their sounds", "animals and the sounds they make"),
  opt("opposites", "Opposites", "opposites like big and small"),
];

const VOICES = [
  opt("about", "About the child", "Narrate in the third person, telling the story about the hero."),
  opt("you", "To the child, as “you”", "Address the child directly as “you” throughout, as if the story is happening to them."),
  opt("me", "By the child, as “I”", "Narrate in the first person, as the hero (“I”)."),
];

const LENGTHS = [
  opt("short", "Shorter", "Aim for the lower end of the word range: a short, quick read."),
  opt("long", "Longer", "Aim for the upper end of the word range: a fuller story."),
];

export const STORY_DETAILS: Record<StoryDetailId, StoryDetailDef> = {
  about: {
    id: "about",
    group: "plot",
    kind: "choice",
    label: "What happens",
    effect: "The story's theme: one of the age band's themes (Story craft), or the parent's own idea.",
    question: "What should happen in the story? A few words are plenty.",
    ownWords: true,
    maxIds: 1,
    options: (craft) => fromCatalog(craft.themes),
    inDetails: false,
    read: (brief) => cleanDetailValue({ ids: brief.themeId ? [brief.themeId] : [], text: brief.customTheme }),
    write: (brief, value) => {
      const clean = cleanDetailValue(value);
      const next = { ...brief, themeId: clean?.ids?.[0] ?? null };
      return clean?.text ? { ...next, customTheme: clean.text } : withoutKey(next, "customTheme");
    },
    prompt: (g) => `WHAT THE STORY IS ABOUT: ${g}`,
  },
  bedtime: {
    id: "bedtime",
    group: "moment",
    kind: "toggle",
    label: "Bedtime story",
    effect: "Calm pacing that winds down, and an ending where the child settles down to sleep.",
    question: "Is this a bedtime story?",
    ownWords: false,
    maxIds: 0,
    options: () => [],
    ...inDetails("bedtime"),
    prompt: () =>
      "BEDTIME STORY: it is read at bedtime. Let the energy slow down page by page, keep the last pages quiet and still, and end with the hero settling down to sleep, safe and content.",
  },
  moment: {
    id: "moment",
    group: "moment",
    kind: "choice",
    label: "Occasion",
    effect: "A real occasion the story is built around: a birthday, a first day at school, a new sibling.",
    question: "Is it for a special occasion, like a birthday or a first day at school?",
    ownWords: true,
    maxIds: 1,
    options: () => MOMENTS,
    inDetails: false,
    // One prose field: a chosen occasion is stored as its phrase and read back as the option.
    read: (brief) => {
      const text = brief.occasion?.trim();
      if (!text) return null;
      const option = MOMENTS.find((candidate) => candidate.guidance === text);
      return option ? { ids: [option.id] } : { text };
    },
    write: (brief, value) => {
      const clean = cleanDetailValue(value);
      const text = clean?.text ?? MOMENTS.find((option) => option.id === clean?.ids?.[0])?.guidance;
      return text ? { ...brief, occasion: text } : withoutKey(brief, "occasion");
    },
    prompt: (g) => `OCCASION: ${g}`,
  },
  place: {
    id: "place",
    group: "plot",
    kind: "choice",
    label: "Where",
    effect: "Where it takes place: one of the age band's settings (Story craft), or a real place the parent names.",
    question: "Where should it take place?",
    ownWords: true,
    maxIds: 1,
    options: (craft) => fromCatalog(craft.settings),
    inDetails: false,
    read: (brief) =>
      cleanDetailValue({
        ids: brief.settingId ? [brief.settingId] : [],
        text: brief.customSetting?.trim() || brief.where,
      }),
    write: (brief, value) => {
      const clean = cleanDetailValue(value);
      const next = withoutKey({ ...brief, settingId: clean?.ids?.[0] ?? null }, "where");
      return clean?.text ? { ...next, customSetting: clean.text } : withoutKey(next, "customSetting");
    },
    prompt: (g) => `SETTING: ${g}`,
  },
  mood: {
    id: "mood",
    group: "feel",
    kind: "choice",
    label: "Mood",
    effect: "How the story feels: calm, funny, adventurous, magical or cozy.",
    question: "How should it feel: calm, funny or adventurous?",
    ownWords: true,
    maxIds: 1,
    options: () => MOODS,
    ...inDetails("mood"),
    prompt: (g) => `MOOD: ${g}`,
  },
  telling: {
    id: "telling",
    group: "craft",
    kind: "multi",
    label: "How it's told",
    effect: "Writing style: up to two of the age band's stylistic devices (rhyme, a repeating line, sounds to make…).",
    question: "Any wishes for how it's told, like rhyming or a line that repeats?",
    ownWords: true,
    maxIds: 2,
    options: (craft) => fromCatalog(craft.devices),
    inDetails: false,
    read: (brief) =>
      cleanDetailValue({
        ids: brief.deviceIds && brief.deviceIds.length > 0 ? brief.deviceIds : brief.deviceId ? [brief.deviceId] : [],
        text: brief.customDevice,
      }),
    write: (brief, value) => {
      const clean = cleanDetailValue(value);
      const ids = (clean?.ids ?? []).slice(0, 2);
      const next = { ...brief, deviceIds: ids, deviceId: ids[0] ?? null };
      return clean?.text ? { ...next, customDevice: clean.text } : withoutKey(next, "customDevice");
    },
    prompt: (g) => `HOW IT IS TOLD (follow it throughout): ${g}`,
  },
  include: {
    id: "include",
    group: "plot",
    kind: "text",
    label: "Anything else",
    effect:
      "Whatever has to be in the story and fits no other detail, in the parent's words: a pet, a favorite toy, a nickname, a family joke, a real place.",
    question: "Anything else that has to be in it, like a nickname or something funny from home?",
    ownWords: true,
    maxIds: 0,
    options: () => [],
    ...inProse("mustInclude"),
    prompt: (g) => `MUST BE IN THE STORY: ${g}`,
  },
  interests: {
    id: "interests",
    group: "plot",
    kind: "text",
    label: "Favorite things",
    effect: "What the child loves right now (dinosaurs, trucks, a color). One or two are woven in naturally.",
    question: "What does {names} love right now?",
    ownWords: true,
    maxIds: 0,
    options: () => [],
    ...inDetails("interests"),
    prompt: (g) => `THINGS THE CHILD LOVES (weave one or two in naturally, don't list them): ${g}`,
  },
  avoid: {
    id: "avoid",
    group: "limits",
    kind: "text",
    label: "Leave out",
    effect: "Things the story must not contain, like a fear or a topic. Added on top of the age band's safety rules.",
    question: "Anything I should leave out, like a fear or a topic?",
    ownWords: true,
    maxIds: 0,
    options: () => [],
    ...inDetails("avoid"),
    prompt: (g) => `LEAVE OUT ENTIRELY (the parent asked): ${g}`,
  },
  lesson: {
    id: "lesson",
    group: "feel",
    kind: "choice",
    label: "A gentle message",
    effect: "A value the story shows through what happens, never as a stated moral.",
    question: "Should it carry a gentle message, like sharing or being brave?",
    ownWords: true,
    maxIds: 1,
    options: () => LESSONS,
    ...inDetails("lesson"),
    prompt: (g) => `A GENTLE MESSAGE (show it through what happens; never state a moral): ${g}`,
  },
  ending: {
    id: "ending",
    group: "feel",
    kind: "choice",
    label: "How it ends",
    effect: "The kind of ending, or a last line the parent wants.",
    question: "How should it end?",
    ownWords: true,
    maxIds: 1,
    options: () => ENDINGS,
    ...inDetails("ending"),
    prompt: (g) => `ENDING: ${g}`,
  },
  time: {
    id: "time",
    group: "moment",
    kind: "text",
    label: "When",
    effect: "When it happens: a season, a time of day, a special day.",
    question: "When does it happen, like a season or a special day?",
    ownWords: true,
    maxIds: 0,
    options: () => [],
    ...inProse("when"),
    prompt: (g) => `WHEN: ${g}`,
  },
  learning: {
    id: "learning",
    group: "craft",
    kind: "choice",
    label: "Learn along",
    effect: "Something the child practices playfully while listening: counting, colors, shapes.",
    question: "Should it teach something playfully, like counting or colors?",
    ownWords: true,
    maxIds: 1,
    options: () => LEARNING,
    ...inDetails("learning"),
    prompt: (g) => `LEARN ALONG (playfully, part of the story rather than a lesson): ${g}`,
  },
  voice: {
    id: "voice",
    group: "craft",
    kind: "choice",
    label: "Who tells it",
    effect: "Narration: about the child, to the child as “you”, or by the child as “I”.",
    question: "Should the story be about {names}, or told to them as “you”?",
    ownWords: false,
    maxIds: 1,
    options: () => VOICES,
    ...inDetails("voice"),
    prompt: (g) => `NARRATION: ${g}`,
  },
  length: {
    id: "length",
    group: "craft",
    kind: "choice",
    label: "Length",
    effect: "Shorter or longer, always inside the age band's word range.",
    question: "Should it be on the shorter or the longer side?",
    ownWords: false,
    maxIds: 1,
    options: () => LENGTHS,
    ...inDetails("length"),
    prompt: (g) => `LENGTH: ${g}`,
  },
};

/** Guidance for a value: each chosen option's guidance, then the parent's own words. */
export function detailGuidance(id: StoryDetailId, value: StoryDetailValue | null, craft: Craft): string {
  const def = STORY_DETAILS[id];
  const clean = cleanDetailValue(value);
  if (!clean) return "";
  if (def.kind === "toggle") return clean.on ? "yes" : "";
  const options = def.options(craft);
  const parts = (clean.ids ?? [])
    .map((optionId) => options.find((option) => option.id === optionId)?.guidance.trim())
    .filter((part): part is string => Boolean(part));
  if (clean.text) parts.push(clean.text);
  return parts.join("; ");
}

/** English labels for a value, for receipts and the admin preview. */
export function detailLabels(id: StoryDetailId, value: StoryDetailValue | null, craft: Craft): string[] {
  const def = STORY_DETAILS[id];
  const clean = cleanDetailValue(value);
  if (!clean) return [];
  if (def.kind === "toggle") return clean.on ? [def.label] : [];
  const options = def.options(craft);
  const labels = (clean.ids ?? [])
    .map((optionId) => options.find((option) => option.id === optionId)?.label)
    .filter((label): label is string => Boolean(label));
  if (clean.text) labels.push(clean.text);
  return labels;
}

/** Details with a value on this brief, in catalog order. */
export function filledDetails(brief: StoryBrief): StoryDetailId[] {
  return STORY_DETAIL_IDS.filter((id) => STORY_DETAILS[id].read(brief) !== null);
}

/**
 * A change to one detail, merged onto its current value. `null` clears the
 * detail; inside a value, a `null` part clears that part and an absent part
 * keeps it. Choosing the one option of a single-choice detail replaces the
 * parent's own words for it and the other way around, unless both are given.
 */
export function withStoryDetail(
  brief: StoryBrief,
  id: StoryDetailId,
  patch: DetailPatch | null,
): StoryBrief {
  const def = STORY_DETAILS[id];
  if (patch === null) return def.write(brief, null);
  const current = def.read(brief) ?? {};
  const next: StoryDetailValue = { ...current };
  const exclusive = def.kind === "choice";
  if (patch.ids !== undefined) {
    if (patch.ids === null) delete next.ids;
    else next.ids = patch.ids.slice(0, Math.max(def.maxIds, 0));
    if (exclusive && patch.text === undefined && patch.ids !== null) delete next.text;
  }
  if (patch.text !== undefined) {
    if (patch.text === null) delete next.text;
    else next.text = patch.text;
    if (exclusive && patch.ids === undefined && patch.text !== null) delete next.ids;
  }
  if (patch.on !== undefined) {
    if (patch.on === true) next.on = true;
    else delete next.on;
  }
  const added = patch.add?.trim();
  if (added) {
    const have = next.text?.trim() ?? "";
    if (!have) next.text = added;
    else if (!have.toLocaleLowerCase().includes(added.toLocaleLowerCase())) next.text = `${have}; ${added}`;
  }
  if (!def.ownWords) delete next.text;
  if (def.kind === "toggle") {
    delete next.ids;
    delete next.text;
  }
  return def.write(brief, cleanDetailValue(next));
}

export interface DetailPatch {
  ids?: string[] | null;
  /** Replaces the parent's own words. */
  text?: string | null;
  /** Added to the parent's own words already there; words already in them change nothing. */
  add?: string;
  on?: boolean | null;
}

export const detailPatchSchema = z
  .object({
    ids: z.array(z.string().trim().min(1).max(60)).max(4).nullable().optional(),
    text: z.string().trim().max(500).nullable().optional(),
    add: z.string().trim().min(1).max(500).optional(),
    on: z.boolean().nullable().optional(),
  })
  .strict();

/**
 * A detail's value in the one shape the validator takes.
 *
 * The commonest way the interpreter gets this wrong is not a misreading but a
 * shorthand: `"about": "a flight to Frankfurt"` instead of
 * `"about": {"text": "a flight to Frankfurt"}`. The meaning is unambiguous, so it
 * is read rather than refused (a refusal here used to drop the whole story idea,
 * and the draft was then written without it).
 *
 * Anything that is not an obvious shorthand is returned untouched, so a value
 * that is genuinely wrong still fails the schema.
 */
export function coerceDetailPatch(id: StoryDetailId, raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  const def = STORY_DETAILS[id];
  if (typeof raw === "boolean") return def.kind === "toggle" ? { on: raw } : raw;
  if (typeof raw === "string" || (Array.isArray(raw) && raw.length > 0 && raw.every((item) => typeof item === "string"))) {
    const text = (Array.isArray(raw) ? (raw as string[]).join("; ") : raw).trim();
    if (!text) return undefined;
    if (def.kind === "toggle") return { on: !/^(no|false|off|none|never)\b/i.test(text) };
    if (!def.ownWords) return { ids: Array.isArray(raw) ? (raw as string[]).map((item) => item.trim()).filter(Boolean) : [text] };
    return def.kind === "text" ? { add: text } : { text };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const value = raw as Record<string, unknown>;
    // `"ids": "calm"` for `"ids": ["calm"]`.
    if (typeof value.ids === "string") return { ...value, ids: value.ids.trim() ? [value.ids.trim()] : [] };
  }
  return raw;
}

const detailInputSchema = detailPatchSchema.nullable().optional();

/**
 * The story idea as the interpreter sent it, with each detail read on its own.
 *
 * One unusable detail used to refuse the whole claim, so a good "what happens"
 * was lost along with a bad "how it's told". Details that read are kept; the
 * rest are set aside under `rejectedDetails` with the validator's reason, so the
 * writer can apply what it can and still report what it could not.
 */
export function salvageStoryIdeaInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const input: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  delete input.rejectedDetails;
  const rejected: { id: string; reason: string }[] = [];
  for (const id of STORY_DETAIL_IDS) {
    if (!(id in input)) continue;
    const parsed = detailInputSchema.safeParse(coerceDetailPatch(id, input[id]));
    if (parsed.success) {
      if (parsed.data === undefined) delete input[id];
      else input[id] = parsed.data;
      continue;
    }
    const issue = parsed.error.issues[0];
    delete input[id];
    rejected.push({
      id,
      reason: `${id}${issue?.path.length ? `.${issue.path.join(".")}` : ""}: ${issue?.message ?? "invalid value"}`,
    });
  }
  if (rejected.length > 0) input.rejectedDetails = rejected;
  return input;
}

/** Longest own words a detail can store: its brief field's limit, else the details map's. */
export function detailTextMax(id: StoryDetailId): number {
  return STORY_DETAILS[id].inDetails ? 500 : 1000;
}

/** Stored shape of `brief.details`, for the backend's brief check. */
export const storyDetailsSchema = z
  .record(
    z.string().max(40),
    z.object({
      ids: z.array(z.string().max(60)).max(4).optional(),
      text: z.string().max(500).optional(),
      on: z.boolean().optional(),
    }),
  )
  .refine((value) => Object.keys(value).length <= STORY_DETAIL_IDS.length, "too many story details");

/** Option ids a patch names that this detail does not offer on this band. */
export function unknownDetailIds(id: StoryDetailId, ids: readonly string[], craft: Craft): string[] {
  const known = new Set(STORY_DETAILS[id].options(craft).map((option) => option.id));
  return ids.filter((optionId) => !known.has(optionId));
}

const wordsOf = (text: string): string[] =>
  text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));

/**
 * The listed option a few of the parent's words name, when exactly one does:
 * "rhymes" is the band's "Rhyme and rhythm", "bedtime" is Getting sleepy.
 *
 * Their words stay as they are when nothing matches or two options could be
 * meant, so a guess never replaces what they said. Only short phrases are tried:
 * a sentence is a plot, not a choice.
 */
export function matchDetailOption(id: StoryDetailId, text: string, craft: Craft): string | null {
  const wanted = wordsOf(text);
  if (wanted.length === 0 || wanted.length > 2) return null;
  const options = STORY_DETAILS[id].options(craft);
  const phrase = wanted.join(" ");
  const exact = options.filter(
    (option) => wordsOf(option.id).join(" ") === phrase || wordsOf(option.label).join(" ") === phrase,
  );
  if (exact.length === 1) return exact[0]!.id;
  if (wanted.length !== 1) return null;
  const named = options.filter((option) =>
    [...wordsOf(option.id), ...wordsOf(option.label)].some((word) => word === wanted[0]),
  );
  return named.length === 1 ? named[0]!.id : null;
}

/**
 * A patch that carries only the parent's own words, read as the listed option
 * when the words name one. Anything else is returned as it came.
 */
export function withMatchedOption(
  id: StoryDetailId,
  patch: DetailPatch | null | undefined,
  current: StoryDetailValue | null,
  craft: Craft,
): DetailPatch | null | undefined {
  const def = STORY_DETAILS[id];
  if (!patch || (def.kind !== "choice" && def.kind !== "multi")) return patch;
  if (patch.ids !== undefined || typeof patch.text !== "string") return patch;
  const matched = matchDetailOption(id, patch.text, craft);
  if (!matched) return patch;
  const { text: _words, ...rest } = patch;
  const kept = def.kind === "multi" ? (current?.ids ?? []) : [];
  return { ...rest, ids: [...new Set([...kept, matched])].slice(0, Math.max(def.maxIds, 1)), text: null };
}

/**
 * The prompt lines for every detail the chosen template does not already
 * render with a block of its own. English; one per line.
 */
export function detailPromptLines(
  brief: StoryBrief,
  craft: Craft,
  covered: readonly StoryDetailId[],
): string {
  return STORY_DETAIL_IDS.filter((id) => !covered.includes(id))
    .map((id) => {
      const guidance = detailGuidance(id, STORY_DETAILS[id].read(brief), craft);
      return guidance ? STORY_DETAILS[id].prompt(guidance) : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** One line per detail for the interpreter: its key, what it holds and the ids it takes on this band. */
export function detailShapeLines(craft: Craft | null): string {
  return STORY_DETAIL_IDS.map((id) => {
    const def = STORY_DETAILS[id];
    const value =
      def.kind === "toggle"
        ? '{"on": true}'
        : def.kind === "text"
          ? '{"add": "…"} to add to it, {"text": "…"} to replace it'
          : `{"ids": [${def.maxIds > 1 ? `up to ${def.maxIds} of ` : "one of "}${
              craft ? def.options(craft).map((option) => option.id).join(" | ") || "(none on this band)" : "the listed ids"
            }]${def.ownWords ? ', "text"?: their own words' : ""}}`;
    return `    ${id} (${def.label.toLowerCase()}): ${value}`;
  }).join("\n");
}
