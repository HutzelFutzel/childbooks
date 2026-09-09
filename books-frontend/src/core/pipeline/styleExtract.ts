/**
 * Derive a book-level art-style prompt from uploaded character drawings.
 *
 * The model must describe ONLY rendering technique — never characters, clothes,
 * scenes or composition. Callers fold the result into `ArtStyleSelection`.
 */
import { z } from "zod";
import { getTextProvider } from "../providers";
import type { InputImage, ProviderCredentials } from "../providers/types";
import type { ProviderId } from "../config/options";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import { withRetry } from "./retry";
import { normalizeAnchorName } from "../book/anchorRefs";

const extractSchema = z.object({
  compatible: z.boolean(),
  stylePrompt: z.string(),
  characters: z
    .array(
      z.object({
        id: z.string(),
        stylePrompt: z.string(),
      }),
    )
    .optional(),
});

export interface SourceArtCharacterInput {
  id: string;
  name: string;
  images: InputImage[];
}

export interface ExtractedCharacterStyle {
  id: string;
  name: string;
  stylePrompt: string;
}

export interface ExtractArtStyleResult {
  compatible: boolean;
  stylePrompt: string;
  characters: ExtractedCharacterStyle[];
}

export interface ExtractArtStyleInput {
  characters: SourceArtCharacterInput[];
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

function sanitizeStylePrompt(text: string, names: string[]): string {
  const original = text.replace(/\s+/g, " ").trim();
  let next = original;
  for (const name of names) {
    const trimmed = name.trim();
    // Short names overlap medium words ("Ink", "Oil") and gut the prompt.
    if (trimmed.length < 4) continue;
    next = next.replace(new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "gi"), "").trim();
  }
  next = next.replace(/\s{2,}/g, " ").replace(/^[,;:.]+/, "").trim();
  return looksLikeStyle(next) ? next : original;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeStyle(text: string): boolean {
  return text.trim().length >= 24;
}

/** Extract a shared (or per-character) style prompt from the drawings. */
export async function extractArtStyleFromImages(
  input: ExtractArtStyleInput,
): Promise<ExtractArtStyleResult> {
  const characters = input.characters.filter((c) => c.images.length > 0);
  if (characters.length === 0) {
    throw new Error("Add character artwork first.");
  }

  const names = characters.map((c) => c.name);
  const legend = characters
    .flatMap((c, ci) =>
      c.images.map((_image, ii) => {
        const n = characters.slice(0, ci).reduce((sum, x) => sum + x.images.length, 0) + ii + 1;
        return ii === 0
          ? `Image (${n}) is existing artwork of "${c.name}" (id "${c.id}").`
          : `Image (${n}) is another picture of "${c.name}" (id "${c.id}").`;
      }),
    )
    .join(" ");

  const images: InputImage[] = characters.flatMap((c, ci) =>
    c.images.map((image, ii) => {
      const n = characters.slice(0, ci).reduce((sum, x) => sum + x.images.length, 0) + ii + 1;
      return {
        ...image,
        label:
          ii === 0
            ? `Image (${n}) is existing artwork of "${c.name}" (id "${c.id}").`
            : `Image (${n}) is another picture of "${c.name}" (id "${c.id}").`,
      };
    }),
  );
  const { system, user } = renderTextPrompt(resolvePromptsConfig(input.prompts), "extractArtStyle", {
    vars: { legend, characterCount: String(characters.length) },
    flags: { severalCharacters: characters.length > 1 },
  });

  const provider = getTextProvider(input.providerId);
  const raw = await withRetry(
    () =>
      provider.generateStructured(input.creds, {
        model: input.model,
        schema: extractSchema,
        schemaName: "extract_art_style",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        images,
        signal: input.signal,
      }),
    { signal: input.signal, retries: 1 },
  );

  const byId = new Map(characters.map((c) => [c.id, c]));
  const perCharacter: ExtractedCharacterStyle[] = [];
  for (const row of raw.characters ?? []) {
    const match = byId.get(row.id);
    if (!match) continue;
    const prompt = sanitizeStylePrompt(row.stylePrompt, names);
    if (!looksLikeStyle(prompt)) continue;
    perCharacter.push({ id: match.id, name: match.name, stylePrompt: prompt });
  }

  if (characters.length === 1) {
    const only = characters[0]!;
    const stylePrompt = sanitizeStylePrompt(
      perCharacter[0]?.stylePrompt || raw.stylePrompt,
      names,
    );
    if (!looksLikeStyle(stylePrompt)) {
      throw new Error("We couldn’t read a look from the uploaded artwork.");
    }
    return {
      compatible: true,
      stylePrompt,
      characters: [{ id: only.id, name: only.name, stylePrompt }],
    };
  }

  const shared = sanitizeStylePrompt(raw.stylePrompt, names);
  const compatible = raw.compatible !== false && looksLikeStyle(shared);

  if (compatible) {
    return {
      compatible: true,
      stylePrompt: shared,
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        stylePrompt: perCharacter.find((p) => p.id === c.id)?.stylePrompt || shared,
      })),
    };
  }

  const options =
    perCharacter.length > 0
      ? perCharacter
      : characters.map((c) => ({
          id: c.id,
          name: c.name,
          stylePrompt: shared,
        }));
  const usable = options.filter((o) => looksLikeStyle(o.stylePrompt));
  if (usable.length === 0) {
    throw new Error("We couldn’t read a look from the uploaded artwork.");
  }
  // If we only recovered one usable look, treat the drawings as compatible.
  if (usable.length === 1) {
    return {
      compatible: true,
      stylePrompt: usable[0]!.stylePrompt,
      characters: usable,
    };
  }

  return {
    compatible: false,
    stylePrompt: "",
    characters: usable,
  };
}

export function sameCharacterKey(a: string, b: string): boolean {
  return normalizeAnchorName(a) === normalizeAnchorName(b);
}
