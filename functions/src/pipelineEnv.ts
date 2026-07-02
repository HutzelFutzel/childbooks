/**
 * Backend binding of the shared illustration pipeline (`core/pipeline/
 * illustrationRun`). Supplies blob IO via the Admin SDK, `sharp` compositing,
 * and server-held provider keys, so the worker runs the exact same orchestration
 * the client does.
 */
import { serverConfig } from "./config";
import { buildHoleMask, compositeMaskedRegion } from "./imaging";
import { downloadBlobBase64, uploadBlob } from "./storage";
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
