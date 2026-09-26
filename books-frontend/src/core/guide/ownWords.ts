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
import { briefOf, namedCast, newCastMember } from "../story/brief";
import type { Project, StoryCastMember } from "../types";
import { authoringOf, withAuthoring } from "./projectState";

export const OWN_WORDS_MAX_CHARS = 40_000;

const personSchema = z.object({
  name: z.string().min(1).max(80),
  age: z.number().int().min(0).max(120).nullable().optional(),
  ageMonths: z.number().int().min(0).max(36).nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const manuscriptCastSchema = z.object({
  people: z.array(personSchema).max(24),
  unclear: z.array(z.string().max(80)).max(24),
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
    people.push({ ...person, name });
    if (person.confidence < OWN_WORDS_CONFIDENCE) unclear.add(name);
    else settled.add(key);
  }
  return {
    people,
    unclear: [...unclear].filter((name) => {
      const key = name.toLowerCase();
      return text.includes(key) && !settled.has(key);
    }),
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
  for (const person of found.people) {
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
      continue;
    }
    const member: StoryCastMember = {
      ...newCastMember(),
      name: person.name,
      ...(person.age != null ? { age: person.age } : {}),
      ...(person.ageMonths != null ? { ageMonths: person.ageMonths } : {}),
    };
    cast.push(member);
  }
  const next: Project = {
    ...project,
    config: { ...project.config, storyBrief: { ...brief, mode: "own", cast } },
  };
  return withAuthoring(next, {
    extraction: {
      storyHash: manuscriptHash(story),
      at: Date.now(),
      names: found.people.map((p) => p.name),
      unresolved: found.unclear,
    },
  });
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

/**
 * Add people the story analysis found who are not already on the plates.
 *
 * Proper names come from the manuscript reader. Roles such as Mom, Dad and
 * the surgeon come from the same analysis the steps cast uses. Analysis ages
 * are copied as transparent visual estimates, never as author-supplied facts.
 */
export function withAnalysisCharacters(
  project: Project,
  anchors: readonly { name: string; type: string; ageYears?: number; ageSource?: string; aliasNames?: string[] }[],
): Project {
  const brief = briefOf(project.config);
  const cast = [...(brief.cast ?? [])];
  const seen = new Set(cast.map((member) => member.name.trim().toLowerCase()).filter(Boolean));
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
    const existingIndex = cast.findIndex((member) =>
      keys.includes(member.name.trim().toLowerCase()),
    );
    if (existingIndex >= 0) {
      const existing = cast[existingIndex]!;
      if (
        existing.age === undefined &&
        existing.ageMonths === undefined &&
        visualAge &&
        (existing.visualAge?.years !== visualAge.years ||
          existing.visualAge?.source !== visualAge.source)
      ) {
        cast[existingIndex] = { ...existing, visualAge };
        changed = true;
      }
      for (const key of keys) seen.add(key);
      continue;
    }
    if (keys.some((key) => seen.has(key))) continue;
    cast.push({
      ...newCastMember(),
      name,
      ...(visualAge ? { visualAge } : {}),
    });
    for (const key of keys) seen.add(key);
    changed = true;
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
