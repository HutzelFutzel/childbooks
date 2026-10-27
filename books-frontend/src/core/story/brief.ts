/**
 * Pure helpers for the story brief — the record of what the reader told us
 * before the story existed. Shared by the Story UI, the draft pipeline and the
 * backend route, so "is this brief ready?" and "is this draft stale?" answer
 * the same way everywhere.
 */
import { z } from "zod";
import { LIKENESS_PHOTOS_MAX, SOURCE_ART_MAX, type Project, type StoryBrief, type StoryCastMember } from "../types";
import type { AgeBandStoryCraft } from "../config/storyCraftCatalog";
import { optionLabel, optionsLabels } from "../config/storyCraft";
import type { StoryMode } from "../config/storyCraftCatalog";
import { BOOK_LANGUAGES, type BookLanguageId } from "../config/bookLanguages";
import { storyDetailsSchema } from "../guide/storyDetails";
import { CAST_KINDS, castKindPhrase, isPerson, missingDetails } from "./castKinds";
import { CAST_RELATION_TYPES, relationPromptLines, relationsOf } from "./relations";

const bookLanguageIdSchema = z.enum(
  BOOK_LANGUAGES.map((language) => language.id) as [BookLanguageId, ...BookLanguageId[]],
);

const likenessPhotoSchema = z.object({
  createdAt: z.number(),
  expiresAt: z.number(),
  consentVersion: z.string().min(1).max(40),
});

const sourceArtSchema = z.object({
  blobId: z.string().min(1),
  mimeType: z.string().min(1).max(80),
  createdAt: z.number(),
  origin: z.literal("portrait").optional(),
});

const storyCastMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(80),
  kind: z.enum(CAST_KINDS).optional(),
  species: z.string().max(80).optional(),
  role: z.string().max(200).optional(),
  age: z.number().int().min(0).max(120).optional(),
  ageMonths: z.number().int().min(0).max(1200).optional(),
  visualAge: z
    .object({
      years: z.number().int().min(0).max(120),
      source: z.enum(["story", "suggested"]),
    })
    .optional(),
  note: z.string().max(500).optional(),
  aliases: z.array(z.string().max(60)).max(8).optional(),
  lookFromArt: z.string().max(500).optional(),
  appearance: z.string().max(600).optional(),
  appearanceFromStory: z.boolean().optional(),
  bodyPlan: z.enum(["bipedal", "quadruped", "avian", "aquatic", "amorphous"]).optional(),
  likenessPhoto: likenessPhotoSchema.optional(),
  moreLikenessPhotos: z.array(likenessPhotoSchema).max(LIKENESS_PHOTOS_MAX - 1).optional(),
  sourceArt: z.array(sourceArtSchema).max(SOURCE_ART_MAX).optional(),
});

const castRelationSchema = z.object({
  ids: z.array(z.string().min(1)).min(2).max(8),
  type: z.enum(CAST_RELATION_TYPES),
  label: z.string().max(120).optional(),
  lookAlike: z.enum(["identical", "different"]).optional(),
});

/**
 * The wire/storage shape of a brief. Used by the wizard for local validation
 * and by the backend to sanitise an incoming generation request — the mode
 * picks the prompt template and the ids index the admin catalog, so neither can
 * be taken on trust.
 */
export const storyBriefSchema = z.object({
  mode: z.enum(["guided", "co-write", "own"]),
  themeId: z.string().max(60).nullable().optional(),
  customTheme: z.string().max(500).optional(),
  deviceId: z.string().max(60).nullable().optional(),
  deviceIds: z.array(z.string().max(60)).max(2).optional(),
  customDevice: z.string().max(500).optional(),
  settingId: z.string().max(60).nullable().optional(),
  customSetting: z.string().max(500).optional(),
  heroNames: z.array(z.string().max(80)).max(12).optional(),
  cast: z.array(storyCastMemberSchema).max(12).optional(),
  relations: z.array(castRelationSchema).max(12).optional(),
  occasion: z.string().max(1000).optional(),
  when: z.string().max(500).optional(),
  where: z.string().max(500).optional(),
  mustInclude: z.string().max(1000).optional(),
  details: storyDetailsSchema.optional(),
  sourceText: z.string().max(4000).optional(),
  generatedAt: z.number().optional(),
  generatedSignature: z.string().max(4000).optional(),
  generatedForAge: z.string().max(40).optional(),
  generatedForLocale: bookLanguageIdSchema.optional(),
});

export function createDefaultStoryBrief(mode: StoryMode): StoryBrief {
  return { mode, themeId: null, deviceId: null, settingId: null };
}

/**
 * The guide's default: we write the story. Used when a book has no brief yet so
 * the chat never has to ask "Create with AI / Guided by details / My own words".
 *
 * No-op when a brief already exists — a book that came from the wizard, or one
 * whose reader already chose, must not be rewritten into guided.
 */
export function withGuidedBriefIfMissing(project: Project): Project {
  if (project.config.storyBrief) return project;
  return {
    ...project,
    config: { ...project.config, storyBrief: createDefaultStoryBrief("guided") },
  };
}

/**
 * Keep catalog selections valid for the book's current age band.
 *
 * A band change, option deletion, or forged request may leave ids from another
 * catalog in a persisted brief. Unknown ids are removed rather than reaching a
 * prompt, duplicate devices collapse, and the product's two-device limit is
 * enforced independently of the UI.
 */
export function normalizeStoryBriefForCraft(
  brief: StoryBrief,
  craft: Pick<AgeBandStoryCraft, "themes" | "devices" | "settings">,
): StoryBrief {
  const themeIds = new Set(craft.themes.map((option) => option.id));
  const deviceIds = new Set(craft.devices.map((option) => option.id));
  const settingIds = new Set(craft.settings.map((option) => option.id));
  const requestedDevices =
    brief.deviceIds && brief.deviceIds.length > 0
      ? brief.deviceIds
      : brief.deviceId
        ? [brief.deviceId]
        : [];
  const validDevices = requestedDevices
    .filter((id, index, all) => deviceIds.has(id) && all.indexOf(id) === index)
    .slice(0, 2);

  return {
    ...brief,
    themeId: brief.themeId && themeIds.has(brief.themeId) ? brief.themeId : null,
    deviceId: validDevices[0] ?? null,
    deviceIds: validDevices,
    settingId: brief.settingId && settingIds.has(brief.settingId) ? brief.settingId : null,
  };
}

/** Longest note for the pictures a reader can give with their own story. */
export const PICTURE_NOTES_MAX = 600;

/** The brief for a config, defaulting to guided mode for older projects. */
export function briefOf(config: { storyBrief?: StoryBrief }): StoryBrief {
  return config.storyBrief ?? createDefaultStoryBrief("guided");
}

export function newCastMember(): StoryCastMember {
  return {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: "",
  };
}

/** Cast members with an actual name, in order. */
export function namedCast(brief: StoryBrief): StoryCastMember[] {
  return (brief.cast ?? []).filter((c) => c.name.trim().length > 0);
}

export function hasCharacterAge(
  member: Pick<StoryCastMember, "age" | "ageMonths">,
): boolean {
  return member.age !== undefined || member.ageMonths !== undefined;
}

/** From this age a person is a grown-up, not who the book is for. */
export const ADULT_AGE_MONTHS = 18 * 12;

/** Months for audience matching: explicit months, otherwise years × 12. */
export function characterAgeMonths(
  member: Pick<StoryCastMember, "age" | "ageMonths">,
): number | undefined {
  if (member.ageMonths !== undefined) return member.ageMonths;
  if (member.age !== undefined) return member.age * 12;
  return undefined;
}

/**
 * The first named person is the hero the book is for. Their age, when set,
 * is the only character that may preselect the audience band. A dog or a
 * teddy listed first is skipped: their age says nothing about the reader.
 */
export function audienceSourceCharacter(
  cast: StoryCastMember[] | undefined,
): StoryCastMember | undefined {
  const people = (cast ?? []).filter((member) => member.name.trim().length > 0 && isPerson(member));
  // A grown-up listed first (a parent, a grandparent) is not who the book is
  // for: the first child is, whoever was named before them.
  const first =
    people.find((member) => !(hasCharacterAge(member) && (characterAgeMonths(member) ?? 0) >= ADULT_AGE_MONTHS)) ??
    people[0];
  if (!first || !hasCharacterAge(first)) return undefined;
  return first;
}

/**
 * Splits raw input on commas, ampersands, pluses, slashes, semicolons,
 * or standalone conjunction words (and, und, et, y, etc.) into clean name tokens.
 */
export function splitHeroNames(raw: string): string[] {
  return raw
    .split(/[,;\n\r&+/]+|\b(?:and|und|et|y)\b/i)
    .map((s) => s.trim().replace(/^['"‘“]+|['"’”]+$/g, ""))
    .filter(Boolean);
}

/** The guided-mode hero names with an actual value, trimmed and properly split, in order. */
export function namedHeroes(brief: StoryBrief): string[] {
  // New guided briefs keep each hero in `cast` so age and appearance travel
  // with the name. Fall back to `heroNames` for older projects.
  const guidedCast = brief.mode === "guided" ? namedCast(brief).map((member) => member.name) : [];
  const list = guidedCast.length > 0 ? guidedCast : (brief.heroNames ?? []);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    for (const part of splitHeroNames(item)) {
      const key = part.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(part);
      }
    }
  }
  return result;
}

/**
 * Whether there's enough in the brief to generate. Guided needs at least one
 * name; co-write needs a name and something to happen. "Own" never generates.
 */
export function isBriefReady(brief: StoryBrief): boolean {
  switch (brief.mode) {
    case "guided": {
      const heroes = namedCast(brief);
      return heroes.length > 0 && heroes.every((hero) => missingDetails(hero).length === 0);
    }
    case "co-write": {
      const cast = namedCast(brief);
      return cast.length > 0 && missingDetails(cast[0]!).length === 0 && Boolean(brief.occasion?.trim());
    }
    case "own":
      return false;
  }
}

/** Per-mode explanation of what's still missing (empty when ready). */
export function briefBlockers(brief: StoryBrief): string[] {
  const out: string[] = [];
  if (brief.mode === "guided") {
    const heroes = namedCast(brief);
    if (heroes.length === 0) {
      out.push("Add at least one character the story is about.");
    } else {
      const missingAge = heroes.filter((hero) => missingDetails(hero).includes("age"));
      if (missingAge.length === 1) {
        out.push(`Add ${missingAge[0]?.name}’s age to create the story.`);
      } else if (missingAge.length > 1) {
        out.push(`Add ages for ${missingAge.map((h) => h.name).join(" and ")} to create the story.`);
      }
      for (const hero of heroes.filter((member) => missingDetails(member).includes("species"))) {
        out.push(`Say what ${hero.name} is — which animal, toy or creature.`);
      }
    }
  }
  if (brief.mode === "co-write") {
    const cast = namedCast(brief);
    if (cast.length === 0) {
      out.push("Add at least one character the story is about.");
    } else {
      const first = cast[0]!;
      const missing = missingDetails(first);
      if (missing.includes("age")) out.push(`Add ${first.name}’s age to create the story.`);
      if (missing.includes("species")) out.push(`Say what ${first.name} is — which animal, toy or creature.`);
    }
    if (!brief.occasion?.trim()) {
      out.push("Say what happens — the occasion or the moment.");
    }
  }
  return out;
}

/**
 * A grammatically correct sentence naming the guided-mode hero(es), for the
 * draft prompt. Kept as one pre-built sentence (rather than separate
 * name/plural-flag variables) so the template can't land on a mismatched verb
 * when one, two, or a handful of names are given.
 */
export function heroesLine(brief: StoryBrief): string {
  const all = namedHeroes(brief);
  if (all.length === 0) return "";
  const byName = new Map(namedCast(brief).map((member) => [member.name.trim().toLowerCase(), member]));
  const memberOf = (name: string) => byName.get(name.toLowerCase());
  const describe = (name: string) => {
    const member = memberOf(name);
    const details = member
      ? [
          castKindPhrase(member),
          member.ageMonths !== undefined && (member.ageMonths < 24 || member.ageMonths % 12 !== 0)
            ? `${member.ageMonths} months old`
            : member.age !== undefined
              ? `${member.age} ${member.age === 1 ? "year" : "years"} old`
              : "",
          member.note?.trim() ?? "",
        ].filter(Boolean)
      : [];
    return `"${name}"${details.length > 0 ? ` (${details.join("; ")})` : ""}`;
  };
  const join = (items: string[]) =>
    items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  const people = all.filter((name) => {
    const member = memberOf(name);
    return !member || isPerson(member);
  });
  const others = all.filter((name) => !people.includes(name));
  const lead =
    people.length === 0
      ? `The heroes of the story are ${join(others.map(describe))} — give each of them a real part to play.`
      : people.length === 1
        ? `The book is for a child called ${describe(people[0]!)}, who is the hero of the story.`
        : `The book is for children called ${join(people.map(describe))}, who are the heroes of the story — give each of them a real part to play, not just a mention.`;
  const companions =
    people.length > 0 && others.length > 0
      ? ` With them in the story: ${join(others.map(describe))} — give ${others.length > 1 ? "each of them" : "them"} a real part too.`
      : "";
  const kinds =
    others.length > 0
      ? " An animal, toy or creature stays exactly what it is, in the words and in the pictures: never turn it into a person."
      : "";
  return `${lead}${companions}${kinds}`;
}

/**
 * A stable fingerprint of everything that changes the story. Deliberately
 * includes the audience: the same brief for 3–5 and for 9–12 are different
 * books, so an age change must mark the existing draft stale.
 */
export function storyBriefSignature(
  brief: StoryBrief,
  ageRangeId: string,
  readingModeId?: string | null,
  contentLocale?: string | null,
): string {
  const effectiveDevices =
    brief.deviceIds && brief.deviceIds.length > 0
      ? [...brief.deviceIds].sort().join(",")
      : brief.deviceId ?? "";

  const parts: string[] = [
    brief.mode,
    ageRangeId,
    readingModeId ?? "",
    ...(contentLocale ? [contentLocale] : []),
    brief.themeId ?? "",
    brief.customTheme?.trim() ?? "",
    effectiveDevices,
    brief.customDevice?.trim() ?? "",
    brief.settingId ?? "",
    brief.customSetting?.trim() ?? "",
    ...namedHeroes(brief),
    brief.occasion?.trim() ?? "",
    brief.when?.trim() ?? "",
    brief.where?.trim() ?? "",
    brief.mustInclude?.trim() ?? "",
    ...Object.keys(brief.details ?? {})
      .sort()
      .map((id) => `${id}=${JSON.stringify(brief.details![id])}`),
    ...namedCast(brief).map(
      (c) =>
        `${c.name.trim()}|${c.role?.trim() ?? ""}|${c.age ?? ""}|${c.ageMonths ?? ""}|${c.note?.trim() ?? ""}${
          c.kind || c.species?.trim() ? `|${c.kind ?? ""}|${c.species?.trim() ?? ""}` : ""
        }`,
    ),
    ...(relationsOf(brief).length > 0 ? [relationPromptLines(brief)] : []),
  ];
  return parts.join("\u0001");
}

/** True when the brief has changed since the current draft was written. */
export function isDraftStale(
  brief: StoryBrief,
  storyText: string,
  ageRangeId: string,
  readingModeId?: string | null,
  contentLocale?: string | null,
): boolean {
  if (!storyText.trim() || !brief.generatedSignature) return false;
  return (
    brief.generatedSignature !==
    storyBriefSignature(
      brief,
      ageRangeId,
      readingModeId,
      brief.generatedForLocale ? contentLocale : undefined,
    )
  );
}

/** One-line description of the brief for the topic strip and review screens. */
export function briefSummary(brief: StoryBrief, craft: AgeBandStoryCraft): string {
  const theme = optionLabel(craft.themes, brief.themeId ?? undefined, brief.customTheme);
  switch (brief.mode) {
    case "guided": {
      const names = namedHeroes(brief);
      const who =
        names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(" & ");
      return [who, theme].filter(Boolean).join(" · ") || "Nothing chosen yet";
    }
    case "co-write": {
      const names = namedCast(brief).map((c) => c.name.trim());
      const who =
        names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(" & ");
      return [who, brief.occasion?.trim()].filter(Boolean).join(" · ") || "Nothing chosen yet";
    }
    case "own":
      return "Your own words";
  }
}

/** Whether the prompt's cast list says more than the names: roles, kinds or relations. */
export function castHasDetails(brief: StoryBrief): boolean {
  return (
    namedCast(brief).some((member) => Boolean(member.role?.trim()) || !isPerson(member)) ||
    relationsOf(brief).length > 0
  );
}

/** The cast rendered for the prompt, one per line, then how they belong together. */
export function castPromptLines(brief: StoryBrief): string {
  const relations = relationPromptLines(brief);
  const lines = namedCast(brief)
    .map((c) => {
      const isMonth =
        c.ageMonths !== undefined && (c.ageMonths < 24 || c.ageMonths % 12 !== 0);
      const ageStr = isMonth
        ? `${c.ageMonths} months old`
        : c.age != null
          ? `${c.age} ${c.age === 1 ? "year" : "years"} old`
          : "";
      const look = c.lookFromArt?.trim();
      const appearance = c.appearance?.trim();
      const bits = [
        castKindPhrase(c),
        c.role?.trim(),
        ageStr,
        look,
        appearance && appearance !== look ? appearance : "",
        c.bodyPlan && c.bodyPlan !== "bipedal" ? c.bodyPlan : "",
        c.note?.trim(),
      ].filter(Boolean);
      return `- ${c.name.trim()}${bits.length > 0 ? ` (${bits.join("; ")})` : ""}`;
    })
    .join("\n");
  return relations ? `${lines}\nHow they belong together:\n${relations}` : lines;
}

export function wordCount(text: string): number {
  return text.normalize("NFC").match(/\p{L}[\p{L}\p{M}\p{N}'’\-]*/gu)?.length ?? 0;
}
