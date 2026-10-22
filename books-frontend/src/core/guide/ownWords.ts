/**
 * "I'll use my own words": reading a pasted manuscript for who is in it.
 *
 * The extraction only ever returns names and ages the text states. It never
 * rewrites, summarises or judges the story, and the manuscript is never touched
 * here. What it found becomes one receipt ("Found Maya and Leo") with Edit
 * people beside it; anything ambiguous — a duplicate name, an age that
 * contradicts itself, an unclear protagonist — must be corrected before
 * anything is drawn.
 */
import { z } from "zod";
import type { ProviderId } from "../config/options";
import type { PromptContext } from "../prompts/context";
import { resolvePromptsConfig } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import { withRetry } from "../pipeline/retry";
import { describesSomeoneElse } from "../book/anchorDescription";
import { briefOf, namedCast, newCastMember } from "../story/brief";
import { CAST_KINDS } from "../story/castKinds";
import { relationsOf, twinGroups, withRelation } from "../story/relations";
import { BODY_PLANS, type BodyPlan, type Project, type StoryBrief, type StoryCastMember } from "../types";
import { linkSameAge } from "./sameAge";
import { currentPortrait } from "./portrait";
import { authoringOf, withAuthoring } from "./projectState";

export const OWN_WORDS_MAX_CHARS = 40_000;

const personSchema = z.object({
  name: z.string().min(1).max(80),
  age: z.number().int().min(0).max(120).nullable().optional(),
  ageMonths: z.number().int().min(0).max(36).nullable().optional(),
  /** What they are. A dog in the story is drawn as a dog, not asked for an age. */
  kind: z.enum(CAST_KINDS).nullable().optional(),
  /** For anything not a person, as the text names it: "dog", "teddy bear". */
  species: z.string().max(60).nullable().optional(),
  /** Who they are to the others, as the text says it: "her little brother". */
  role: z.string().max(80).nullable().optional(),
  confidence: z.number().min(0).max(1),
});

const relationSchema = z.object({
  /** Two or more names from `people`. */
  names: z.array(z.string().min(1).max(80)).min(2).max(6),
  type: z.enum(["twins", "siblings"]),
  /** The story's own words that say it, copied exactly. */
  evidence: z.string().max(300),
});

export const manuscriptCastSchema = z.object({
  people: z.array(personSchema).max(24),
  unclear: z.array(z.string().max(80)).max(24),
  /** How people belong together, when the text says so. */
  relations: z.array(relationSchema).max(12).nullable().optional(),
});

export type ManuscriptCast = z.infer<typeof manuscriptCastSchema>;

/** Below this a found person is shown as needing a look before drawing. */
export const OWN_WORDS_CONFIDENCE = 0.7;

/** Cheap stable fingerprint of the manuscript an extraction read. */
export function manuscriptHash(text: string): string {
  const normalized = text.slice(0, OWN_WORDS_MAX_CHARS).replace(/\s+/g, " ").trim();
  let h = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${normalized.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Keep only what the text supports: names that occur in the manuscript,
 * de-duplicated case-insensitively. A repeated or near-duplicate name is
 * flagged instead of merged.
 */
export function sanitizeManuscriptCast(raw: ManuscriptCast, story: string): ManuscriptCast {
  const text = story.toLowerCase();
  const seen = new Map<string, string>();
  const settled = new Set<string>();
  const people: ManuscriptCast["people"] = [];
  const unclear = new Set(raw.unclear.map((n) => n.trim()).filter(Boolean));
  for (const person of raw.people) {
    const name = person.name.trim();
    if (!name || !text.includes(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      if (!settled.has(key) || person.confidence < OWN_WORDS_CONFIDENCE) {
        unclear.add(name);
      }
      continue;
    }
    seen.set(key, name);
    people.push({ ...person, name, ...groundedDetails(person, text) });
    if (person.confidence < OWN_WORDS_CONFIDENCE) unclear.add(name);
    else settled.add(key);
  }
  return {
    people,
    unclear: [...unclear].filter((name) => {
      const key = name.toLowerCase();
      return text.includes(key) && !settled.has(key);
    }),
    relations: groundedRelations(raw.relations ?? [], people, text),
  };
}

function squeezed(text: string): string {
  return text.toLowerCase().replace(/[\s’'"“”‘.,!?;:…–—-]+/gu, " ").trim();
}

/**
 * Relations the text itself shows: every name is a person found above, and
 * the quoted words are really in the story. Twins are often only implied
 * ("two babies at the same time"), so the quote is what makes it a fact.
 */
function groundedRelations(
  raw: NonNullable<ManuscriptCast["relations"]>,
  people: ManuscriptCast["people"],
  text: string,
): NonNullable<ManuscriptCast["relations"]> {
  const story = squeezed(text);
  const known = new Map(people.map((person) => [person.name.toLowerCase(), person.name]));
  const kept: NonNullable<ManuscriptCast["relations"]> = [];
  for (const relation of raw) {
    const names = [...new Set(relation.names.map((name) => known.get(name.trim().toLowerCase())).filter((name): name is string => Boolean(name)))];
    const quote = squeezed(relation.evidence);
    if (names.length < 2 || quote.length < 8 || !story.includes(quote)) continue;
    kept.push({ names, type: relation.type, evidence: relation.evidence.trim() });
  }
  return kept;
}

/**
 * The text says it: the phrase itself ("Mom"), or one of its longer words
 * ("her little brother" needs "brother" or "little"; "the" doesn't count).
 */
function stated(phrase: string, text: string): boolean {
  const lower = phrase.toLowerCase();
  if (text.includes(lower)) return true;
  return lower.split(/[^\p{L}\p{N}]+/u).some((word) => word.length >= 4 && text.includes(word));
}

/**
 * What the extraction says someone is, kept only where the text says it too.
 * A kind without a stated species still counts: "Rex barked" makes a dog.
 */
function groundedDetails(
  person: ManuscriptCast["people"][number],
  text: string,
): Pick<ManuscriptCast["people"][number], "kind" | "species" | "role"> {
  const species = person.kind && person.kind !== "person" ? person.species?.trim() : "";
  const role = person.role?.trim();
  return {
    kind: person.kind ?? null,
    species: species && stated(species, text) ? species : null,
    role: role && stated(role, text) ? role : null,
  };
}

/**
 * Fold an extraction into the book's cast.
 *
 * People already on the book keep their plate — photo, drawing, description
 * and portrait — matched by name. New names get a new plate. Nobody is removed:
 * a correction does that, explicitly.
 */
export function withManuscriptCast(project: Project, found: ManuscriptCast, story: string): Project {
  const brief = briefOf(project.config);
  const cast = (brief.cast ?? []).map((member) => ({ ...member }));
  const removed = new Set((authoringOf(project).removedNames ?? []).map((name) => name.trim().toLowerCase()));
  for (const person of found.people) {
    if (removed.has(person.name.trim().toLowerCase())) continue;
    const existing = cast.find((m) => m.name.trim().toLowerCase() === person.name.toLowerCase());
    if (existing) {
      if (existing.age === undefined && person.age != null) {
        existing.age = person.age;
        existing.visualAge = undefined;
      }
      if (existing.ageMonths === undefined && person.ageMonths != null) {
        existing.ageMonths = person.ageMonths;
        existing.visualAge = undefined;
      }
      if (existing.kind === undefined && person.kind) existing.kind = person.kind;
      if (!existing.species?.trim() && person.species && existing.kind === person.kind) existing.species = person.species;
      if (!existing.role?.trim() && person.role) existing.role = person.role;
      continue;
    }
    const member: StoryCastMember = {
      ...newCastMember(),
      name: person.name,
      ...(person.age != null ? { age: person.age } : {}),
      ...(person.ageMonths != null ? { ageMonths: person.ageMonths } : {}),
      ...(person.kind ? { kind: person.kind } : {}),
      ...(person.species ? { species: person.species } : {}),
      ...(person.role ? { role: person.role } : {}),
    };
    cast.push(member);
  }
  let nextBrief: StoryBrief = { ...brief, mode: "own", cast };
  for (const relation of found.relations ?? []) {
    const ids = relation.names
      .map((name) => cast.find((member) => member.name.trim().toLowerCase() === name.toLowerCase())?.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length < 2) continue;
    // A relation the family set themselves is theirs; the reading only adds.
    if (relationsOf(nextBrief).some((existing) => ids.every((id) => existing.ids.includes(id)))) continue;
    nextBrief = withRelation(nextBrief, { ids, type: relation.type });
  }
  let next: Project = {
    ...project,
    config: { ...project.config, storyBrief: nextBrief },
  };
  // Twins share an age: one the story states is carried to the other.
  next = linkSameAge(next, twinGroups(nextBrief)).project;
  return withAuthoring(next, {
    extraction: {
      storyHash: manuscriptHash(story),
      at: Date.now(),
      names: found.people.map((p) => p.name),
      unresolved: found.unclear,
    },
  });
}

/**
 * Whether the story has been handed over: always for a story the guide wrote;
 * for the reader's own words, once they said it is done. Books read before
 * this was asked (an extraction, a page plan or started pages) count as
 * handed over, so none of them waits on a button it never showed.
 */
export function storyHandedOver(project: Project): boolean {
  const state = authoringOf(project);
  const own = state.entry ? state.entry === "own" : briefOf(project.config).mode === "own";
  if (!own) return true;
  if (!project.config.storyText.trim()) return false;
  return Boolean(state.manuscriptReadyAt || state.extraction || state.lockedAt || project.screenplay);
}

/** Whether the current manuscript has been read, and what still needs fixing. */
export function ownWordsStatus(project: Project): {
  read: boolean;
  names: string[];
  unresolved: string[];
} {
  const extraction = authoringOf(project).extraction;
  const read = Boolean(extraction && extraction.storyHash === manuscriptHash(project.config.storyText));
  if (!read || !extraction) return { read: false, names: [], unresolved: [] };
  const live = new Set(namedCast(briefOf(project.config)).map((m) => m.name.trim().toLowerCase()));
  const names = namedCast(briefOf(project.config)).map((m) => m.name.trim());
  return {
    read,
    names,
    unresolved: extraction.unresolved.filter((n) => live.has(n.toLowerCase())),
  };
}

/** A plate the family has already given a look to. Story analysis must not replace it. */
function familyOwnsLook(member: StoryCastMember): boolean {
  if (member.likenessPhoto || member.sourceArt?.length || member.lookFromArt?.trim()) return true;
  if (member.lookSource === "photo" || member.lookSource === "drawing" || member.lookSource === "invent") return true;
  return Boolean(member.appearance?.trim()) && !member.appearanceFromStory;
}

function asBodyPlan(value: unknown): BodyPlan | undefined {
  return typeof value === "string" && (BODY_PLANS as readonly string[]).includes(value)
    ? (value as BodyPlan)
    : undefined;
}

/**
 * The story's visual characterization, when this plate is still open for it.
 * A description the family wrote, a photo, or a drawing stays as they left it.
 */
function storyLookPatch(
  member: StoryCastMember,
  anchor: { description?: string; bodyPlan?: string },
): Partial<StoryCastMember> | null {
  if (familyOwnsLook(member)) return null;
  const incoming = anchor.description?.trim().slice(0, 600) ?? "";
  const incomingStolen = describesSomeoneElse(member.name, incoming);
  const heldStolen =
    Boolean(member.appearanceFromStory) && describesSomeoneElse(member.name, member.appearance ?? "");
  const bodyPlan = asBodyPlan(anchor.bodyPlan);
  const patch: Partial<StoryCastMember> = {};
  // A reading that described the sister on the brother's row is not a look.
  // Drop it, including one already copied onto the plate.
  if (heldStolen && (incomingStolen || !incoming)) {
    patch.appearance = "";
    patch.appearanceFromStory = false;
  } else if (incoming && !incomingStolen && incoming !== member.appearance?.trim()) {
    patch.appearance = incoming;
    patch.appearanceFromStory = true;
  }
  if (bodyPlan && bodyPlan !== member.bodyPlan) patch.bodyPlan = bodyPlan;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Add people the story analysis found who are not already on the plates.
 *
 * Proper names come from the manuscript reader. Roles such as Mom, Dad and
 * the surgeon come from the same analysis the steps cast uses. Analysis ages
 * are copied as transparent visual estimates, never as author-supplied facts.
 * The visual description and body plan are copied too, so a portrait draws
 * the being the story named — a frog stays a frog — until the family supplies
 * their own look.
 */
export function withAnalysisCharacters(
  project: Project,
  anchors: readonly {
    name: string;
    type: string;
    ageYears?: number;
    ageSource?: string;
    aliasNames?: string[];
    description?: string;
    bodyPlan?: string;
    /** The cast member this character is, when the reading knows. */
    castId?: string;
  }[],
): Project {
  const brief = briefOf(project.config);
  const cast = [...(brief.cast ?? [])];
  const seen = new Set(cast.map((member) => member.name.trim().toLowerCase()).filter(Boolean));
  for (const name of authoringOf(project).removedNames ?? []) seen.add(name.trim().toLowerCase());
  let changed = false;
  for (const anchor of anchors) {
    if (anchor.type !== "character") continue;
    const name = anchor.name.trim();
    const keys = [name, ...(anchor.aliasNames ?? [])].map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!name) continue;
    const visualAge =
      typeof anchor.ageYears === "number"
        ? {
            years: Math.max(0, Math.min(120, Math.round(anchor.ageYears))),
            source: anchor.ageSource === "story" ? ("story" as const) : ("suggested" as const),
          }
        : undefined;
    // A person the cast already has, however the story words them now, is that person.
    const linkedIndex = anchor.castId ? cast.findIndex((member) => member.id === anchor.castId) : -1;
    const existingIndex =
      linkedIndex >= 0
        ? linkedIndex
        : cast.findIndex((member) => keys.includes(member.name.trim().toLowerCase()));
    if (existingIndex >= 0) {
      let existing = cast[existingIndex]!;
      // Someone already drawn keeps the age they were drawn at. Reading the
      // story again re-guesses an estimate every time, and a guess one year
      // apart is a different-looking child: it would call for a redraw nobody
      // asked for. What the story states outright still counts.
      const drawn = currentPortrait(project, existing.id) !== null;
      const reGuess = drawn && visualAge?.source !== "story";
      if (
        existing.age === undefined &&
        existing.ageMonths === undefined &&
        visualAge &&
        !reGuess &&
        (existing.visualAge?.years !== visualAge.years ||
          existing.visualAge?.source !== visualAge.source)
      ) {
        existing = { ...existing, visualAge };
        cast[existingIndex] = existing;
        changed = true;
      }
      const look = storyLookPatch(existing, anchor);
      if (look) {
        cast[existingIndex] = { ...existing, ...look };
        changed = true;
      }
      for (const key of keys) seen.add(key);
      continue;
    }
    if (keys.some((key) => seen.has(key))) continue;
    const member: StoryCastMember = {
      ...newCastMember(),
      name,
      ...(visualAge ? { visualAge } : {}),
    };
    cast.push({ ...member, ...(storyLookPatch(member, anchor) ?? {}) });
    for (const key of keys) seen.add(key);
    changed = true;
  }
  // Twins are drawn the same age: a stated age wins, else one estimate for both.
  for (const relation of relationsOf({ ...brief, cast })) {
    if (relation.type !== "twins") continue;
    const twins = relation.ids
      .map((id) => cast.findIndex((member) => member.id === id))
      .filter((index) => index >= 0);
    const stated = twins.map((index) => cast[index]!).find((member) => member.age !== undefined || member.ageMonths !== undefined);
    const years = stated
      ? (stated.age ?? Math.floor((stated.ageMonths ?? 0) / 12))
      : (twins.map((index) => cast[index]!.visualAge).find((age) => age?.source === "story") ??
          cast[twins[0] ?? -1]?.visualAge)?.years;
    if (years === undefined) continue;
    for (const index of twins) {
      const member = cast[index]!;
      if (member.age !== undefined || member.ageMonths !== undefined || member.visualAge?.years === years) continue;
      cast[index] = { ...member, visualAge: { years, source: member.visualAge?.source ?? "suggested" } };
      changed = true;
    }
  }
  if (!changed) return project;
  return { ...project, config: { ...project.config, storyBrief: { ...brief, cast } } };
}

/** The reader corrected the people: nothing left to resolve for this manuscript. */
export function withCastResolved(project: Project): Project {
  const extraction = authoringOf(project).extraction;
  if (!extraction) return project;
  return withAuthoring(project, { extraction: { ...extraction, unresolved: [] } });
}

export interface ExtractManuscriptCastInput {
  story: string;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

export async function extractManuscriptCast(input: ExtractManuscriptCastInput): Promise<ManuscriptCast> {
  const story = input.story.slice(0, OWN_WORDS_MAX_CHARS).trim();
  if (!story) return { people: [], unclear: [] };
  const prompts = resolvePromptsConfig(input.prompts);
  const { system, user } = renderTextPrompt(prompts, "guideExtractCast/default", { vars: { story } });
  const provider = getTextProvider(input.providerId);
  const raw = await withRetry(
    () =>
      provider.generateStructured(input.creds, {
        model: input.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        schema: manuscriptCastSchema,
        temperature: 0,
        signal: input.signal,
      }),
    { signal: input.signal, retries: 1 },
  );
  return sanitizeManuscriptCast(raw, story);
}
