/**
 * The neutral sample portrait of a saved custom art style.
 *
 * A reader's drawing of one character defines the look, but it is that
 * character, not the look. This draws a generic, imaginary child in the same
 * rendering, with no resemblance to anyone, so the look can be shown and judged
 * on its own: in the style picker before any cover exists, and as a plain
 * reference for a future "use this look again" feature.
 *
 * Runs on its own Cloud Tasks queue after the first book uses the style. It is
 * ours to make, never the reader's to pay for: the provider call is metered
 * under a non-billable step and settled at zero Sparks.
 */
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { logger } from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";
import "./providerHttp";
import { downscaleReference } from "./imaging";
import { meterAndSettle } from "./actionRun";
import { getGenerationTuningConfig, loadModelCapabilities, loadPromptContext } from "./appConfig";
import { apiKeyFor, requireTier, resolveImageModels } from "./modelResolve";
import { ALL_SECRETS } from "./secrets";
import { downloadBlob, ensureAdmin } from "./storage";
import { withRetry } from "../../books-frontend/src/core/pipeline/retry";
import { withStep, withUsage } from "./usage";
import { loadCustomStyle, stylesPath, storeStyleAsset } from "./customStyles";
import {
  capabilitiesFor,
  sanitizeImageSize,
} from "../../books-frontend/src/core/config/modelCapabilities";
import { resolveImageGenerationOptions } from "../../books-frontend/src/core/config/imageGeneration";
import { generationIntentFor, generationTuningFor } from "../../books-frontend/src/core/config/generationTuning";
import { resolvePromptsConfig } from "../../books-frontend/src/core/prompts/context";
import { renderSinglePrompt } from "../../books-frontend/src/core/prompts/render";
import { resolveArtStyleText } from "../../books-frontend/src/core/prompts/style";
import { getImageProvider } from "../../books-frontend/src/core/providers";
import type { ImageRequest, ReferenceImage } from "../../books-frontend/src/core/providers/types";
import type { CustomArtStyle } from "../../books-frontend/src/core/config/customArtStyles";

/** Hard cap on the one provider call, so a stalled render fails fast and is retried. */
const SAMPLE_TIMEOUT_MS = 200_000;
const SAMPLE_SIZE = "1024x1536";

/** What the model is told about the single reference picture. */
const STYLE_ONLY_NOTE =
  "Use the supplied ART-STYLE reference only for facial-feature simplification, eye and nose treatment, line quality, shading method, palette, brush or paper texture and level of detail. Never copy its character identity, face shape, age, hair, skin tone, clothing, pose, expression, body proportions, background, layout or composition.";
const NEUTRAL_NOTE =
  "This is a neutral style sample: an imaginary child who does not resemble any real person, in a plain everyday outfit, standing against a simple soft background.";

function samplePrompt(styleText: string, promptsConfig: ReturnType<typeof resolvePromptsConfig>): string {
  const base = renderSinglePrompt(promptsConfig, "portrait/default", {
    vars: {
      name: "Sample",
      age: "six years old",
      role: "",
      appearance: "",
      bodyPlan: "",
      species: "child",
      together: "",
      artStyle: styleText,
      note: "",
    },
    flags: {
      isAnimal: false,
      isToy: false,
      isCreature: false,
      hasTogether: false,
      hasNote: false,
      hasAge: true,
      hasRole: false,
      hasAppearance: false,
      hasBodyPlan: false,
      fromPhoto: false,
      fromDrawing: false,
      fromCurrentPortrait: false,
      invent: true,
    },
  });
  return [base, STYLE_ONLY_NOTE, NEUTRAL_NOTE, "Reference image 1 is the art-style reference."].join("\n\n");
}

/** Draw and store the sample for one revision of one saved style. Idempotent. */
export async function generateStyleReference(uid: string, styleId: string, revision: number): Promise<void> {
  ensureAdmin();
  const stored = await loadCustomStyle(uid, { id: styleId, revision });
  if (!stored) {
    logger.warn("[styles] sample portrait skipped: style is gone", { styleId });
    return;
  }
  if (stored.style.portraitReference) return;

  const tier = requireTier(undefined, false);
  const [models, prompts, capabilityOverrides, tuning] = await Promise.all([
    resolveImageModels("portrait", tier),
    loadPromptContext(),
    loadModelCapabilities(),
    getGenerationTuningConfig(),
  ]);
  const model = models.imageModel;
  const capabilities = capabilitiesFor(model, capabilityOverrides);
  const actionTuning = generationTuningFor(tuning, "portrait");

  // The drawing that set the look, shrunk like every other reference.
  const references: ReferenceImage[] = [];
  const source = stored.revision.sourceArt[0];
  if (source && capabilities.operations.referenceEditing) {
    const bytes = await downloadBlob(uid, source.blobId);
    const small = await downscaleReference(
      bytes,
      actionTuning.references.maxDimension,
      actionTuning.references.encodingQuality,
    );
    references.push({
      base64: (small?.buf ?? bytes).toString("base64"),
      mimeType: small?.mimeType ?? source.mimeType,
      label: "the art-style reference",
      role: "style",
    });
  }

  const generation = resolveImageGenerationOptions(capabilities, generationIntentFor(actionTuning));
  const prompt = samplePrompt(
    resolveArtStyleText(
      { presetId: null, customDescription: stored.revision.promptDescription, origin: "derived" },
      prompts.artStyles,
    ),
    resolvePromptsConfig(prompts),
  );
  const request: ImageRequest = {
    model: model.id,
    prompt,
    size: sanitizeImageSize(capabilities, SAMPLE_SIZE),
    quality: generation.applied.quality,
    output:
      generation.applied.background || generation.applied.format || generation.applied.outputCompression !== undefined
        ? {
            background: generation.applied.background,
            format: generation.applied.format,
            compression: generation.applied.outputCompression,
          }
        : undefined,
    references: references.length > 0 ? references : undefined,
    signal: AbortSignal.timeout(SAMPLE_TIMEOUT_MS),
  };

  const startedAt = Date.now();
  const { value: image, events, stats } = await withUsage(() =>
    withStep("styleReference", () =>
      withRetry(
        () => getImageProvider(model.provider).generateImage({ apiKey: apiKeyFor(model.provider) }, request),
        { retries: actionTuning.retries, signal: request.signal },
      ),
    ),
  );
  await meterAndSettle({
    uid,
    action: "styleReference",
    tier,
    events,
    stats,
    kind: "fresh",
    source: "worker",
    // Never charged, however the action is priced.
    quotedSparks: 0,
    startedAt,
    models: { image: model },
    generation,
    inputReferenceCount: references.length,
    outputSize: request.size,
  });

  const asset = await storeStyleAsset({
    uid,
    styleId,
    kind: "sample",
    suffix: revision,
    bytes: Buffer.from(image.base64, "base64"),
    mimeType: image.mimeType,
  });
  const ref = getFirestore().doc(`${stylesPath(uid)}/${styleId}`);
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const style = snap.data() as CustomArtStyle;
    if (style.portraitReference) return;
    tx.update(ref, { portraitReference: { ...asset, revision }, updatedAt: Date.now() });
  });
}

export const runStyleReference = onTaskDispatched<{ uid: string; styleId: string; revision: number }>(
  {
    secrets: ALL_SECRETS,
    memory: "1GiB",
    timeoutSeconds: 300,
    concurrency: 2,
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 30, maxBackoffSeconds: 300 },
    // A background nicety: it may never crowd out the pictures readers are waiting for.
    rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
  },
  async (req) => {
    const { uid, styleId, revision } = req.data;
    if (!uid || !styleId || !Number.isInteger(revision)) return;
    await generateStyleReference(uid, styleId, revision);
  },
);