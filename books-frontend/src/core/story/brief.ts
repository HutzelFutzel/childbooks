/**
 * Pure helpers for the story brief — the record of what the reader told us
 * before the story existed. Shared by the Story UI, the draft pipeline and the
 * backend route, so "is this brief ready?" and "is this draft stale?" answer
 * the same way everywhere.
 */
import { z } from "zod";
import type { StoryBrief, StoryCastMember } from "../types";
import type { AgeBandStoryCraft } from "../config/storyCraftCatalog";
import { optionLabel, optionsLabels } from "../config/storyCraft";
import type { StoryMode } from "../config/storyCraftCatalog";
import { BOOK_LANGUAGES, type BookLanguageId } from "../config/bookLanguages";

const bookLanguageIdSchema = z.enum(
  BOOK_LANGUAGES.map((language) => language.id) as [BookLanguageId, ...BookLanguageId[]],
);

const storyCastMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(80),
  role: z.string().max(200).optional(),
  age: z.number().int().min(0).max(120).optional(),
  note: z.string().max(500).optional(),
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
  deviceIds: z.array(z.string().max(60)).max(10).optional(),
  customDevice: z.string().max(500).optional(),
  settingId: z.string().max(60).nullable().optional(),
  customSetting: z.string().max(500).optional(),
  heroNames: z.array(z.string().max(80)).max(12).optional(),
  cast: z.array(storyCastMemberSchema).max(12).optional(),
  occasion: z.string().max(1000).optional(),
  when: z.string().max(500).optional(),
  where: z.string().max(500).optional(),
  mustInclude: z.string().max(1000).optional(),
  generatedAt: z.number().optional(),
  generatedSignature: z.string().max(4000).optional(),
  generatedForAge: z.string().max(40).optional(),
  generatedForLocale: bookLanguageIdSchema.optional(),
});

export function createDefaultStoryBrief(mode: StoryMode): StoryBrief {
  return { mode, themeId: null, deviceId: null, settingId: null };
}

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
      return heroes.length > 0 && heroes.every((hero) => hero.age !== undefined);
    }
    case "co-write": {
      const cast = namedCast(brief);
      return cast.length > 0 && cast[0]?.age !== undefined && Boolean(brief.occasion?.trim());
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
    if (heroes.length === 0) out.push("Add the name of at least one child this book is for.");
    else if (heroes.some((hero) => hero.age === undefined)) {
      out.push("Add the age of each main character.");
    }
  }
  if (brief.mode === "co-write") {
    const cast = namedCast(brief);
    if (cast.length === 0) out.push("Add at least one person the story is about.");
    else if (cast[0]?.age === undefined) out.push("Add the main character's age.");
    if (!brief.occasion?.trim()) out.push("Say what happens — the occasion or the moment.");
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
  const names = namedHeroes(brief);
  if (names.length === 0) return "";
  const people = namedCast(brief);
  const detailsByName = new Map(
    people.map((person) => [
      person.name.trim().toLowerCase(),
      [
        person.age !== undefined ? `${person.age} years old` : "",
        person.note?.trim() ?? "",
      ].filter(Boolean),
    ]),
  );
  const describe = (name: string) => {
    const details = detailsByName.get(name.toLowerCase()) ?? [];
    return `"${name}"${details.length > 0 ? ` (${details.join("; ")})` : ""}`;
  };
  if (names.length === 1) {
    return `The book is for a child called ${describe(names[0]!)}, who is the hero of the story.`;
  }
  const described = names.map(describe);
  const joined =
    described.length === 2
      ? described.join(" and ")
      : `${described.slice(0, -1).join(", ")} and ${described[described.length - 1]}`;
  return `The book is for children called ${joined}, who are the heroes of the story — give each of them a real part to play, not just a mention.`;
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
    ...namedCast(brief).map(
      (c) => `${c.name.trim()}|${c.role?.trim() ?? ""}|${c.age ?? ""}|${c.note?.trim() ?? ""}`,
    ),
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

/** The cast rendered for the prompt, one per line. */
export function castPromptLines(brief: StoryBrief): string {
  return namedCast(brief)
    .map((c) => {
      const bits = [c.role?.trim(), c.age != null ? `${c.age} years old` : "", c.note?.trim()].filter(
        Boolean,
      );
      return `- ${c.name.trim()}${bits.length > 0 ? ` (${bits.join("; ")})` : ""}`;
    })
    .join("\n");
}

export function wordCount(text: string): number {
  return text.normalize("NFC").match(/\p{L}[\p{L}\p{M}\p{N}'’\-]*/gu)?.length ?? 0;
}
