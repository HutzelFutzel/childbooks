/**
 * Read uploaded character drawings and write a visual description of WHO is
 * in them. Later analysis, sheet, and page prompts use this so a hedgehog
 * named Hugo is not rewritten as a human boy.
 */
import { z } from "zod";
import { getTextProvider } from "../providers";
import type { ProviderCredentials } from "../providers/types";
import type { ProviderId } from "../config/options";
import type { BodyPlan } from "../types";
import { resolvePromptsConfig, type PromptContext } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import { withRetry } from "./retry";
import { normalizeAnchorName } from "../book/anchorRefs";
import type { SourceArtCharacterInput } from "./styleExtract";

const BODY_PLANS = ["bipedal", "quadruped", "avian", "aquatic", "amorphous"] as const;

const extractSchema = z.object({
  characters: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      bodyPlan: z.enum(BODY_PLANS).nullish(),
    }),
  ),
});

export interface ExtractedCharacterLook {
  id: string;
  name: string;
  description: string;
  bodyPlan?: BodyPlan;
}

export interface ExtractArtLookResult {
  characters: ExtractedCharacterLook[];
}

export interface ExtractArtLookInput {
  characters: SourceArtCharacterInput[];
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  signal?: AbortSignal;
  prompts?: PromptContext;
}

const LOOK_MAX = 400;

function clampLook(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, LOOK_MAX);
}

/** Describe each character from their drawings. */
export async function extractArtLookFromImages(
  input: ExtractArtLookInput,
): Promise<ExtractArtLookResult> {
  const characters = input.characters.filter((c) => c.images.length > 0);
  if (characters.length === 0) {
    throw new Error("Add character artwork first.");
  }

  const caption = (name: string, id: string, n: number, extra: boolean) =>
    extra
      ? `Image (${n}) is another picture of "${name}" (id "${id}").`
      : `Image (${n}) is existing artwork of "${name}" (id "${id}").`;

  const legend = characters
    .flatMap((c, ci) =>
      c.images.map((_image, ii) => {
        const n = characters.slice(0, ci).reduce((sum, x) => sum + x.images.length, 0) + ii + 1;
        return caption(c.name, c.id, n, ii > 0);
      }),
    )
    .join(" ");

  const images = characters.flatMap((c, ci) =>
    c.images.map((image, ii) => {
      const n = characters.slice(0, ci).reduce((sum, x) => sum + x.images.length, 0) + ii + 1;
      return { ...image, label: caption(c.name, c.id, n, ii > 0) };
    }),
  );

  const { system, user } = renderTextPrompt(resolvePromptsConfig(input.prompts), "extractArtLook", {
    vars: { legend, characterCount: String(characters.length) },
  });

  const provider = getTextProvider(input.providerId);
  const raw = await withRetry(
    () =>
      provider.generateStructured(input.creds, {
        model: input.model,
        schema: extractSchema,
        schemaName: "extract_art_look",
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
  const out: ExtractedCharacterLook[] = [];
  for (const row of raw.characters) {
    const match = byId.get(row.id) ?? characters.find((c) => normalizeAnchorName(c.name) === normalizeAnchorName(row.id));
    const description = clampLook(row.description);
    if (!match || description.length < 12) continue;
    out.push({
      id: match.id,
      name: match.name,
      description,
      ...(row.bodyPlan ? { bodyPlan: row.bodyPlan } : {}),
    });
  }
  if (out.length === 0) {
    throw new Error("We couldn’t read who is in the uploaded artwork.");
  }
  return { characters: out };
}
