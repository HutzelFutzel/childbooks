/**
 * Backend binding of the shared illustration pipeline (`core/pipeline/
 * illustrationRun`). Supplies blob IO via the Admin SDK, `sharp` compositing,
 * and server-held provider keys, so the worker runs the exact same orchestration
 * the client does.
 */
import { serverConfig } from "./config";
import { buildHoleMask, compositeMaskedRegion, downscaleReference } from "./imaging";
import { downloadBlobBase64, downloadPublicBase64, uploadBlob } from "./storage";
import { withStep } from "./usage";
import type { PipelineEnv } from "../../books-frontend/src/core/pipeline/illustrationRun";
import type { ResolvedModels } from "../../books-frontend/src/core/models/registry";
import type { ProviderId } from "../../books-frontend/src/core/config/options";
import type { PromptContext } from "../../books-frontend/src/core/prompts/context";

function apiKeyFor(provider: ProviderId): string {
  const cfg = serverConfig();
  const key = provider === "openai" ? cfg.openaiApiKey : cfg.googleApiKey;
  if (!key) throw new Error(`The ${provider} provider is not configured on the server.`);
  return key;
}

const b64ToBuf = (b64: string) => Buffer.from(b64, "base64");
const bufToB64 = (buf: Buffer) => buf.toString("base64");

/** Fetch a remote image URL as base64 + content type (art-style example fallback). */
async function fetchImageBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Style image fetch failed: ${res.status}`);
  const mimeType = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), mimeType };
}

/**
 * Resolve the art-style example image for a preset, given the loaded art-styles
 * config. Prefers the storage path (direct Admin download), then the public URL
 * (HTTP fetch), and returns null when neither resolves — the pipeline then
 * falls back to the textual style description.
 */
async function loadStyleImageFor(
  prompts: PromptContext | undefined,
  presetId: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const example = prompts?.artStyles?.examples?.[presetId];
  if (!example) return null;
  let raw: { base64: string; mimeType: string } | null = null;
  if (example.storagePath) {
    try {
      raw = await downloadPublicBase64(example.storagePath);
    } catch {
      // fall through to the public URL
    }
  }
  if (!raw && example.imageUrl) {
    try {
      raw = await fetchImageBase64(example.imageUrl);
    } catch {
      // no usable style image; caller falls back to the text description
    }
  }
  if (!raw) return null;
  // The exemplar is sent as a reference on EVERY generation; downscale + JPEG it
  // so a multi-megabyte source doesn't dominate every request's latency.
  const small = await downscaleReference(b64ToBuf(raw.base64));
  if (small) return { base64: bufToB64(small.buf), mimeType: small.mimeType };
  return raw;
}

/** Build the worker's pipeline environment for a given user + resolved models. */
export function backendPipelineEnv(
  uid: string,
  models: ResolvedModels,
  prompts?: PromptContext,
): PipelineEnv {
  return {
    models,
    apiKeyFor,
    loadBlob: (id) => downloadBlobBase64(uid, id),
    saveImage: (base64, mimeType) => uploadBlob(uid, b64ToBuf(base64), mimeType),
    loadStyleImage: (presetId) => loadStyleImageFor(prompts, presetId),
    // Reference payload shrinker: multi-megabyte stored PNGs sent inline are the
    // main cause of stalled provider calls (a page with 4-5 anchor sheets can
    // exceed 10 MB base64). The pipeline only applies this to reference/vision
    // copies, never to mask-aligned images or compositing bases.
    async downscaleRef(image) {
      const small = await downscaleReference(b64ToBuf(image.base64));
      return small ? { base64: bufToB64(small.buf), mimeType: small.mimeType } : image;
    },
    runStep: (step, fn) => withStep(step, fn),
    composite: {
      async compositeMaskedRegion(input) {
        const out = await compositeMaskedRegion({
          original: b64ToBuf(input.originalBase64),
          edited: b64ToBuf(input.editedBase64),
          mask: b64ToBuf(input.maskBase64),
        });
        return { base64: bufToB64(out), mimeType: "image/png" };
      },
      async buildHoleMask(input) {
        const out = await buildHoleMask({
          page: b64ToBuf(input.pageBase64),
          box: input.box,
          paddingFrac: input.paddingFrac,
        });
        return { base64: bufToB64(out), mimeType: "image/png" };
      },
    },
    prompts,
  };
}
