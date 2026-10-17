import { z } from "zod";
import type { PromptContext } from "../prompts/context";
import { resolvePromptsConfig } from "../prompts/context";
import { renderTextPrompt } from "../prompts/render";
import { getTextProvider } from "../providers";
import type {
  InputImage,
  ProviderCredentials,
  ReferenceImage,
} from "../providers/types";
import type { ProviderId } from "../config/options";
import { withRetry } from "./retry";

const portraitQualitySchema = z.object({
  singleCharacter: z.boolean(),
  portraitComposition: z.boolean(),
  requestedAttributes: z.boolean(),
  ageAndLifeStage: z.boolean(),
  noTextOrWatermark: z.boolean(),
  identityMatch: z.boolean(),
  styleMatch: z.boolean(),
  childSafe: z.boolean(),
  notes: z.array(z.string()),
});

export type PortraitQualityAssessment = z.infer<typeof portraitQualitySchema>;

export interface AssessPortraitQualityInput {
  portrait: { base64: string; mimeType: string };
  targetPrompt: string;
  identityReference?: ReferenceImage;
  styleReference?: ReferenceImage;
  creds: ProviderCredentials;
  model: string;
  providerId: ProviderId;
  prompts?: PromptContext;
  signal?: AbortSignal;
}

function sameImage(a: ReferenceImage | undefined, b: ReferenceImage | undefined): boolean {
  return Boolean(a && b && a.mimeType === b.mimeType && a.base64 === b.base64);
}

function qualityImages(input: AssessPortraitQualityInput): {
  images: InputImage[];
  referenceGuide: string;
} {
  const images: InputImage[] = [
    {
      ...input.portrait,
      label: "Image 1 — the newly generated portrait to inspect",
    },
  ];
  const guide: string[] = [];
  const shared = sameImage(input.identityReference, input.styleReference);

  if (input.identityReference) {
    images.push({
      base64: input.identityReference.base64,
      mimeType: input.identityReference.mimeType,
      label: shared
        ? "Image 2 — identity and art-style reference"
        : "Image 2 — identity reference only",
    });
    guide.push(
      shared
        ? "Image 2 defines both this character's identity/design and the rendering style. Preserve the character and style, but do not copy its pose, framing or background."
        : "Image 2 defines identity and stable visible traits only. Ignore its photographic or previous rendering style, pose, background and incidental clothing.",
    );
  }

  if (input.styleReference && !shared) {
    const number = images.length + 1;
    images.push({
      base64: input.styleReference.base64,
      mimeType: input.styleReference.mimeType,
      label: `Image ${number} — art-style reference only`,
    });
    guide.push(
      `Image ${number} defines art style only. Never copy its people, demographic traits, pose, layout, framing or composition.`,
    );
  }

  if (!input.identityReference) {
    guide.push("No identity image is supplied; judge identityMatch as true.");
  }
  if (!input.styleReference) {
    guide.push("No style image is supplied; judge styleMatch as true.");
  }

  return { images, referenceGuide: guide.join("\n") };
}

/** Fixed, injection-safe instructions for a single corrective portrait redraw. */
export function portraitQualityCorrections(
  assessment: PortraitQualityAssessment,
): string[] {
  const corrections: string[] = [];
  if (!assessment.singleCharacter) {
    corrections.push("Draw exactly one character; never produce a group, grid, contact sheet or collage.");
  }
  if (!assessment.portraitComposition) {
    corrections.push("Use one coherent head-and-upper-body portrait cropped at the waist, with no legs or feet, on a simple background with no panels or copied layout.");
  }
  if (!assessment.requestedAttributes) {
    corrections.push("Follow every explicitly requested visible character trait, including species, skin, hair and clothing.");
  }
  if (!assessment.ageAndLifeStage) {
    corrections.push("Correct the apparent age, life stage and body proportions to match the request.");
  }
  if (!assessment.noTextOrWatermark) {
    corrections.push("Remove all text, lettering, signatures, borders and watermarks.");
  }
  if (!assessment.identityMatch) {
    corrections.push("Match the supplied identity reference closely while ignoring its pose, background and photographic style.");
  }
  if (!assessment.styleMatch) {
    corrections.push("Match the supplied art reference's rendering technique and feature simplification without copying its subjects or layout.");
  }
  if (!assessment.childSafe) {
    corrections.push("Keep the result gentle, friendly and suitable for a young children's picture book.");
  }
  return corrections;
}

export function portraitQualityPassed(
  assessment: PortraitQualityAssessment,
): boolean {
  return portraitQualityCorrections(assessment).length === 0;
}

/**
 * Best-effort visual inspection. A vision outage returns null so a usable
 * primary portrait is never discarded because the optional check was down.
 */
export async function assessPortraitQuality(
  input: AssessPortraitQualityInput,
): Promise<PortraitQualityAssessment | null> {
  const provider = getTextProvider(input.providerId);
  const { images, referenceGuide } = qualityImages(input);
  const { system, user } = renderTextPrompt(
    resolvePromptsConfig(input.prompts),
    "bindingPass/portraitQuality",
    {
      vars: {
        targetPrompt: input.targetPrompt.slice(0, 12_000),
        referenceGuide,
      },
    },
  );

  try {
    const assessment = await withRetry(
      () =>
        provider.generateStructured(input.creds, {
          model: input.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          schema: portraitQualitySchema,
          schemaName: "portrait_quality",
          temperature: 0,
          images,
          signal: input.signal,
        }),
      { signal: input.signal, retries: 1 },
    );
    return {
      ...assessment,
      identityMatch: input.identityReference ? assessment.identityMatch : true,
      styleMatch: input.styleReference ? assessment.styleMatch : true,
    };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return null;
  }
}
