/**
 * Suggesting what happens on a page.
 *
 * A parent adding a page often knows the words and not what to draw. This reads
 * the page's words and the pages around it and writes "what's happening": the
 * one moment the picture shows. It is free for the reader and asks nothing of
 * the picture model.
 *
 * Whatever the model writes passes through code before it is shown: a style
 * request is taken out (the look is the book's, `withoutStyleAsides`), people
 * are matched to the book's own people by name (a name that is not in the book
 * is dropped, never invented), and the length is bounded.
 */
import { z } from "zod";
import type { ProviderId } from "../config/options";
import type { PromptContext } from "../prompts/context";
import { resolvePromptsConfig } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import { withRetry } from "../pipeline/retry";
import { cleanScene, SCENE_MAX, WORDS_MAX, CAST_MAX } from "./pagePlan";

export interface PageSceneRequest {
  /** `suggest` writes a first description; `rewrite` tidies the one the reader wrote. */
  mode: "suggest" | "rewrite";
  words: string;
  /** The current description (rewrite). */
  scene: string;
  /** What the reader wants different (rewrite). */
  instruction: string;
  /** What the pages on either side show, in their own words. Empty when there is no such page. */
  before: string;
  after: string;
  /** The book's own people. Only these can be named in the answer. */
  people: { id: string; name: string; what?: string }[];
  /** Who the book is for, as a label ("ages 3 to 5"). */
  audience: string;
}

export interface PageSceneResult {
  scene: string;
  /** Ids of the people the scene names, in the order named. */
  peopleIds: string[];
}

export const pageSceneSchema = z.object({
  scene: z.string().max(4_000),
  people: z.array(z.string().max(120)).max(24).optional(),
});

const NEIGHBOUR_MAX = 400;

/** The most a client may send for the people list. */
const PEOPLE_MAX = 24;

/** What the model wrote, made safe to show: no style, only the book's people, bounded. */
export function sanitizePageScene(raw: z.infer<typeof pageSceneSchema>, people: PageSceneRequest["people"]): PageSceneResult | null {
  const scene = cleanScene(raw.scene).slice(0, SCENE_MAX).trim();
  if (!scene) return null;
  const byName = new Map(people.map((person) => [person.name.trim().toLowerCase(), person.id]));
  const peopleIds: string[] = [];
  for (const name of raw.people ?? []) {
    const id = byName.get(name.trim().toLowerCase());
    if (id && !peopleIds.includes(id)) peopleIds.push(id);
  }
  return { scene, peopleIds: peopleIds.slice(0, CAST_MAX) };
}

function limited(text: string, max: number): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, max);
}

/** The request as a server should accept it, whatever a client sent. */
export function boundedPageSceneRequest(input: Partial<PageSceneRequest> | null | undefined): PageSceneRequest {
  const text = (value: unknown, max: number) => (typeof value === "string" ? limited(value, max) : "");
  return {
    mode: input?.mode === "rewrite" ? "rewrite" : "suggest",
    words: typeof input?.words === "string" ? input.words.trim().slice(0, WORDS_MAX) : "",
    scene: text(input?.scene, SCENE_MAX),
    instruction: text(input?.instruction, 300),
    before: text(input?.before, NEIGHBOUR_MAX),
    after: text(input?.after, NEIGHBOUR_MAX),
    people: (Array.isArray(input?.people) ? input!.people : [])
      .filter(
        (person): person is { id: string; name: string; what?: string } =>
          Boolean(person) && typeof person.id === "string" && typeof person.name === "string" && person.name.trim().length > 0,
      )
      .slice(0, PEOPLE_MAX)
      .map((person) => ({
        id: person.id.slice(0, 80),
        name: person.name.trim().slice(0, 80),
        ...(typeof person.what === "string" && person.what.trim() ? { what: limited(person.what, 80) } : {}),
      })),
    audience: text(input?.audience, 80),
  };
}

export interface PageSceneInput {
  request: PageSceneRequest;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

/** Why there is nothing to write from: no words, no neighbors and no description. */
export function hasSomethingToGoOn(request: PageSceneRequest): boolean {
  return Boolean(request.words.trim() || request.scene.trim() || request.before || request.after);
}

export async function suggestPageScene(input: PageSceneInput): Promise<PageSceneResult | null> {
  const { request } = input;
  if (!hasSomethingToGoOn(request)) return null;
  const prompts = resolvePromptsConfig(input.prompts);
  const rewrite = request.mode === "rewrite" && request.scene.trim().length > 0;
  const { system, user } = renderTextPrompt(prompts, rewrite ? "pageScene/rewrite" : "pageScene/suggest", {
    vars: {
      audience: request.audience,
      scene: request.scene,
      instruction: request.instruction,
      words: request.words,
      before: request.before,
      after: request.after,
      people: request.people.length > 0
        ? request.people.map((person) => `- ${person.name}${person.what ? ` (${person.what})` : ""}`).join("\n")
        : "(nobody is named yet)",
    },
    flags: {
      hasAudience: Boolean(request.audience),
      hasInstruction: Boolean(request.instruction),
      hasWords: Boolean(request.words.trim()),
      hasBefore: Boolean(request.before),
      hasAfter: Boolean(request.after),
    },
  });
  const provider = getTextProvider(input.providerId);
  const raw = await withRetry(
    () =>
      provider.generateStructured(input.creds, {
        model: input.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        schema: pageSceneSchema,
        temperature: 0.4,
        signal: input.signal,
      }),
    { signal: input.signal, retries: 1 },
  );
  return sanitizePageScene(raw, request.people);
}
